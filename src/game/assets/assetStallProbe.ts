/**
 * DEV-ONLY stage probe for ONE asset, for issue #47's shard 8 investigation.
 *
 * `getAssetReadiness()` and the network log both observe the stall from OUTSIDE the render: the
 * bytes arrive, and some time later the instance still has not committed. Neither can say where
 * between those two points it stopped, and the steps in between are distinct failures with distinct
 * fixes — GLTF parse/decode, Suspense resuming, the hook returning, the clone being built, React
 * committing, and the passive effect that publishes the branch.
 *
 * So this records a timestamp as each of those is reached, for `vehicle_compact_car_01` only. It is
 * a write-only ledger with a read-only accessor; nothing in the render or readiness path consults
 * it, so it cannot change behaviour.
 *
 * **What a MISSING marker does and does not prove.** If `hook-returned` is absent, the component
 * never got past `useGLTF` — which means parse, decode and Suspense-resume are ALL still
 * unresolved between them, and this probe cannot separate those three. It narrows the question to
 * "before the hook returned"; it does not answer it. Every other gap is a genuine separation,
 * because the stages either side of it are ordinary synchronous code.
 *
 * Absent from production: every call site is wrapped in `if (import.meta.env.DEV)`, which Vite
 * folds to `false` and drops, so neither these strings nor this module reach `dist/` — asserted by
 * the build gate the same way `GAME_TEST_API` is.
 */

/**
 * The assets under investigation. Deliberately a fixed list, not configurable.
 *
 * `vehicle_compact_car_01` is issue #47's shard-8 subject. `vehicle_sports_car_01` was added for
 * issue #50: it is the body whose readiness stalls locally, and the only one that loads a second
 * resource (its derived paint contribution map) before the model.
 */
export const STALL_PROBE_ASSET_IDS: readonly string[] = ['vehicle_compact_car_01', 'vehicle_sports_car_01']

/**
 * Render/commit milestones, in the order React reaches them.
 *
 * `hook-returned` is the first observable moment AFTER parse, decode and Suspense have all
 * succeeded — which is exactly why its absence leaves those three undistinguished.
 */
export type AssetStage =
  /**
   * Issue #50. The two stages BEFORE the model, for a body that loads a companion texture first.
   * `mask-render` is written on every render attempt of the component that requests it — including
   * the attempt that suspends — so its presence proves React reached the component at all.
   * `mask-returned` is written only once that loader hook has actually returned a texture, which is
   * the first moment the model's own request can be issued. A gap between the two isolates the
   * texture path; their absence isolates something before it.
   */
  | 'mask-render'
  | 'mask-returned'
  | 'hook-returned'
  | 'clone-built'
  | 'react-commit'
  | 'active-effect'

export interface AssetStageMark {
  assetId: string
  stage: AssetStage
  /**
   * Wall-clock `Date.now()` when the stage was reached.
   *
   * Deliberately NOT `performance.now()`: that is measured from the document's own time origin,
   * while the network timings this is read alongside are recorded by Playwright in the Node
   * process. Those are different origins and cannot be compared. Both sides record epoch
   * milliseconds and the reporter normalises everything to one `t0`.
   */
  epochMs: number
}

const marks: AssetStageMark[] = []

/** Record that `assetId` reached `stage`. No-op for every other asset. DEV call sites only. */
export function markAssetStage(assetId: string, stage: AssetStage): void {
  if (!STALL_PROBE_ASSET_IDS.includes(assetId)) return
  // The id is recorded now that more than one asset is probed; without it two bodies' timelines
  // would interleave into one indistinguishable list.
  marks.push({ assetId, stage, epochMs: Date.now() })
}

/** Read-only snapshot for the DEV test API. Never consulted by the render or readiness path. */
export function readAssetStageMarks(): AssetStageMark[] {
  return marks.map((m) => ({ ...m }))
}
