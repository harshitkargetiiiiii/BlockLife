import type { BuildingDef } from '../world/worldTypes'
import type { OccluderDescriptor } from './visibilityTypes'
import { getManifestEntry } from '../assets/modelRegistry'

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

/** Extra roof/parapet height above the layout box (matches BuildingMesh). */
const ROOF_EXTRA = 0.5

export function getBuildingOccluderDescriptor(def: BuildingDef): OccluderDescriptor {
  const [w, h, d] = def.size
  const manifest = getManifestEntry(def.id)
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
    maxY: h + ROOF_EXTRA,
    fadeMode: override?.mode ?? 'wholeObject',
    minimumOpacity: override?.minimumOpacity ?? DEFAULT_MINIMUM_OPACITY,
    fadeSpeed: DEFAULT_FADE_SPEED,
    restoreSpeed: DEFAULT_RESTORE_SPEED,
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
