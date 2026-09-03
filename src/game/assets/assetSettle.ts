/**
 * Asset-settle policy (issue #46 §4).
 *
 * How long the GLB landmark mount graph must stay UNCHANGED before a scene counts as settled.
 *
 * The counters in `runtimeRegistry` (`glbLandmarksExpected/Active/Failed`) describe a moment,
 * and a moment cannot distinguish "everything mounted and committed" from "between scenes": a
 * sector remount tears the old instances down before the new ones register, so the counters
 * pass through a trough where `expected <= active + failed` is trivially true. Visual baselines
 * were captured inside that trough, recording a procedural fallback where the GLB belongs.
 * Requiring a quiet window closes it, because any teardown or mount moves the graph.
 *
 * 400 ms is a little over 24 frames at 60 Hz and comfortably longer than the React commit +
 * `useGLTF` cache-hit path that a remount runs through, while staying short enough that it
 * costs a visual spec well under a second. Both the DEV test API and the shared visual helper
 * read it from here, so the gate is one number rather than a constant copied into each spec.
 *
 * The quiet window is necessary but NOT sufficient on its own, which is why the counters have to
 * be a live census rather than a tally. An error boundary that incremented `failed` and never
 * released it on unmount left the count behind; a fresh, SLOW remount then read
 * `expected: 1, active: 0, failed: 1 (stale)` — "nothing pending" — and, because a slow network
 * is precisely the case where the mount graph sits still, the quiet window elapsed and the gate
 * opened on a scene that was still loading. Both boundaries now release their failure on unmount
 * (see `AssetErrorBoundary`), and `isAssetGraphSettled` is unit-tested against that exact
 * sequence.
 */
export const ASSET_SETTLE_QUIET_MS = 400

/** The GLB mount-graph census the settle gate reads. */
export interface AssetGraphCounters {
  /** Mounted instances that want a GLB. */
  expected: number
  /** Of those, how many have committed their model to the scene. */
  active: number
  /** Of those, how many are currently rendering their procedural fallback after a load failure. */
  failed: number
  /** Monotonic change counter; 0 means no landmark has ever mounted. */
  epoch: number
  /** Timestamp (same clock as `now`) of the last change to the graph. */
  changedAt: number
  /** `unresolvedInstances(...)` — what readiness actually waits on. */
  unresolved: number
}

/** RAW census: instances that have neither committed nor failed. */
export function assetGraphPending(c: AssetGraphCounters): number {
  return c.expected - c.active - c.failed
}

/** Per-asset instance census, keyed by manifest id. */
export interface AssetInstanceCounts {
  expected: number
  active: number
  failed: number
}

/**
 * Instances that are genuinely still in flight — the number readiness must wait on.
 *
 * Not simply `expected - active - failed`, because of a real runtime state that number gets
 * wrong. When a GLB's file is unreachable, MOST of its instances throw and are counted as
 * `failed`, but a minority stay suspended indefinitely: drei caches the load, and a component
 * that suspended on the in-flight promise is never re-rendered to throw. Measured on a
 * deliberately-aborted file: 22 of 24 trash bins failed, 2 sat suspended, and the mount graph
 * then held perfectly still for 37 seconds.
 *
 * Those two are not "loading". Suspense is showing the procedural fallback for them, which is the
 * SAME pixels their 22 failed siblings show, and nothing will ever change it. The scene is
 * settled; only the raw subtraction disagrees.
 *
 * So an id with a failed instance is resolved: its file is unreachable, and every instance of it
 * renders the fallback either way. This is narrower than it looks — it keys off THAT id having
 * actually failed, so it cannot mask the regression it would otherwise resemble: a stale failure
 * left behind by an unmounted instance hiding a genuinely loading NEW instance. Those counts are
 * released on unmount (`AssetErrorBoundary`), so such an id has `failed: 0` and its pending
 * instance still blocks.
 */
export function unresolvedInstances(perAsset: Iterable<readonly [string, AssetInstanceCounts]>): number {
  let unresolved = 0
  for (const [, c] of perAsset) {
    if (c.failed > 0) continue
    unresolved += Math.max(0, c.expected - c.active - c.failed)
  }
  return unresolved
}

/**
 * Is the scene on screen mounted AND finished changing?
 *
 * All three terms are load-bearing:
 *  - `epoch > 0` — something has actually mounted. Without it the predicate is true at boot,
 *    before any landmark has registered, which is the same vacuity in a different disguise.
 *  - `unresolved === 0` — nothing is still in flight, counted per asset so that an id whose file
 *    is unreachable does not block on instances that will never resolve (see
 *    `unresolvedInstances`).
 *  - `assetGraphPending(c) >= 0` — the raw census is not CORRUPT. A negative means more instances
 *    have committed or failed than are mounted, which is not a settled scene but broken
 *    accounting — precisely the shape a leaked `failed` produced. Refusing it means a future
 *    bookkeeping bug fails loudly (a spec times out) instead of silently photographing a
 *    half-built scene.
 *  - quiescence — the graph has held still for `quietMs`. This is what a remount trough cannot
 *    satisfy: tearing the old instances down and registering the new ones both move the graph.
 */
export function isAssetGraphSettled(
  c: AssetGraphCounters,
  now: number,
  quietMs: number = ASSET_SETTLE_QUIET_MS,
): boolean {
  return c.epoch > 0 && c.unresolved === 0 && assetGraphPending(c) >= 0 && now - c.changedAt >= quietMs
}

/** Which asset ids are currently rendering which branch, counted across every mounted instance. */
export interface AssetBranchLists {
  /** Ids with at least one instance whose GLB committed. */
  glbActive: readonly string[]
  /** Ids with at least one instance rendering its procedural fallback after a load failure. */
  glbFailed: readonly string[]
}

/**
 * Is the scene READY to photograph: settled AND showing the bodies the shot is about?
 *
 * ONE predicate, deliberately. Checking "settled" and "the body is up" as two separate waits
 * lets a remount start between them — the required id goes active while the rest of the graph is
 * still pending, the second wait passes, and the shot is taken mid-load. Evaluating both in the
 * same instant closes that.
 *
 * `glbActive` and `glbFailed` are independent, not an either/or: `arch_house_01` backs four
 * placements, so it can legitimately be BOTH — three committed, one fell back — and a shot that
 * names it must not pass while a procedural house is in frame. So a required id has to be active
 * AND not failed.
 */
export function isSceneReady(
  c: AssetGraphCounters,
  branches: AssetBranchLists,
  now: number,
  required: readonly string[] = [],
  quietMs: number = ASSET_SETTLE_QUIET_MS,
): boolean {
  if (!isAssetGraphSettled(c, now, quietMs)) return false
  return required.every((id) => branches.glbActive.includes(id) && !branches.glbFailed.includes(id))
}
