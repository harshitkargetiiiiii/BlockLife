import type { Object3D } from 'three'
import { LANDMARK_GLB_ROOT_MARKER } from './variantCacheOwnership'

/**
 * DEV/test reader: which GLB body, if any, is mounted under ONE authored placement.
 *
 * `getAssetReadiness().glbActive` is keyed by MANIFEST ASSET id and aggregated over every placement
 * that draws it, so it cannot say whether a particular reused-archetype placement (Meridian Tower
 * drawing `building_apartment_01`, say) shows its body — and a placement id is never in that list
 * at all. This walks the placement's own scene group (Buildings / Props name it by `def.id`) for the
 * DEV-only `LANDMARK_GLB_ROOT_MARKER` that LandmarkAsset stamps on each instance's cloned GLB root.
 * An empty list means the procedural fallback is what stands there. Never read by the simulation.
 */
export function readPlacementBody(
  scene: Object3D | null,
  placementId: string,
): { found: boolean; glbAssetIds: string[] } {
  const root = scene?.getObjectByName(placementId)
  if (!root) return { found: false, glbAssetIds: [] }
  const ids = new Set<string>()
  root.traverse((o) => {
    const marker = o.userData?.[LANDMARK_GLB_ROOT_MARKER]
    if (typeof marker === 'string') ids.add(marker)
  })
  return { found: true, glbAssetIds: [...ids].sort() }
}
