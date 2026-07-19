/**
 * World Integrity & City Certification Platform v1 — the semantic entity
 * contract. ONE typed descriptor shape every runtime world entity is mirrored
 * into so occupancy, anomaly detection, and certification can reason about
 * "every actor" without knowing which component/runtime produced it.
 *
 * This is deliberately NOT an ECS: descriptors carry IDs/positions/scalars/
 * footprints/capabilities ONLY — never React components, refs, Three.js
 * objects, Rapier bodies, materials, or scene nodes (see registry constraints
 * in docs/WORLD_INTEGRITY_AND_CERTIFICATION.md). Existing runtimes remain the
 * mutation authority; the registry is a mirror + query surface.
 */

/** High-level entity kinds — must cover every live actor + static solid. */
export type EntityKind =
  // people
  | 'player'
  | 'ambient_citizen'
  | 'named_npc'
  | 'police_officer'
  | 'ejected_driver'
  | 'interior_civilian' // cashier / store customer / routed civilian
  // vehicles
  | 'driven_vehicle'
  | 'ambient_vehicle'
  | 'parked_vehicle' // parked / stealable / getaway / mission-identity
  | 'police_vehicle'
  // static world
  | 'building'
  | 'prop'
  // authored positions requiring validation
  | 'anchor' // interaction / mission / spawn anchor
  | 'world_ui' // world-space UI producer (bubble / label)

/** Person sub-kinds share the universal occupancy contract. */
export const PERSON_KINDS = [
  'player',
  'ambient_citizen',
  'named_npc',
  'police_officer',
  'ejected_driver',
  'interior_civilian',
] as const
export type PersonKind = (typeof PERSON_KINDS)[number]

/** Vehicle sub-kinds share the oriented-footprint obstacle model. */
export const VEHICLE_KINDS = [
  'driven_vehicle',
  'ambient_vehicle',
  'parked_vehicle',
  'police_vehicle',
] as const
export type VehicleKind = (typeof VEHICLE_KINDS)[number]

export function isPersonKind(kind: EntityKind): kind is PersonKind {
  return (PERSON_KINDS as readonly string[]).includes(kind)
}
export function isVehicleKind(kind: EntityKind): kind is VehicleKind {
  return (VEHICLE_KINDS as readonly string[]).includes(kind)
}

/**
 * Declared capabilities. A solid building automatically receives collision,
 * occlusion, occupancy-obstacle, streaming ownership and certification — an
 * author never re-remembers each integration point. Opting out is explicit and
 * validated (see `capabilityOptOut`).
 */
export type EntityCapability =
  | 'renderable'
  | 'solid' // collider-backed
  | 'occupancy' // participates in person occupancy resolution (as mover or obstacle)
  | 'navObstacle' // pedestrian/vehicle routing obstacle
  | 'occluder'
  | 'streamed'
  | 'lit' // lighting / weather participant
  | 'interactable'
  | 'worldUi' // world-space UI producer requiring viewport-bounds checks
  | 'certifiable'

/** Axis-aligned ground footprint (buildings, props, sectors). */
export interface Footprint2D {
  minX: number
  maxX: number
  minZ: number
  maxZ: number
}

/** Oriented box footprint on the ground plane (vehicles). */
export interface OrientedBox2D {
  x: number
  z: number
  halfLength: number // along heading
  halfWidth: number // across heading
  headingY: number // radians, atan2(dx,dz)
}

/**
 * A registered world entity. Created on register/update — NOT per frame — so
 * the small allocation of `capabilities`/footprints is amortized. Positions and
 * `moving`/`headingY` are refreshed by adapters each integrity tick.
 */
export interface EntityDescriptor {
  /** Stable semantic id (matches the owning runtime's id). */
  id: string
  kind: EntityKind
  /** Owning sector id, or null when interior-owned / global (player). */
  sectorId: string | null
  /** Interior id when the entity lives in an off-grid interior scene. */
  interiorId?: string
  x: number
  z: number
  /** Facing heading (radians) where meaningful. */
  headingY?: number
  /** Circular occupancy radius (people). */
  radius?: number
  /** AABB solid/occupancy footprint (buildings, solid props). */
  footprint?: Footprint2D
  /** Oriented footprint (vehicles) — takes precedence over `footprint`. */
  oriented?: OrientedBox2D
  /** Visual bounds (props) — may exceed the collision footprint (overhangs). */
  visualBounds?: Footprint2D
  /** Vertical interval [minY, maxY] where relevant (occlusion, support). */
  minY?: number
  maxY?: number
  /** Whether the actor is moving this tick (occupancy priority). */
  moving?: boolean
  /** Declared capabilities (deterministic order). */
  capabilities: readonly EntityCapability[]
  /** Debug/source reference (file:symbol or runtime origin). */
  sourceRef?: string
  /** Mount/generation identity — stale cleanup cannot remove a newer instance. */
  generation?: number
}

/** Default capabilities per kind — the "automatic parity" contract. */
export function defaultCapabilitiesForKind(kind: EntityKind): readonly EntityCapability[] {
  switch (kind) {
    case 'player':
      return ['renderable', 'occupancy']
    case 'ambient_citizen':
    case 'named_npc':
    case 'police_officer':
    case 'ejected_driver':
    case 'interior_civilian':
      return ['renderable', 'occupancy']
    case 'driven_vehicle':
    case 'ambient_vehicle':
    case 'parked_vehicle':
    case 'police_vehicle':
      return ['renderable', 'solid', 'occupancy', 'navObstacle']
    case 'building':
      return ['renderable', 'solid', 'occupancy', 'navObstacle', 'occluder', 'streamed', 'lit', 'certifiable']
    case 'prop':
      return ['renderable', 'streamed', 'certifiable']
    case 'anchor':
      return ['certifiable']
    case 'world_ui':
      return ['worldUi']
  }
}

export function hasCapability(desc: EntityDescriptor, cap: EntityCapability): boolean {
  return desc.capabilities.includes(cap)
}

/** Center of an entity's occupancy footprint as [x, z]. */
export function entityCenter(desc: EntityDescriptor): [number, number] {
  return [desc.x, desc.z]
}
