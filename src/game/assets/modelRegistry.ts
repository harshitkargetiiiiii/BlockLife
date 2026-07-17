/**
 * Model registry: runtime lookup layer over the asset manifest.
 *
 * Visual components ask for an asset by stable semantic id (through
 * LandmarkAsset); gameplay and colliders never touch this module — they read
 * layout data from cityLayout.ts, so a missing, disabled or broken GLB can
 * never affect simulation or physics.
 */
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
