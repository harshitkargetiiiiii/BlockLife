import { mkdirSync, writeFileSync } from 'node:fs'
import { test, expect, type Page } from '@playwright/test'

/**
 * E2E-environment render-suppression A/B proof (branch e2e-ci-telemetry-probe).
 *
 * NOT part of the 8-shard merge gate (lives under tests/diagnostics; the gate runs tests/e2e). Runs
 * only when explicitly named / via the branch-scoped diagnostic workflow. It measures RAW host
 * throughput on the REAL app/rendering/simulation paths across three deterministic scenes, each in
 * TWO windows on the SAME job: (A) normal rendering, (B) render-suppressed (R3F root scene made
 * non-visible — drawing skipped, the single useFrame authority + physics + directors preserved).
 * Then it verifies the scene restores. This is NOT a virtual clock and NOT N-sub-stepping.
 *
 * Fails on experiment-integrity problems (crash, telemetry unavailable, non-finite, zero frames,
 * missing output) AND on the stated proof criteria (suppression materially cuts draw work; suppressed
 * raw FPS ≥ 20 OR clamped rate ≥ 0.9; domain progress continues; rendering restores). If the proof
 * criteria are not met the step fails, so the workflow stops before the existing-test run.
 *
 * Run: npx playwright test tests/diagnostics/e2e-environment.spec.ts --workers=1
 */
type Api = Record<string, (...a: unknown[]) => unknown>
const call = (page: Page, m: string, ...a: unknown[]) =>
  page.evaluate(([mm, aa]) => (window.GAME_TEST_API as unknown as Api)[mm as string](...(aa as unknown[])), [m, a] as const)

const OUT_DIR = 'diagnostics-output'
const WINDOW_MS = 30_000
const RESTORE_MS = 6_000
const records: Record<string, unknown>[] = []

const SCENES: { name: string; pos: [number, number, number] }[] = [
  { name: 'idle_default', pos: [12, 1.2, 2] },
  { name: 'active_central', pos: [0, 1.2, 6] },
  { name: 'highload_streaming', pos: [57, 1.2, -88] },
]

async function measure(page: Page, ms: number): Promise<Record<string, any>> {
  await call(page, 'resetDiagnostics')
  await page.waitForTimeout(ms)
  const d = (await call(page, 'getDiagnostics')) as Record<string, any> | null
  expect(d, 'telemetry unavailable').toBeTruthy()
  expect(Number.isFinite(d!.rawFps as number), 'non-finite rawFps').toBe(true)
  expect(Number.isFinite(d!.clampedSimRate as number), 'non-finite clampedSimRate').toBe(true)
  expect(d!.frames as number, 'zero rendered/looped frames').toBeGreaterThan(0)
  expect((d!.renderer as Record<string, unknown>)?.renderer, 'renderer telemetry missing').toBeTruthy()
  return d!
}

test.describe('E2E environment render-suppression A/B (diagnostic only)', () => {
  test('normal vs render-suppressed throughput on the single useFrame authority', async ({ page }) => {
    test.setTimeout(12 * 60_000) // work stays < 8 min; 15-min job ceiling in the workflow
    const errors: string[] = []
    page.on('pageerror', (e) => errors.push(String(e)))
    page.on('crash', () => errors.push('PAGE_CRASH'))

    await page.goto('/')
    await page.waitForFunction(() => window.GAME_TEST_API?.ready() === true, undefined, { timeout: 45_000 })

    try {
      for (const scene of SCENES) {
        await call(page, 'resetGame')
        await call(page, 'setTime', 12)
        await call(page, 'setWeather', 'clear')
        await call(page, 'teleportPlayer', scene.pos)
        await page.waitForFunction(() => window.GAME_TEST_API?.assetsSettled() === true, undefined, { timeout: 45_000 }).catch(() => {})
        await page.waitForTimeout(2_000)

        // A) normal rendering
        await call(page, 'setRenderSuppressed', false)
        const normal = await measure(page, WINDOW_MS)

        // B) render-suppressed (scene made non-visible; loop + systems preserved)
        await call(page, 'setRenderSuppressed', true)
        expect(await call(page, 'isRenderSuppressed'), 'suppression did not engage').toBe(true)
        await page.waitForTimeout(500)
        const suppressed = await measure(page, WINDOW_MS)

        // restore + prove rendering returns
        await call(page, 'setRenderSuppressed', false)
        expect(await call(page, 'isRenderSuppressed'), 'suppression did not clear').toBe(false)
        await page.waitForTimeout(500)
        const restored = await measure(page, RESTORE_MS)

        // ---- proof assertions ----
        const nDraws = normal.render.drawCalls as number
        const sDraws = suppressed.render.drawCalls as number
        const rDraws = restored.render.drawCalls as number
        expect(sDraws, `[${scene.name}] suppression did not materially cut draw work`).toBeLessThan(nDraws * 0.2)
        expect(rDraws, `[${scene.name}] rendering did not restore`).toBeGreaterThan(nDraws * 0.5)
        // near real-time on the single authority once drawing is skipped
        const okThroughput = (suppressed.rawFps as number) >= 20 || (suppressed.clampedSimRate as number) >= 0.9
        expect(okThroughput, `[${scene.name}] suppressed rawFps=${suppressed.rawFps} clampedSimRate=${suppressed.clampedSimRate} below 20fps/0.9`).toBe(true)
        // components mounted + domain progresses under suppression (not a hollow scene)
        const dom = suppressed.domain as Record<string, number>
        expect(dom.movingPeople + dom.personMetersMoved + dom.gameHoursAdvanced, `[${scene.name}] no domain progress under suppression`).toBeGreaterThan(0)

        records.push({ scene: scene.name, pos: scene.pos, normal, suppressed, restored })
      }

      expect(errors, 'page errors during A/B').toEqual([])
    } finally {
      await call(page, 'setRenderSuppressed', false).catch(() => {})
    }

    mkdirSync(OUT_DIR, { recursive: true })
    const payload = { capturedAtMs: Date.now(), windowMs: WINDOW_MS, pageErrors: errors, scenes: records }
    writeFileSync(`${OUT_DIR}/e2e-environment.json`, JSON.stringify(payload, null, 2))
    console.log('DIAG_JSON ' + JSON.stringify(payload))
    expect(records.length, 'missing measurement output').toBe(SCENES.length)
  })
})
