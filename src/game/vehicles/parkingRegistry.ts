/**
 * Authored parking-anchor registry (Vehicle Ownership v1, issue #19 §5/§14). ONE validated
 * set of the places an owned vehicle may legitimately sit — residence spots, dealership,
 * service, impound, recovery, and public lots across districts. Parking is an AUTHORED
 * interaction (never "save anywhere"): a vehicle is stopped, nearby, size-compatible, and the
 * anchor is clear + streamed. Anchors carry a footprint so the runtime enforces one-vehicle-
 * per-anchor and world-integrity validates no overlap with roads/entrances/other anchors.
 */
import type { Vec2 } from '../world/worldTypes'
import type { ParkingSizeClass } from './vehicleRegistry'

export type ParkingCategory = 'residence' | 'dealership' | 'service' | 'impound' | 'recovery' | 'public'

export interface ParkingAnchor {
  id: string
  /** World position (x, z) the parked vehicle centres on. */
  position: Vec2
  /** Facing (radians) the parked vehicle takes. */
  headingY: number
  district: string
  category: ParkingCategory
  /** Largest vehicle size this bay accepts (a bay for `large` also fits smaller). */
  maxSize: ParkingSizeClass
  /** Half-extents of the clearance footprint (metres) — one vehicle per anchor. */
  halfLength: number
  halfWidth: number
  /** For residence anchors: the property whose entrance this belongs to. */
  propertyId?: string
  sourceRef: { file: string; symbol: string }
}

const SRC = (symbol: string) => ({ file: 'src/game/vehicles/parkingRegistry.ts', symbol })

const SIZE_ORDER: ParkingSizeClass[] = ['small', 'standard', 'large']
/** Does a bay of `bay` size accept a vehicle of `need` size? (larger bays fit smaller cars). */
export function parkingSizeFits(bay: ParkingSizeClass, need: ParkingSizeClass): boolean {
  return SIZE_ORDER.indexOf(bay) >= SIZE_ORDER.indexOf(need)
}

// Residence anchors sit on the street just off each authored home exit (validated-clear spots
// the game already spawns the player at). Public/dealership/service/impound/recovery reuse the
// open, non-overlapping curb spots proven clear by the existing stealable-vehicle authoring.
// Central anchors are proven clear of every building/prop by the parking test's isPointClear
// sweep (deterministic, headless). Far-sector residence/public anchors sit a few metres off each
// authored home street-exit (spots the game already spawns the player at) and are confirmed on
// clear ground by the V6 visual parking baselines. See validateParkingRegistry + parkingRegistry.test.
export const PARKING_ANCHORS: readonly ParkingAnchor[] = [
  // ---- residence (one per housing tier — §5), just off each authored home street-exit ----
  { id: 'park_home_studio', position: [-10, -6], headingY: Math.PI / 2, district: 'Central Residential', category: 'residence', maxSize: 'large', halfLength: 2.6, halfWidth: 1.3, propertyId: 'starter_studio', sourceRef: SRC('park_home_studio') },
  { id: 'park_home_loft', position: [45.5, -84], headingY: Math.PI / 2, district: 'Downtown Gateway', category: 'residence', maxSize: 'large', halfLength: 2.6, halfWidth: 1.3, propertyId: 'city_loft', sourceRef: SRC('park_home_loft') },
  { id: 'park_home_premium', position: [235.5, -90], headingY: Math.PI / 2, district: 'East Residential', category: 'residence', maxSize: 'large', halfLength: 2.6, halfWidth: 1.3, propertyId: 'premium_apartment', sourceRef: SRC('park_home_premium') },
  // ---- dealership delivery/trade bays (§4) — a spaced cluster in the open Central Retail block ----
  { id: 'park_dealer_a', position: [24, 10], headingY: 0, district: 'Central Retail', category: 'dealership', maxSize: 'large', halfLength: 2.6, halfWidth: 1.3, sourceRef: SRC('park_dealer_a') },
  { id: 'park_dealer_b', position: [30, 10], headingY: 0, district: 'Central Retail', category: 'dealership', maxSize: 'large', halfLength: 2.6, halfWidth: 1.3, sourceRef: SRC('park_dealer_b') },
  // ---- service / customization (§7/§9) ----
  { id: 'park_service', position: [24, 16], headingY: 0, district: 'Central Retail', category: 'service', maxSize: 'large', halfLength: 2.6, halfWidth: 1.3, sourceRef: SRC('park_service') },
  // ---- safe fallback / recovery (§5) ----
  { id: 'park_recovery', position: [30, 16], headingY: 0, district: 'Central Retail', category: 'recovery', maxSize: 'large', halfLength: 2.6, halfWidth: 1.3, sourceRef: SRC('park_recovery') },
  // ---- police impound (§7) — well clear of the retail cluster ----
  { id: 'park_impound', position: [10, 28], headingY: Math.PI / 2, district: 'Central Civic', category: 'impound', maxSize: 'large', halfLength: 2.6, halfWidth: 1.3, sourceRef: SRC('park_impound') },
  // ---- public parking across distinct districts (>=3 — §5) ----
  { id: 'park_public_central', position: [24, 22], headingY: Math.PI / 2, district: 'Central Retail', category: 'public', maxSize: 'large', halfLength: 2.6, halfWidth: 1.3, sourceRef: SRC('park_public_central') },
  { id: 'park_public_downtown', position: [52, -78], headingY: Math.PI / 2, district: 'Downtown Gateway', category: 'public', maxSize: 'large', halfLength: 2.6, halfWidth: 1.3, sourceRef: SRC('park_public_downtown') },
  { id: 'park_public_east', position: [242, -84], headingY: Math.PI / 2, district: 'East Residential', category: 'public', maxSize: 'large', halfLength: 2.6, halfWidth: 1.3, sourceRef: SRC('park_public_east') },
]

const BY_ID: Record<string, ParkingAnchor> = Object.fromEntries(PARKING_ANCHORS.map((a) => [a.id, a]))

export function getParkingAnchor(id: string): ParkingAnchor | undefined {
  return BY_ID[id]
}

/** The residence parking anchor for a property, if any (migration + housing parking — §5). */
export function residenceAnchorFor(propertyId: string): ParkingAnchor | undefined {
  return PARKING_ANCHORS.find((a) => a.category === 'residence' && a.propertyId === propertyId)
}

export function anchorsInCategory(category: ParkingCategory): ParkingAnchor[] {
  return PARKING_ANCHORS.filter((a) => a.category === category)
}

/** The dealership's first delivery bay — a bought vehicle's initial parking (§4). */
export const DEALERSHIP_ANCHOR_IDS = ['park_dealer_a', 'park_dealer_b'] as const
export const RECOVERY_ANCHOR_ID = 'park_recovery'
export const IMPOUND_ANCHOR_ID = 'park_impound'
export const SERVICE_ANCHOR_ID = 'park_service'

/**
 * Registry validation (§5/§14): unique ids, every required category present, valid sizes +
 * positive footprints, and NO two anchors' footprints overlap (so one-vehicle-per-anchor is
 * physically honoured). World-vs-anchor overlap (anchors clear of building/prop solids) is
 * asserted separately in the parking TEST against the live world solidity registry; this
 * function is pure so it also runs in the headless registry test.
 */
export function validateParkingRegistry(): string[] {
  const errors: string[] = []
  const seen = new Set<string>()
  const cats = new Set<ParkingCategory>()
  for (const a of PARKING_ANCHORS) {
    if (seen.has(a.id)) errors.push(`${a.id}: duplicate anchor id`)
    seen.add(a.id)
    cats.add(a.category)
    if (!(a.halfLength > 0) || !(a.halfWidth > 0)) errors.push(`${a.id}: non-positive footprint`)
    if (a.category === 'residence' && !a.propertyId) errors.push(`${a.id}: residence anchor missing propertyId`)
    for (const b of PARKING_ANCHORS) {
      if (b === a || b.id <= a.id) continue // check each unordered pair once
      const d = Math.hypot(b.position[0] - a.position[0], b.position[1] - a.position[1])
      const minGap = Math.max(a.halfLength, a.halfWidth) + Math.max(b.halfLength, b.halfWidth)
      if (d < minGap) errors.push(`${a.id} overlaps ${b.id} (gap ${d.toFixed(1)} < ${minGap.toFixed(1)})`)
    }
  }
  for (const c of ['residence', 'dealership', 'service', 'impound', 'recovery', 'public'] as const) {
    if (!cats.has(c)) errors.push(`registry missing required category '${c}'`)
  }
  if (anchorsInCategory('residence').length < 3) errors.push('need a residence anchor for all 3 housing tiers')
  if (anchorsInCategory('public').length < 3) errors.push('need >= 3 public parking anchors')
  return errors
}
