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
export function markGlbBranch(assetId: string, branch: 'active' | 'failed'): void {
  if (registry.glbAssetState.get(assetId) === branch) return
  registry.glbAssetState.set(assetId, branch)
  useGameStore.setState((s) => ({ assetLoadVersion: s.assetLoadVersion + 1 }))
}

/** Forget a branch when the instance unmounts (sector streaming remounts these constantly). */
export function clearGlbBranch(assetId: string): void {
  if (!registry.glbAssetState.delete(assetId)) return
  useGameStore.setState((s) => ({ assetLoadVersion: s.assetLoadVersion + 1 }))
}

/**
 * True when the GLB body — not the procedural fallback — is what is on screen for this id.
 *
 * Loading counts as "will render": Suspense is showing the fallback for a frame or two and the
 * model normally arrives, so treating it as fallback would flash a duplicate door on every
 * sector remount. Only a real load FAILURE flips this to false.
 */
export function isGlbBodyRendering(assetId: string): boolean {
  if (!hasRealModel(assetId)) return false
  return registry.glbAssetState.get(assetId) !== 'failed'
}
