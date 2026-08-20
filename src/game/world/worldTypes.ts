import type { MaterialVariant } from '../assets/assetVariants'

export type WorldMood = 'morning' | 'afternoon' | 'evening' | 'night'

export type Vec3 = [number, number, number]
export type Vec2 = [number, number]

export interface BuildingDef {
  /** Stable semantic asset id, used by the model registry for future GLB swaps. */
  id: string
  /** Center position on the ground plane. */
  position: Vec2
  /** Width (x), height (y), depth (z). */
  size: Vec3
  color: string
  roofColor: string
  /** Human readable label rendered as a floating sign. Omit for backdrop buildings. */
  label?: string
  labelColor?: string
  /** Which side the door faces: +z is 'south'. */
  door?: 'north' | 'south' | 'east' | 'west'
  /** Accent color for door awning / trim. */
  accentColor?: string
  /** Skip windows (e.g. kiosk-like structures). */
  windows?: boolean
  /**
   * Optional GLB palette variant (issue #21 §6): recolors this instance's declared
   * wall/trim material slots so a REUSED archetype (e.g. office ↔ backdrop tower, both
   * Building_Large_2) reads as a different building. Purely cosmetic — the collider,
   * occluder and entrance derive from layout data, never from this.
   */
  paletteVariant?: MaterialVariant
  /**
   * Optional reusable-archetype visual projection (issue #25): render a shared archetype
   * GLB (`visual.assetId`) in place of this id's, fitted per-placement. PURELY VISUAL —
   * resolved (buildingProjection.ts) to a nested position/rotation/scale applied to the
   * GLB primitive + its asset-local overlays ONLY. The procedural fallback and every
   * gameplay read (collision/occlusion/routing/anchors/footprint/coords) ignore it;
   * `id`/`size`/`position` stay authoritative.
   */
  visual?: BuildingVisualProjection
}

/** Reusable-archetype visual projection (issue #25). See buildingProjection.ts. */
export interface BuildingVisualProjection {
  /** Archetype manifest id whose GLB renders in place of this building's id. */
  assetId: string
  /** Authored footprint the archetype GLB is calibrated to; visual scale = clamp(size/reference). */
  referenceSize: Vec3
  /** Direction the model's front points as authored (default 'south' = +z). */
  canonicalFacing?: 'north' | 'south' | 'east' | 'west'
  /** Max per-axis visual scale deviation from 1 (default 0.15); beyond → clamped (documented fit). */
  maxScaleDeviation?: number
  /** Visual-only offset (default [0,0,0]); never moves colliders/anchors. */
  visualOffset?: Vec3
  /** Per-instance wall/trim recolor (from authored colors); shared immutably per palette. */
  paletteVariant?: MaterialVariant
}

export type PropType =
  | 'street_lamp'
  | 'tree'
  | 'park_tree'
  | 'bench'
  | 'trash_can'
  | 'hydrant'
  | 'planter'
  | 'parked_car'
  // Decorative GLB street props (Quaternius) — no colliders by design.
  | 'ac_unit'
  | 'bollard'
  | 'street_planter'
  | 'manhole'
  | 'drain'
  // Procedural district props (City Expansion v1) — decorative, no colliders.
  | 'cone'
  | 'utility_box'
  | 'stop_sign'
  // City Life Density v1: street-life texture props.
  | 'parked_truck'
  | 'crate'
  | 'barrel'
  | 'pallet'
  | 'dumpster'
  | 'signboard'
  | 'table_set'
  | 'flower_pot'
  | 'porch_light'

export interface PropDef {
  id: string
  type: PropType
  position: Vec2
  rotationY?: number
  color?: string
}

export interface AmbientCarDef {
  id: string
  color: string
  /** Road lane (from traffic data) this car drives. */
  laneId: string
  /** Cruise speed as a fraction of the lane's speed limit. */
  speedFactor: number
  /** Starting waypoint index offset so cars spread out. */
  startIndex: number
  /**
   * Cross-District Routing v1: cars with a route mode drive the road graph
   * instead of their legacy loop. Absent = localLoop (the safe default).
   */
  routeMode?: 'crossDistrict' | 'throughTraffic'
  /** Assigned initial spawn anchor (graph spawn point id). */
  routeSpawnId?: string
  /** Light vehicle-class metadata (speed/turn tuning hooks, future lanes). */
  vehicleClass?: 'compact' | 'sedan' | 'van' | 'truck'
}

/** [r, g, b] each 0..1 */
export type RGB = [number, number, number]

export interface LightingState {
  skyColor: RGB
  sunColor: RGB
  sunIntensity: number
  ambientColor: RGB
  ambientIntensity: number
  hemiIntensity: number
}
