/**
 * Model registry: runtime lookup layer over the asset manifest.
 *
 * Visual components ask for an asset by stable semantic id (through
 * LandmarkAsset); gameplay and colliders never touch this module — they read
 * layout data from cityLayout.ts, so a missing, disabled or broken GLB can
 * never affect simulation or physics.
 */
import { useGameStore } from '../store/useGameStore'
import { registry } from '../world/runtimeRegistry'
import {
  ASSET_MANIFEST,
  ASSET_MANIFEST_BY_ID,
  type AssetManifestEntry,
} from './assetManifest'

/** The manifest entry for a semantic id, or undefined when nothing is registered. */
export function getManifestEntry(assetId: string): AssetManifestEntry | undefined {
  return ASSET_MANIFEST_BY_ID.get(assetId)
}

/** True only when the entry both points at a file and is switched on. */
export function shouldLoadGlb(entry: AssetManifestEntry | undefined): entry is AssetManifestEntry {
  return Boolean(entry && entry.enabled && entry.glbPath)
}

/** Absolute URL for the entry's GLB, honouring Vite's base path. */
export function resolveGlbUrl(entry: AssetManifestEntry): string {
  return `${import.meta.env.BASE_URL}${entry.glbPath}`
}

/** True when a real (enabled) model is registered for this id. */
export function hasRealModel(assetId: string): boolean {
  return shouldLoadGlb(getManifestEntry(assetId))
}

/** All ids known to the manifest (for docs/tooling). */
export function listRegisteredAssetIds(): string[] {
  return ASSET_MANIFEST.map((e) => e.id)
}

/**
 * Dev-only load-failure log. Kept here so the warning format is uniform and
 * production builds stay silent.
 */
export function reportAssetLoadFailure(assetId: string, error: unknown): void {
  if (import.meta.env.DEV) {
    console.warn(
      `[assets] GLB for "${assetId}" failed to load — rendering procedural fallback.`,
      error,
    )
  }
}

/**
 * Record which body a landmark actually committed, and wake any UI that depends on it.
 *
 * Issue #44 Codex review: `hasRealModel()` reports the MANIFEST's intent, which is decided
 * before the file is ever fetched. A registered, enabled GLB still renders its procedural
 * fallback when the file is missing or corrupt, so callers that must not double up with that
 * fallback — the garage's painted rolling door — have to key off the real branch instead.
 */
function branchCounts(assetId: string): { expected: number; active: number; failed: number } {
  let c = registry.glbAssetState.get(assetId)
  if (!c) {
    c = { expected: 0, active: 0, failed: 0 }
    registry.glbAssetState.set(assetId, c)
  }
  return c
}

/**
 * One more instance of this id WANTS a GLB (issue #46 §4). Counted per asset so a stalled load
 * can be named: the global pending number says a scene is not ready, this says which body is
 * holding it up — which is the difference between a 45-second timeout and a diagnosis.
 */
export function noteGlbExpected(assetId: string, delta: 1 | -1): void {
  const c = branchCounts(assetId)
  c.expected += delta
  if (c.expected <= 0 && c.active <= 0 && c.failed <= 0) registry.glbAssetState.delete(assetId)
}

export function markGlbBranch(assetId: string, branch: 'active' | 'failed'): void {
  const before = getGlbBranch(assetId)
  branchCounts(assetId)[branch] += 1
  if (getGlbBranch(assetId) !== before) {
    useGameStore.setState((s) => ({ assetLoadVersion: s.assetLoadVersion + 1 }))
  }
}

/**
 * Release ONE instance's claim on a branch when that instance unmounts.
 *
 * Sector streaming remounts these constantly and one archetype backs several placements, so the
 * release has to be per instance and per branch (issue #46 §4). The previous
 * `clearGlbBranch(assetId)` deleted the whole entry, which meant one of four houses unmounting
 * told the world the other three were no longer rendering their GLB.
 */
export function releaseGlbBranch(assetId: string, branch: 'active' | 'failed'): void {
  const counts = registry.glbAssetState.get(assetId)
  if (!counts || counts[branch] <= 0) return
  const before = getGlbBranch(assetId)
  counts[branch] -= 1
  if (counts.expected <= 0 && counts.active <= 0 && counts.failed <= 0) {
    registry.glbAssetState.delete(assetId)
  }
  if (getGlbBranch(assetId) !== before) {
    useGameStore.setState((s) => ({ assetLoadVersion: s.assetLoadVersion + 1 }))
  }
}

/**
 * The branch this asset id is actually rendering, across every mounted instance:
 * 'active' if any instance committed the GLB, 'failed' if none did and at least one fell back,
 * `undefined` while every instance is still loading (or none is mounted).
 */
export function getGlbBranch(assetId: string): 'active' | 'failed' | undefined {
  const counts = registry.glbAssetState.get(assetId)
  if (!counts) return undefined
  if (counts.active > 0) return 'active'
  return counts.failed > 0 ? 'failed' : undefined
}

/**
 * True when the GLB body IS on screen for this id — at least one mounted instance has committed
 * its model.
 *
 * Exactly what the name says, and no more. This used to be `getGlbBranch(id) !== 'failed'`, which
 * also returned true while every instance was still LOADING (Suspense showing the fallback) and
 * for an id with nothing mounted at all — i.e. it answered true in the two states where the
 * procedural body is what a screenshot would catch. That was deliberate, but for a reason
 * belonging to a different question; see `suppressProceduralDouble` below.
 *
 * Use this for "is the model actually rendering". Use the other for "may I draw a stand-in".
 */
export function isGlbBodyRendering(assetId: string): boolean {
  if (!hasRealModel(assetId)) return false
  return getGlbBranch(assetId) === 'active'
}

/**
 * Should a repo-owned stand-in for this body be SUPPRESSED — the loading-tolerant policy.
 *
 * The garage's painted rolling door exists only because the procedural box has no door of its
 * own. Draw it whenever the GLB is not confirmed-on-screen and it flashes on top of the model's
 * real shutter for the frame or two Suspense takes on every sector remount, which is worse than
 * being briefly absent. So the policy is optimistic: suppress unless the load actually FAILED.
 *
 * Deliberately a separate, differently-named predicate from `isGlbBodyRendering`. The two
 * questions genuinely differ while loading, and collapsing them into one function meant the
 * honest-sounding name carried the optimistic answer.
 */
export function suppressProceduralDouble(assetId: string): boolean {
  if (!hasRealModel(assetId)) return false
  return getGlbBranch(assetId) !== 'failed'
}
