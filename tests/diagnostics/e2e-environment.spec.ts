import { mkdirSync, writeFileSync } from 'node:fs'
import { test, expect, type Page } from '@playwright/test'

/**
 * E2E-environment telemetry experiment (branch e2e-ci-telemetry-probe).
 *
 * NOT part of the 8-shard merge gate — it lives under tests/diagnostics (the gate runs tests/e2e)
 * and only runs when explicitly named / via the branch-scoped diagnostic workflow. It uses the REAL
 * app / rendering / simulation paths, but replaces the 300–380 s soak windows with three short,
 * deterministic 30–45 s measurement windows and records raw host throughput + domain progress, so a
 * CI run and a local run can be compared numerically. It FAILS only on experiment-integrity problems
 * (page crash, telemetry unavailable, non-finite data, zero rendered frames, missing output) — never
 * on a performance threshold, which does not exist until CI + local numbers are gathered.
 *
 * Run: npx playwright test tests/diagnostics/e2e-environment.spec.ts --workers=1
 */
type Api = Record<string, (...a: unknown[]) => unknown>
const call = (page: Page, m: string, ...a: unknown[]) =>
  page.evaluate(([mm, aa]) => (window.GAME_TEST_API as unknown as Api)[mm as string](...(aa as unknown[])), [m, a] as const)

const OUT_DIR = 'diagnostics-output'
const records: Record<string, unknown>[] = []

// Three deterministic scenes: settled idle, active traffic/citizen, high-load streaming district.
const SCENES: { name: string; pos: [number, number, number]; windowMs: number }[] = [
  { name: 'idle_default', pos: [12, 1.2, 2], windowMs: 30_000 },
  { name: 'active_central', pos: [0, 1.2, 6], windowMs: 40_000 },
  { name: 'highload_streaming', pos: [57, 1.2, -88], windowMs: 40_000 },
]

test.describe('E2E environment telemetry (diagnostic only)', () => {
  test('measure raw render/sim throughput across three deterministic windows', async ({ page }) => {
    test.setTimeout(10 * 60_000) // 10-minute job ceiling; actual work stays < 8 min
    const errors: string[] = []
    page.on('pageerror', (e) => errors.push(String(e)))
    page.on('crash', () => errors.push('PAGE_CRASH'))

    await page.goto('/')
    await page.waitForFunction(() => window.GAME_TEST_API?.ready() === true, undefined, { timeout: 45_000 })

    for (const scene of SCENES) {
      // Fixed deterministic state: reset (seeded), noon, clear weather, fixed spawn, default camera.
      await call(page, 'resetGame')
      await call(page, 'setTime', 12)
      await call(page, 'setWeather', 'clear')
      await call(page, 'teleportPlayer', scene.pos)
      await page.waitForFunction(() => window.GAME_TEST_API?.assetsSettled() === true, undefined, { timeout: 45_000 }).catch(() => {})
      await page.waitForTimeout(2_000) // let the scene settle before measuring

      const errBefore = errors.length
      const settledAtStart = await call(page, 'assetsSettled')
      await call(page, 'resetDiagnostics')
      await page.waitForTimeout(scene.windowMs) // measure a fixed REAL-time window
      const diag = (await call(page, 'getDiagnostics')) as Record<string, any> | null

      // ---- experiment-integrity assertions (NOT performance thresholds) ----
      expect(diag, `[${scene.name}] telemetry unavailable`).toBeTruthy()
      expect(Number.isFinite(diag!.rawFps as number), `[${scene.name}] non-finite rawFps`).toBe(true)
      expect(Number.isFinite(diag!.clampedSimRate as number), `[${scene.name}] non-finite clampedSimRate`).toBe(true)
      expect(diag!.frames as number, `[${scene.name}] zero rendered frames`).toBeGreaterThan(0)
      const renderer = (diag!.renderer as Record<string, unknown>)?.renderer
      expect(renderer, `[${scene.name}] renderer telemetry missing`).toBeTruthy()

      records.push({
        scene: scene.name,
        pos: scene.pos,
        windowMs: scene.windowMs,
        settledAtStart,
        pageErrorsDuringWindow: errors.length - errBefore,
        ...diag,
      })
    }

    // ---- one structured output record (missing output = integrity failure) ----
    mkdirSync(OUT_DIR, { recursive: true })
    const payload = { capturedAtMs: Date.now(), pageErrors: errors, scenes: records }
    writeFileSync(`${OUT_DIR}/e2e-environment.json`, JSON.stringify(payload, null, 2))
    console.log('DIAG_JSON ' + JSON.stringify(payload))
    expect(records.length, 'missing measurement output').toBe(SCENES.length)
  })
})
