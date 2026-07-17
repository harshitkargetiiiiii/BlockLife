import type { PropType } from './worldTypes'

/**
 * Prop solidity table — a LEAF module with no runtime imports, so both
 * solidFootprints (occupancy/colliders) and the authoring kit compiler
 * (footprint-aware scatter avoidance) can read it without an import cycle
 * through cityLayout.
 */
export interface SolidSpec {
  /** Collider half-extents [hx, hy, hz]; null = decorative, never solid. */
  half: [number, number, number] | null
  /** Optional footprint center offset [dx, dz] from the prop position. */
  offset?: [number, number]
}

export const PROP_SOLIDITY: Record<PropType, SolidSpec> = {
  street_lamp: { half: [0.12, 2, 0.12] },
  tree: { half: [0.22, 1, 0.22] },
  park_tree: { half: [0.22, 1, 0.22] },
  bench: { half: [0.95, 0.5, 0.35] },
  trash_can: { half: [0.32, 0.5, 0.32] },
  hydrant: { half: [0.2, 0.35, 0.2] },
  planter: { half: [0.7, 0.3, 0.3] },
  street_planter: { half: [0.7, 0.3, 0.3] },
  parked_car: { half: [1, 0.6, 2] },
  parked_truck: { half: [1.15, 1, 2.3] },
  bollard: { half: [0.12, 0.45, 0.12] },
  cone: { half: [0.22, 0.3, 0.22] },
  utility_box: { half: [0.38, 0.5, 0.28] },
  stop_sign: { half: [0.08, 1.25, 0.08] },
  crate: { half: [0.62, 0.55, 0.5], offset: [0.2, 0.1] },
  barrel: { half: [0.38, 0.45, 0.38] },
  signboard: { half: [0.36, 0.5, 0.22] },
  flower_pot: { half: [0.18, 0.22, 0.18] },
  dumpster: { half: [0.95, 0.6, 0.5] },
  table_set: { half: [0.55, 0.4, 0.55] },
  // Flat decals and wall-mounted flavor — intentionally walkable.
  ac_unit: { half: null },
  manhole: { half: null },
  drain: { half: null },
  pallet: { half: null },
  porch_light: { half: null },
}
