/**
 * Canonical vehicle definition registry (Vehicle Ownership v1, issue #19 §1). ONE typed,
 * validated registry of legitimate ownable vehicle CLASSES. A definition is a catalog key
 * (priced data + tuning + footprint + render/upgrade metadata); buying one mints a unique
 * reload-safe owned asset (see `vehicleOwnershipRuntime`). A definition ID is NOT an owned
 * asset ID.
 *
 * The Compact Car reuses the existing `VEHICLE_TUNING` / `CAR_HALF_*` baseline verbatim — it
 * is the migration target for the legacy single drivable car, so its physics must not change.
 * Other classes vary within BOUNDED, streaming-safe limits (the sector-safety ring + prewarm
 * are validated against `MAX_STREAMING_SAFE_SPEED`); tiers are NOT made to feel different by
 * globally inflating speed.
 */
import { VEHICLE_TUNING } from './vehicleTypes'
import { CAR_HALF_LENGTH, CAR_HALF_WIDTH } from '../traffic/vehicleObstacles'
import type { RankId, SkillId } from '../careers/careerTypes'

/** Stable, semantic vehicle definition id (NOT an owned-asset id). */
export type VehicleDefId = string

/** Body/size class — drives parking compatibility + footprint expectations. */
export type VehicleClass = 'scooter' | 'compact' | 'van' | 'sports'

/** Parking size class an anchor must accept (scooter fits anywhere; van needs large). */
export type ParkingSizeClass = 'small' | 'standard' | 'large'

/** Upgrade categories a class may accept (validated against the upgrade registry). */
export type UpgradeCategory = 'paint' | 'wheels' | 'performance' | 'cargo' | 'durability'

/** Mission/career capability tags. */
export type VehicleTag = 'delivery' | 'utility' | 'premium' | 'starter'

/** Arcade tuning shape — same fields the controller reads, per class. */
export interface VehicleTuning {
  maxSpeed: number
  maxReverseSpeed: number
  acceleration: number
  brakeDeceleration: number
  reverseAcceleration: number
  coastDrag: number
  turnRate: number
  steerFullSpeed: number
  /** Rigid-body mass (heavier = more sluggish; arcade, not real physics). */
  mass: number
}

/** Eligibility a listing may impose (all optional; read-only career/skill/income). */
export interface VehicleRequirement {
  minRank?: RankId
  minDrivingSkill?: number
  minRecentCareerIncome?: number
  recentIncomeWindowDays?: number
}

export interface VehicleDef {
  id: VehicleDefId
  displayName: string
  vehicleClass: VehicleClass
  /** Listing copy for the dealership / Garage app. */
  listingDescription: string
  /** Render adapter: which mesh to project + its base paint. `car` reuses CarMesh. */
  renderAdapter: 'car'
  baseColor: string
  /** Allowed paint palette (includes baseColor); customization picks from here. */
  paintPalette: readonly string[]
  /** Half-extents of the collider/footprint (metres). Compact == CAR_HALF_*. */
  halfLength: number
  halfWidth: number
  /** Local-space offset (right, forward) the player exits to, mirrored per side. */
  exitOffset: [number, number]
  /** Base purchase price and deterministic base trade value (before condition). */
  basePrice: number
  baseTradeValue: number
  /** Eligibility gates (career rank / driving skill / verified income). */
  requirement: VehicleRequirement
  /** Whether the dealership lists it from the start (all four do in v1). */
  listed: boolean
  tuning: VehicleTuning
  /** Base + max condition (0..100). No permanent destruction in v1. */
  baseCondition: number
  /** Occupied cargo SLOTS this class provides (before cargo upgrades). */
  cargoCapacity: number
  /** Seats incl. driver (passenger metadata for social Give-a-Ride). */
  seats: number
  allowedUpgrades: readonly UpgradeCategory[]
  parkingSize: ParkingSizeClass
  tags: readonly VehicleTag[]
  sourceRef: { file: string; symbol: string }
}

/** The fastest any (fully upgraded) vehicle may travel — the sector-safety ring +
 *  speed-aware prewarm are validated to keep coverage at this speed (§14). */
export const MAX_STREAMING_SAFE_SPEED = 20

const SRC = (symbol: string) => ({ file: 'src/game/vehicles/vehicleRegistry.ts', symbol })

const PALETTE = ['#d7e6ee', '#c25b52', '#5b7fc2', '#4c956c', '#e2b04a', '#2c2c33'] as const

export const VEHICLE_DEFS: readonly VehicleDef[] = [
  {
    id: 'veh_scooter',
    displayName: 'City Scooter',
    vehicleClass: 'scooter',
    listingDescription: 'A nimble little scooter — cheap, thrifty on space, tiny cargo box.',
    renderAdapter: 'car',
    baseColor: '#e2b04a',
    paintPalette: PALETTE,
    halfLength: 1.1,
    halfWidth: 0.55,
    exitOffset: [1.1, 0],
    basePrice: 900,
    baseTradeValue: 500,
    requirement: {},
    listed: true,
    tuning: { maxSpeed: 11, maxReverseSpeed: 4, acceleration: 12, brakeDeceleration: 18, reverseAcceleration: 7, coastDrag: 7, turnRate: 3.0, steerFullSpeed: 3, mass: 1 },
    baseCondition: 100,
    cargoCapacity: 2,
    seats: 1,
    allowedUpgrades: ['paint', 'wheels', 'cargo', 'durability'],
    parkingSize: 'small',
    tags: ['starter'],
    sourceRef: SRC('veh_scooter'),
  },
  {
    id: 'veh_compact',
    displayName: 'Compact Car',
    vehicleClass: 'compact',
    listingDescription: 'A balanced city car. The default drive — reliable and easy to park.',
    renderAdapter: 'car',
    baseColor: '#d7e6ee',
    paintPalette: PALETTE,
    // The Compact IS the legacy drivable car: footprint + tuning are the current baseline.
    halfLength: CAR_HALF_LENGTH,
    halfWidth: CAR_HALF_WIDTH,
    exitOffset: [1.6, 0],
    basePrice: 4200,
    baseTradeValue: 2600,
    requirement: {},
    listed: true,
    tuning: { ...VEHICLE_TUNING, mass: 3 },
    baseCondition: 100,
    cargoCapacity: 6,
    seats: 4,
    allowedUpgrades: ['paint', 'wheels', 'performance', 'cargo', 'durability'],
    parkingSize: 'standard',
    tags: ['delivery'],
    sourceRef: SRC('veh_compact'),
  },
  {
    id: 'veh_van',
    displayName: 'Utility Van',
    vehicleClass: 'van',
    listingDescription: 'Slower and bulkier, but hauls a lot — the delivery workhorse.',
    renderAdapter: 'car',
    baseColor: '#5b7fc2',
    paintPalette: PALETTE,
    halfLength: 2.5,
    halfWidth: 1.2,
    exitOffset: [1.9, 0],
    basePrice: 6800,
    baseTradeValue: 4200,
    requirement: {},
    listed: true,
    tuning: { maxSpeed: 12, maxReverseSpeed: 4.5, acceleration: 8, brakeDeceleration: 18, reverseAcceleration: 6, coastDrag: 6, turnRate: 1.9, steerFullSpeed: 5, mass: 6 },
    baseCondition: 100,
    cargoCapacity: 16,
    seats: 2,
    allowedUpgrades: ['paint', 'wheels', 'cargo', 'durability'],
    parkingSize: 'large',
    tags: ['delivery', 'utility'],
    sourceRef: SRC('veh_van'),
  },
  {
    id: 'veh_sports',
    displayName: 'Premium Sports Car',
    vehicleClass: 'sports',
    listingDescription: 'A high-floor performance car. The view alone sells it — if you qualify.',
    renderAdapter: 'car',
    baseColor: '#c25b52',
    paintPalette: PALETTE,
    halfLength: 2.0,
    halfWidth: 1.05,
    exitOffset: [1.65, 0],
    basePrice: 24000,
    baseTradeValue: 15000,
    // Aspirational: an experienced driver with verified income. Never bypassable.
    requirement: { minRank: 'experienced', minDrivingSkill: 4, minRecentCareerIncome: 400 },
    listed: true,
    // Faster than the Compact but bounded well under MAX_STREAMING_SAFE_SPEED even with the
    // Performance upgrade (+2), so it never outruns streaming/traffic avoidance (§9/§14).
    tuning: { maxSpeed: 16, maxReverseSpeed: 5, acceleration: 14, brakeDeceleration: 22, reverseAcceleration: 8, coastDrag: 5, turnRate: 2.6, steerFullSpeed: 4, mass: 3 },
    baseCondition: 100,
    cargoCapacity: 3,
    seats: 2,
    allowedUpgrades: ['paint', 'wheels', 'performance', 'durability'],
    parkingSize: 'standard',
    tags: ['premium'],
    sourceRef: SRC('veh_sports'),
  },
]

const BY_ID: Record<string, VehicleDef> = Object.fromEntries(VEHICLE_DEFS.map((d) => [d.id, d]))

export function getVehicleDef(id: VehicleDefId): VehicleDef | undefined {
  return BY_ID[id]
}

export function isVehicleDefId(id: unknown): id is VehicleDefId {
  return typeof id === 'string' && id in BY_ID
}

/** The legacy single drivable car migrates into this class (§3). */
export const MIGRATION_VEHICLE_DEF_ID: VehicleDefId = 'veh_compact'

/**
 * Registry validation (§1): unique ids, sane footprints/tuning/prices, streaming-safe top
 * speed (incl. the Performance upgrade headroom), valid paint palette, and referenced
 * upgrade categories. Career/skill id existence is validated in the registry TEST against
 * the real career authority (pure here so it runs headless without importing career data).
 */
export function validateVehicleRegistry(): string[] {
  const errors: string[] = []
  const seen = new Set<string>()
  const classes = new Set<VehicleClass>()
  for (const d of VEHICLE_DEFS) {
    const where = `vehicle ${d.id}`
    if (seen.has(d.id)) errors.push(`${where}: duplicate id`)
    seen.add(d.id)
    classes.add(d.vehicleClass)
    if (!(d.halfLength > 0) || !(d.halfWidth > 0)) errors.push(`${where}: non-positive footprint`)
    if (!(d.basePrice >= 0) || !(d.baseTradeValue >= 0)) errors.push(`${where}: negative price/trade value`)
    if (d.baseTradeValue > d.basePrice) errors.push(`${where}: trade value exceeds price`)
    if (!(d.baseCondition > 0 && d.baseCondition <= 100)) errors.push(`${where}: bad base condition`)
    if (!(d.cargoCapacity >= 0)) errors.push(`${where}: negative cargo`)
    if (!(d.seats >= 1)) errors.push(`${where}: needs >= 1 seat`)
    if (!d.paintPalette.includes(d.baseColor)) errors.push(`${where}: baseColor not in palette`)
    // Top speed (with the largest performance headroom) must stay streaming-safe.
    const perfHeadroom = d.allowedUpgrades.includes('performance') ? 2 : 0
    if (d.tuning.maxSpeed + perfHeadroom > MAX_STREAMING_SAFE_SPEED) {
      errors.push(`${where}: max speed + perf upgrade exceeds streaming-safe ${MAX_STREAMING_SAFE_SPEED}`)
    }
    if (!(d.tuning.maxSpeed > 0 && d.tuning.acceleration > 0 && d.tuning.turnRate > 0 && d.tuning.mass > 0)) {
      errors.push(`${where}: non-positive tuning`)
    }
    for (const u of d.allowedUpgrades) {
      if (!['paint', 'wheels', 'performance', 'cargo', 'durability'].includes(u)) errors.push(`${where}: unknown upgrade category '${u}'`)
    }
  }
  // The four required distinct classes must all be present (§1).
  for (const c of ['scooter', 'compact', 'van', 'sports'] as const) {
    if (!classes.has(c)) errors.push(`registry missing required class '${c}'`)
  }
  if (!getVehicleDef(MIGRATION_VEHICLE_DEF_ID)) errors.push(`migration target '${MIGRATION_VEHICLE_DEF_ID}' not in registry`)
  return errors
}

/** Referenced career SkillId used by requirements — surfaced so the test can assert it exists. */
export const VEHICLE_REQUIREMENT_SKILL: SkillId = 'driving'
