import { BUILDINGS, JOB_KIOSK, PROPS } from '../world/cityLayout'
import { resolveBuildingVisual } from '../world/buildingProjection'
import type { BuildingDef } from '../world/worldTypes'
import { ASSET_MANIFEST_BY_ID } from './assetManifest'
import { variantCacheKey } from './variantMaterialCache'
import type { VariantCacheExpectation } from './variantCacheOwnership'

/**
 * Issue #67 — the variant-cache combinations the AUTHORED city is allowed to create, derived from layout data and
 * manifest declarations alone (never from a running cache or the currently mounted subset).
 *
 * A placement shares a cached tinted set only when it carries a visual projection (a direct own-row landmark such as
 * Nook Offices, the gym or the tower keeps the isolated per-instance path), the row it projects onto is loadable
 * (enabled with a GLB path — a disabled row renders its fallback and never reaches the cache), and that row declares
 * at least one recolorable slot material. The key follows the authored palette: the projection's own, else the
 * placement's; an absent palette is `∅`.
 */

/**
 * Issue #25 Stage A's two calibration GLBs (`docs/ASSET_STYLE_BIBLE.md` "Stage A scope"). They must never own a shared
 * variant entry or render a cached material — a named invariant of these assets, not a consequence of today's data.
 */
export const VARIANT_CACHE_NO_CACHE_ASSET_IDS: readonly string[] = Object.freeze(['arch_residential_house_01', 'prop_job_kiosk_01'])

function declaredNames(slotMap: Record<string, string[]> | undefined): string[] {
  return slotMap ? [...new Set(Object.values(slotMap).flat())].sort() : []
}

export function deriveVariantCacheExpectations(buildings: readonly BuildingDef[] = BUILDINGS): VariantCacheExpectation[] {
  const byKey = new Map<string, { assetId: string; materialNames: string[]; placementIds: string[] }>()
  for (const def of buildings) {
    const visual = resolveBuildingVisual(def)
    if (!visual) continue
    const entry = ASSET_MANIFEST_BY_ID.get(visual.assetId)
    if (!entry?.enabled || !entry.glbPath) continue
    const materialNames = declaredNames(entry.materialSlots)
    if (!entry.materialSlots || materialNames.length === 0) continue
    const key = variantCacheKey(visual.assetId, entry.materialSlots, visual.paletteVariant ?? def.paletteVariant)
    const found = byKey.get(key) ?? { assetId: visual.assetId, materialNames, placementIds: [] }
    found.placementIds.push(def.id)
    byKey.set(key, found)
  }
  return [...byKey.entries()]
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([key, e]) => Object.freeze({ key, assetId: e.assetId, materialNames: Object.freeze(e.materialNames), placementIds: Object.freeze([...e.placementIds].sort()) }))
}

/**
 * The slot groups the usage scan reads: every row that declares slot materials (so a direct landmark rendering a
 * cached material is caught) plus the no-cache assets (so they are scanned even though they declare none).
 */
export function variantCacheScannedAssetIds(): Set<string> {
  const out = new Set<string>(VARIANT_CACHE_NO_CACHE_ASSET_IDS)
  for (const entry of ASSET_MANIFEST_BY_ID.values()) if (declaredNames(entry.materialSlots).length > 0) out.add(entry.id)
  return out
}

/**
 * Every authored placement id a slot can render under: buildings (compiled lots included), street props (the `Props`
 * wrapper group is named `def.id`, for central, compiled and gateway props alike) and the job kiosk (`JOB_KIOSK.id`).
 * The usage scan attributes each slot to the nearest of these, so repeated props of one asset stay distinct authored
 * placements instead of collapsing into `(unplaced)`.
 */
export function variantCacheAuthoredPlacementIds(): Set<string> {
  return new Set([...BUILDINGS.map((b) => b.id), ...PROPS.map((p) => p.id), JOB_KIOSK.id])
}
