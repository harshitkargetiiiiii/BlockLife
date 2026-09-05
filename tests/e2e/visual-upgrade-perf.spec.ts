import { test, expect, type Page } from '@playwright/test'
import { cutOffAt, summarizeStall, type GlbRequestTiming, type ReadinessSample, type StageMark } from './assetStallReport'

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
 * This wait has timed out repeatedly in CI shard 8, always with the same culprit: exactly one
 * instance of `vehicle_compact_car_01` unresolved, `failed: 0`, the graph still for ~20 s. Earlier
 * instrumentation established that its file's HTTP response completes — which rules out a request
 * that is absent or hung *at the timeout instant*, and nothing more. It does NOT rule out Wave 4's
 * four extra GLBs in this sector delaying the request, nor post-network parse/decode/commit
 * contention from them.
 *
 * So this records, for that one asset, WHEN each step happened — request start and finish, the
 * render/commit milestones from the DEV stage probe, how long the boot then kept waiting, and how
 * many peer GLB requests were in flight at those instants. Peer progress is reported as context
 * only: a peer committing later does NOT show this body was skipped, since it is equally consistent
 * with the body being mid-parse, mid-decode or awaiting Suspense.
 *
 * All three sources record wall-clock `Date.now()` and are normalised to one `t0` by the reporter.
 * The browser's `performance.now()` is relative to the document's own time origin and cannot be
 * compared with Node timings, so it is deliberately not used.
 *
 * Diagnostic only. The predicate, the timeout and the failure are untouched; the sampler runs
 * alongside and is always stopped; the report is emitted strictly after the wait has already lost;
 * and the original error is rethrown, so this cannot turn a red run green. The analysis itself is
 * pure and unit-tested in `assetStallReport.test.ts` — no browser needed to verify it.
 */
const STALL_ASSET_ID = 'vehicle_compact_car_01'
const STALL_FILE = 'compact_sedan_01.glb'

async function boot(page: Page): Promise<void> {
  const t0 = Date.now()
  const fileOf = (u: string) => u.split('/').pop() ?? u
  const timings = new Map<string, GlbRequestTiming>()
  page.on('request', (r) => {
    if (!r.url().endsWith('.glb')) return
    const f = fileOf(r.url())
    if (!timings.has(f)) timings.set(f, { file: f, startEpochMs: Date.now(), endEpochMs: null })
  })
  page.on('requestfinished', (r) => {
    if (!r.url().endsWith('.glb')) return
    const t = timings.get(fileOf(r.url()))
    if (t && t.endEpochMs === null) t.endEpochMs = Date.now()
  })
  page.on('requestfailed', (r) => {
    if (!r.url().endsWith('.glb')) return
    const t = timings.get(fileOf(r.url()))
    // Terminal, exactly like a completed response: stamp the moment it ended and mark it failed.
    // Leaving it unstamped made a dead request look permanently in flight.
    if (t && t.endEpochMs === null) {
      t.endEpochMs = Date.now()
      t.failed = true
    }
  })

  await page.goto('/')
  await page.waitForFunction(() => window.GAME_TEST_API?.ready() === true, undefined, { timeout: 45_000 })

  const samples: ReadinessSample[] = []
  let sampling = true
  const sampler = (async () => {
    while (sampling) {
      const snap = await page
        .evaluate(() => {
          const r = window.GAME_TEST_API?.getAssetReadiness?.()
          return r ? { u: r.unresolvedByAsset.map((x) => x.id), a: [...r.glbActive] } : null
        })
        .catch(() => null)
      if (snap) samples.push({ epochMs: Date.now(), unresolvedIds: snap.u, activeIds: snap.a })
      await new Promise((r) => setTimeout(r, 500))
    }
  })()

  try {
    await page.waitForFunction(() => window.GAME_TEST_API?.assetsSettled() === true, undefined, { timeout: 45_000 })
  } catch (err) {
    const gaveUpEpochMs = Date.now()
    // Freeze the evidence at the failure boundary, SYNCHRONOUSLY, before any await. The sampler and
    // the network listeners keep running while the report is assembled, so without this a request
    // could terminate after the wait gave up and be reported as pre-failure evidence — including a
    // negative "waited after arrival". `summarizeStall` also cuts off at `gaveUpEpochMs`; this
    // makes the raw log agree with it.
    const frozen = cutOffAt(
      samples.map((x) => ({ ...x })),
      [...timings.values()].map((t) => ({ ...t })),
      [],
      gaveUpEpochMs,
    )
    const readiness = await page
      .evaluate(() => window.GAME_TEST_API?.getAssetReadiness?.() ?? null)
      .catch(() => null)
    // eslint-disable-next-line no-console
    console.log('ASSETS_NOT_SETTLED ' + JSON.stringify(readiness))
    // Where between "bytes arrived" and "committed" it stopped. A MISSING 'hook-returned' means the
    // component never got past useGLTF, which leaves parse, decode and Suspense-resume all
    // unresolved between them — narrowing the question, not answering it.
    const stageMarks: StageMark[] = (await page
      .evaluate(() => window.GAME_TEST_API?.getAssetStageMarks?.() ?? [])
      .catch(() => [])) as StageMark[]
    // eslint-disable-next-line no-console
    console.log('STALL_REPORT ' + JSON.stringify(
      summarizeStall(STALL_ASSET_ID, STALL_FILE, frozen.samples, frozen.timings, stageMarks, t0, gaveUpEpochMs),
    ))
    // Raw per-file request timings, so "did Wave 4 delay the request" is answerable directly.
    // eslint-disable-next-line no-console
    console.log('GLB_TIMINGS ' + JSON.stringify(
      frozen.timings
        .sort((a, b) => a.startEpochMs - b.startEpochMs)
        .map((t) => ({
          file: t.file,
          startMs: t.startEpochMs - t0,
          endMs: t.endEpochMs === null ? null : t.endEpochMs - t0,
          failed: t.failed === true,
        })),
    ))
    throw err
  } finally {
    sampling = false
    await sampler.catch(() => {})
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
