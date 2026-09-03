import type { BuildingDef } from '../world/worldTypes'
import type { OccluderDescriptor } from './visibilityTypes'
import { getManifestEntry, shouldLoadGlb } from '../assets/modelRegistry'
import { resolveBuildingVisual } from '../world/buildingProjection'
import { BUILDING_ROOF_EXTRA } from '../world/buildingMassing'

/**
 * Occluder descriptors are DERIVED from the same layout data that drives
 * rendering and colliders (BUILDINGS in cityLayout) — never authored by
 * hand, so visibility can't drift from world geometry.
 */

/** Buildings shorter than this can't meaningfully hide the subject. */
const MIN_OCCLUDER_HEIGHT = 3.5
export const MIN_OCCLUDER_HEIGHT_EXPORT_FOR_TESTS = MIN_OCCLUDER_HEIGHT

export const DEFAULT_MINIMUM_OPACITY = 0.25
/** Fast out (~0.25s to minimum), slower back (~0.6s to full). */
export const DEFAULT_FADE_SPEED = 3.2
export const DEFAULT_RESTORE_SPEED = 1.4

/**
 * Height of the GLB body a placement actually renders, in world units above the ground — or 0
 * when the procedural fallback is what stands here (issue #46 §3).
 *
 * The FOOTPRINT of an occluder is authored gameplay data and stays that way: `def.size` is the
 * collider, the routing obstacle and the anchor authority, and nothing here touches it. The
 * VERTICAL extent was a different question with a wrong answer. `maxY` came from
 * `def.size[1] + ROOF_EXTRA` alone, so a projected body taller than its authored box carried
 * mass occlusion detection could not see: the sight line passed OVER the descriptor's roof
 * while the real facade stood in front of it, no fade fired, and the player sat hidden behind
 * an opaque wall. Five shipped placements had that gap, up to 7.0 m of it
 * (`building_apartment_01`: a 15 m body over an 8 m box).
 *
 * Issue #46 §3 asks for an explicit choice between capping projections at the authored box and
 * driving `maxY` from what renders. This is that choice: DRIVE IT FROM THE RENDER. Capping
 * would re-scale six approved bodies to work around what the visibility system measures —
 * changing what the city looks like to fix a detection bug.
 *
 * `renderedTopY` is measured from the shipped bytes and recomputed by
 * `assets/cameraClearance.test.ts`, so it cannot drift from the file. The manifest's INTENT
 * (`shouldLoadGlb`) is consulted rather than the live load state: the descriptor stays a pure
 * function of authored data + manifest, memoized per `def`, and a body that fails to load
 * leaves a slightly generous occluder — which fades safely — instead of making visibility
 * depend on network timing.
 */
function projectedBodyTop(def: BuildingDef): number {
  const visual = resolveBuildingVisual(def)
  const entry = getManifestEntry(visual?.assetId ?? def.id)
  if (!shouldLoadGlb(entry) || entry.renderedTopY == null) return 0
  // Buildings.tsx nests the projection group AROUND the manifest primitive, so the
  // projection's Y scale and offset multiply the manifest-space top.
  return visual ? visual.offset[1] + visual.scale[1] * entry.renderedTopY : entry.renderedTopY
}

export function getBuildingOccluderDescriptor(def: BuildingDef): OccluderDescriptor {
  const [w, h, d] = def.size
  // A projected building reaches its manifest entry through `BuildingDef.visual`, so a lookup
  // on def.id alone silently missed every archetype placement's overrides.
  const manifest = getManifestEntry(resolveBuildingVisual(def)?.assetId ?? def.id)
  const override = manifest?.occlusion
  return {
    id: def.id,
    category: 'building',
    bounds2D: {
      minX: def.position[0] - w / 2,
      maxX: def.position[0] + w / 2,
      minZ: def.position[1] - d / 2,
      maxZ: def.position[1] + d / 2,
    },
    minY: 0,
    // The taller of the authored box (plus its roof slab) and the body actually on screen.
    maxY: Math.max(h + BUILDING_ROOF_EXTRA, projectedBodyTop(def)),
    fadeMode: override?.mode ?? 'wholeObject',
    minimumOpacity: override?.minimumOpacity ?? DEFAULT_MINIMUM_OPACITY,
    fadeSpeed: DEFAULT_FADE_SPEED,
    restoreSpeed: DEFAULT_RESTORE_SPEED,
    // Occluder PARTICIPATION stays keyed to the AUTHORED box: whether a placement takes part
    // in occlusion is a layout decision district certification already certifies, and a taller
    // visual must not silently enrol a building the city calls scenery.
    enabled: (override?.enabled ?? true) && h >= MIN_OCCLUDER_HEIGHT,
    excludeMaterialNames: override?.excludeMaterialNames,
  }
}

/** A decal group that visually belongs to a building fades with it. */
export function getLinkedOccluderDescriptor(
  id: string,
  linkedTo: string,
): OccluderDescriptor {
  return {
    id,
    category: 'building',
    bounds2D: { minX: 0, maxX: 0, minZ: 0, maxZ: 0 }, // never detected itself
    minY: 0,
    maxY: 0,
    fadeMode: 'wholeObject',
    minimumOpacity: DEFAULT_MINIMUM_OPACITY,
    fadeSpeed: DEFAULT_FADE_SPEED,
    restoreSpeed: DEFAULT_RESTORE_SPEED,
    enabled: true,
    linkedTo,
  }
}
