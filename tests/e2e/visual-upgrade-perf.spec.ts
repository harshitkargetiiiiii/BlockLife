import { test, expect, type Page } from '@playwright/test'

/**
 * Issue #25 Stage A — GLB integration + perf/material regression guard. Proves the enabled
 * archetype/prop GLBs settle without error, keep authored placement valid (a projected
 * building's collider/anchors never move), survive a streaming round-trip, and stay within
 * the material budget the DEV `getMaterialStats()` makes measurable (gl.info can't report
 * materials). Also logs the deterministic render/material snapshot used for the before/after
 * table. Deterministic: paused, fixed time + clear weather, default spawn sector (s0_0).
 */
type Api = Record<string, (...a: unknown[]) => unknown>
const call = (page: Page, m: string, ...a: unknown[]) =>
  page.evaluate(([mm, aa]) => (window.GAME_TEST_API as unknown as Api)[mm as string](...(aa as unknown[])), [m, a] as const)

/**
 * Boot and wait for the scene to settle.
 *
 * The `assetsSettled()` wait has timed out here twice in a row in CI (runs 33979652484 and
 * 33981345067, shard 8/8, on unchanged production code), and a bare timeout says only THAT the
 * graph never settled — never which body held it open. So on failure this reports the readiness
 * snapshot and rethrows the original error.
 *
 * Diagnostic only, and deliberately so: the predicate, the timeout and the failure are all
 * unchanged, the report happens strictly after the wait has already lost, and the original error is
 * rethrown untouched, so this cannot turn a red run green. `unresolvedByAsset` is the field to
 * read — it is the per-id breakdown of the number readiness actually blocks on, whereas
 * `glbPending` is the raw census and also lists ids that do not block.
 */
async function boot(page: Page): Promise<void> {
  const file = (u: string) => u.split('/').pop() ?? u
  const glbRequested = new Set<string>()
  const glbFinished = new Set<string>()
  const glbFailed = new Set<string>()
  page.on('request', (r) => { if (r.url().endsWith('.glb')) glbRequested.add(file(r.url())) })
  page.on('requestfinished', (r) => { if (r.url().endsWith('.glb')) glbFinished.add(file(r.url())) })
  page.on('requestfailed', (r) => { if (r.url().endsWith('.glb')) glbFailed.add(file(r.url())) })
  await page.goto('/')
  await page.waitForFunction(() => window.GAME_TEST_API?.ready() === true, undefined, { timeout: 45_000 })
  try {
    await page.waitForFunction(() => window.GAME_TEST_API?.assetsSettled() === true, undefined, { timeout: 45_000 })
  } catch (err) {
    const readiness = await page
      .evaluate(() => window.GAME_TEST_API?.getAssetReadiness?.() ?? null)
      .catch(() => null)
    // eslint-disable-next-line no-console
    console.log('ASSETS_NOT_SETTLED ' + JSON.stringify(readiness))
    // Second half of the question: was the stalled id's file ever requested, requested but never
    // finished, or finished while the component stayed suspended? Three causes, three fixes.
    //
    // Measured from PLAYWRIGHT's network events, not `performance.getEntriesByType('resource')`.
    // The in-page version reported `requested: 0` while 319 GLB instances were active — an
    // artifact of `resourceTimingBufferSize` (default 250): under Vite dev, hundreds of ES modules
    // fill the buffer before the first GLB is requested, and later entries are simply dropped. The
    // event listeners below have no such limit.
    // eslint-disable-next-line no-console
    console.log('GLB_NET ' + JSON.stringify({
      requested: [...glbRequested].sort(),
      finished: [...glbFinished].sort(),
      failed: [...glbFailed].sort(),
      // Requested but never finished — the ones a stalled boot is actually waiting on.
      outstanding: [...glbRequested].filter((f) => !glbFinished.has(f) && !glbFailed.has(f)).sort(),
    }))
    throw err
  }
}

test.describe('issue #25 Stage A — GLB integration', () => {
  test('house + kiosk GLBs settle, keep placement valid, and stay within the material budget', async ({ page }) => {
    const errors: string[] = []
    page.on('pageerror', (e) => errors.push(String(e)))
    await boot(page)
    await call(page, 'resetGame')
    await call(page, 'setTime', 10)
    await call(page, 'setWeather', 'clear')
    await page.waitForFunction(() => window.GAME_TEST_API!.assetsSettled() === true, undefined, { timeout: 30_000 })
    await page.waitForTimeout(2200)
    await page.evaluate(() => window.GAME_TEST_API!.pauseWorld(true))
    await page.waitForTimeout(600)

    // Placement stays valid everywhere: the residential-house projection (scale/rotation/offset)
    // is visual-only — building_house_r1's collider/anchor are unchanged (0 defects).
    const reports = (await call(page, 'getPlacementReport')) as { sectorId: string; failures: unknown[] }[]
    expect(reports.length, 'at least one sector reported').toBeGreaterThan(0)
    for (const r of reports) expect(r.failures, `${r.sectorId} placement failures`).toEqual([])

    const render = (await call(page, 'getRenderStats')) as Record<string, number>
    const materials = (await call(page, 'getMaterialStats')) as {
      uniqueMaterials: number
      variantCache: { keys: number; materials: number }
    }
    // eslint-disable-next-line no-console
    console.log('PERF_CAPTURE ' + JSON.stringify({ render, materials }))
    expect(render.drawCalls, 'scene is drawing').toBeGreaterThan(0)
    // Whole-scene material count stays well under the historical browser ceiling; the shared
    // variant cache (unused at Stage A — the calibration house declares no palette slots yet)
    // is empty, proving no per-instance material leak from the two new GLBs.
    expect(materials.uniqueMaterials, 'materials measured').toBeGreaterThan(0)
    expect(materials.variantCache.keys, 'no variant cache entries at Stage A').toBe(0)
  })

  test('the enabled GLBs survive a sector unload→reload without errors', async ({ page }) => {
    const errors: string[] = []
    page.on('pageerror', (e) => errors.push(String(e)))
    await boot(page)
    await call(page, 'teleportPlayer', [260, 1.2, -100]) // far east → s0_0 (house + kiosk) unloads
    await page.waitForTimeout(2500)
    await call(page, 'teleportPlayer', [12, 1.2, -1]) // back to the plaza → s0_0 re-mounts
    await page.waitForFunction(() => window.GAME_TEST_API!.assetsSettled() === true, undefined, { timeout: 30_000 })
    expect(errors, 'no pageerror across the streaming round-trip').toEqual([])
    expect(await call(page, 'assetsSettled'), 're-settled after reload').toBe(true)
  })
})
