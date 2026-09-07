import { expect, type Page } from '@playwright/test'
import { checkFraming, type BodyDims, type ViewName } from './framing'
import { ASSET_SETTLE_QUIET_MS } from '../../src/game/assets/assetSettle'
export { waitForVehicleGrounded } from '../e2e/helpers'

/**
 * Shared visual-test helpers (issue #46 §4 + §5) — the browser-facing half. The pure framing
 * geometry lives in `./framing`, which is unit-tested; this file owns readiness and shot setup.
 *
 * STALE TRANSIENTS are the defect class this exists for. `assetsSettled()` compares mounted vs
 * committed GLB counters. A sector remount (`resetGame`, `teleportPlayer`, a streaming
 * crossing) drives all three counters through a trough where they read 0, so the predicate was
 * VACUOUSLY true and a shot photographed whatever happened to be up. Wave 2 and Wave 3 each
 * committed a baseline that way — a procedural fallback recorded where the GLB belongs — and
 * individual specs then grew their own `waitForTimeout(1200)`-then-re-check workarounds, which
 * is the same race with a longer fuse. `waitForSceneSettled()` replaces all of them with a gate
 * that proves the scene being photographed: nothing pending, no mount churn for a quiet window,
 * and — when the shot is ABOUT a body — that body's GLB actually committed rather than fell back.
 */

/** 3D-world shots allow a small pixel-diff ratio (low-poly AA on device pixels). */
export const SHOT = { maxDiffPixelRatio: 0.02 }

/**
 * How long the GLB mount graph must stay unchanged before the scene counts as settled —
 * imported from the game, not retyped, so the helper and the test API cannot drift.
 */
export const SETTLE_QUIET_MS = ASSET_SETTLE_QUIET_MS

export interface SceneSettleOptions {
  /**
   * Manifest asset ids whose GLB BODY must be the thing on screen before the shot — the
   * difference between "boot finished" and "the subject of this photograph is up".
   */
  requireGlb?: readonly string[]
  timeout?: number
  quietMs?: number
}

/**
 * Wait until the scene being photographed is mounted and quiescent.
 *
 * `assetsSettled(quietMs)` is non-vacuous by construction: it requires that at least one GLB
 * landmark has ever registered (so it cannot pass before the world mounts), that nothing is
 * still pending, AND that no mount/unmount/commit/failure has happened for `quietMs` — which a
 * remount trough always violates. Polling on a timer rather than rAF keeps the gate honest
 * while the world is paused.
 */
export async function waitForSceneSettled(page: Page, opts: SceneSettleOptions = {}): Promise<void> {
  const quietMs = opts.quietMs ?? SETTLE_QUIET_MS
  const timeout = opts.timeout ?? 45_000
  const required = [...(opts.requireGlb ?? [])]
  try {
    // ONE wait, not three. Checking "settled", then "the body is up", then "nothing failed" as
    // separate phases lets a remount start between them: the required id goes active while the
    // rest of the graph is still pending, the later phase passes, and the shot is taken
    // mid-load. `sceneReady` evaluates every clause in the same instant, in the page.
    await page.waitForFunction(
      ({ q, ids }) => window.GAME_TEST_API?.sceneReady(ids, q) === true,
      { q: quietMs, ids: required },
      { timeout, polling: 100 },
    )
  } catch (error) {
    // A bare "waitForFunction timed out" says nothing about WHY, and the answer is one call away.
    const readiness = await page
      .evaluate(() => window.GAME_TEST_API?.getAssetReadiness() ?? null)
      .catch(() => null)
    const stalled = readiness?.glbPending?.map((p) => `${p.id} x${p.pending}`).join(', ')
    throw new Error(
      `scene never became ready (required: ${required.join(', ') || 'none'})\n` +
        `still in flight: ${stalled || 'nothing'}\n` +
        `readiness: ${JSON.stringify(readiness)}\n${String(error)}`,
    )
  }
}

/** Boot the app and wait for the world — and its GLB bodies — to be real. */
export async function boot(page: Page, opts: SceneSettleOptions = {}): Promise<void> {
  await page.goto('/')
  await page.waitForFunction(() => window.GAME_TEST_API?.ready() === true, undefined, { timeout: 45_000 })
  await waitForSceneSettled(page, opts)
}

/**
 * Let the world reach its canonical pose, then pause it.
 *
 * Settled TWICE, on purpose. The first wait covers the remount that `resetGame()` /
 * `teleportPlayer()` triggered, so the dwell that follows measures a scene that exists; the
 * dwell is for the SIMULATION (walk cycles, traffic, fades) reaching a steady state, which is a
 * different thing from the asset graph being mounted; and the second wait covers the dwell
 * itself, because 2.6 s of walking can stream another sector in. The second call costs one quiet
 * window when nothing moved, and it is the one that actually describes the photograph.
 */
export async function settleAndPause(page: Page, opts: SceneSettleOptions = {}): Promise<void> {
  await waitForSceneSettled(page, opts)
  await page.waitForTimeout(2600)
  await waitForSceneSettled(page, opts)
  await page.evaluate(() => window.GAME_TEST_API!.pauseWorld(true))
  await page.waitForTimeout(700)
}

/**
 * An opaque, judgeable shot: occlusion off, scene settled and paused, then restored.
 *
 * The cardinal framings deliberately put the subject BEHIND the player on the camera ray, so
 * the shipped fade would make every facade half-transparent and unjudgeable. The fade itself is
 * proved separately, with occlusion ON, in its own block. Restoring in `finally` means a failed
 * assertion inside `body` cannot leak a disabled fade into the next test on the same page.
 */
export async function opaque(
  page: Page,
  body: () => Promise<void>,
  opts: SceneSettleOptions = {},
): Promise<void> {
  await page.evaluate(() => window.GAME_TEST_API!.setOcclusionEnabled(false))
  try {
    await settleAndPause(page, opts)
    await body()
  } finally {
    await page.evaluate(() => window.GAME_TEST_API!.setOcclusionEnabled(true))
  }
}

/** `checkFraming`, as an assertion carrying the measured numbers in its failure message. */
export function assertFramed(
  label: string,
  body: BodyDims,
  view: ViewName,
  gap: number,
  zoom: number,
  lookY: number,
  side: 'far' | 'near' = 'far',
): void {
  const c = checkFraming(body, view, gap, zoom, lookY, side)
  expect(c.ok, `${label}: ${c.reason} (span ${c.spanFraction}, centre ${c.centreOffset})`).toBe(true)
}

export * from './framing'
