import type { Vec2 } from '../world/worldTypes'

/**
 * Vehicle Crime & Theft state (Crime & Law Enforcement v1). A module
 * singleton tracking per-vehicle access/ownership, stolen flag, health and
 * disabled state. Global (survives streaming). The ONE player-drivable car
 * is `vehicle_compact_car_01`; "stealing" a parked/occupied vehicle
 * relocates that drivable car to the target and records the theft, so the
 * whole existing driving system is reused with no multi-vehicle rewrite.
 */

export const PLAYER_CAR_ID = 'vehicle_compact_car_01'

export type VehicleAccessState =
  | 'public'
  | 'owned_by_player'
  | 'civilian_parked'
  | 'civilian_occupied'
  | 'police'
  | 'locked'

export interface StealableVehicle {
  id: string
  position: Vec2
  headingY: number
  access: 'civilian_parked' | 'civilian_occupied'
  ownerId: string
  color: string
  /** For occupied vehicles: the seated driver ejected on carjack. */
  driverId?: string
  driverColor?: string
}

/**
 * Authored civilian vehicles the player can steal. Parked ones are empty
 * (quiet theft). Occupied ones have a seated driver who is carjacked out — a
 * higher-severity crime with a live driver-eject → flee → report sequence.
 */
export const STEALABLE_VEHICLES: StealableVehicle[] = [
  { id: 'theft_parked_plaza', position: [22, 6], headingY: Math.PI / 2, access: 'civilian_parked', ownerId: 'owner_plaza', color: '#c25b52' },
  { id: 'theft_parked_market', position: [46, 4], headingY: 0, access: 'civilian_parked', ownerId: 'owner_market', color: '#5b7fc2' },
  { id: 'theft_occupied_plaza', position: [30, 6], headingY: Math.PI / 2, access: 'civilian_occupied', ownerId: 'owner_occ_plaza', color: '#4c956c', driverId: 'driver_occ_plaza', driverColor: '#7b4b2a' },
  { id: 'theft_occupied_market', position: [42, 4], headingY: 0, access: 'civilian_occupied', ownerId: 'owner_occ_market', color: '#8d6a9f', driverId: 'driver_occ_market', driverColor: '#33475b' },
]
const STEALABLE_BY_ID = new Map(STEALABLE_VEHICLES.map((v) => [v.id, v]))

export interface VehicleCrimeRecord {
  id: string
  access: VehicleAccessState
  stolen: boolean
  ownerId?: string
  health: number // 0..100
  disabled: boolean
  lastCollisionAt: number
  /** ON THE PLAYER CAR RECORD ONLY: which source vehicle it currently
      represents (the last one stolen). Undefined when not stolen. Missions read
      this to verify the EXACT boosted target reaches the garage. */
  sourceVehicleId?: string
}

export const VEHICLE_MAX_HEALTH = 100
/** Below this the car loses acceleration. */
export const DISABLED_HEALTH = 0

export const vehicleCrimeRuntime = {
  records: new Map<string, VehicleCrimeRecord>(),
}

function ensure(id: string, access: VehicleAccessState = 'public'): VehicleCrimeRecord {
  let rec = vehicleCrimeRuntime.records.get(id)
  if (!rec) {
    rec = { id, access, stolen: false, health: VEHICLE_MAX_HEALTH, disabled: false, lastCollisionAt: -999 }
    vehicleCrimeRuntime.records.set(id, rec)
  }
  return rec
}

export function getVehicleCrimeState(id: string): VehicleCrimeRecord {
  return ensure(id)
}

export function getStealable(id: string): StealableVehicle | undefined {
  return STEALABLE_BY_ID.get(id)
}

/** The seated driver of an occupied vehicle, or null once carjacked/empty. */
export function getVehicleOccupant(vehicleId: string): string | null {
  const v = STEALABLE_BY_ID.get(vehicleId)
  if (!v || v.access !== 'civilian_occupied' || !v.driverId) return null
  return getVehicleCrimeState(vehicleId).stolen ? null : v.driverId
}

/**
 * Record a theft of `stolenVehicleId` by the player: the drivable car takes
 * on the stolen identity (access owned_by_player, stolen flag, prior owner
 * recorded). Returns the theft kind for crime emission. `stolen` state stays
 * attached across streaming because this record is global.
 */
export function recordTheft(stolenVehicleId: string): 'vehicle_theft' | 'occupied_vehicle_theft' {
  const target = STEALABLE_BY_ID.get(stolenVehicleId)
  const occupied = target ? target.access === 'civilian_occupied' : stolenVehicleId.startsWith('vehicle_ambient')
  const player = ensure(PLAYER_CAR_ID)
  player.access = 'owned_by_player'
  player.stolen = true
  player.ownerId = target?.ownerId ?? `owner_${stolenVehicleId}`
  player.health = VEHICLE_MAX_HEALTH
  player.disabled = false
  // Record the EXACT source this drivable car now represents (mission identity).
  player.sourceVehicleId = stolenVehicleId
  // The source vehicle is now taken.
  const src = ensure(stolenVehicleId, occupied ? 'civilian_occupied' : 'civilian_parked')
  src.access = 'owned_by_player'
  src.stolen = true
  return occupied ? 'occupied_vehicle_theft' : 'vehicle_theft'
}

export function setVehicleHealth(id: string, value: number): void {
  const rec = ensure(id)
  rec.health = Math.max(0, Math.min(VEHICLE_MAX_HEALTH, value))
  rec.disabled = rec.health <= DISABLED_HEALTH
}

/**
 * Impact damage scales with relative speed above a threshold; tiny bumps do
 * nothing. Returns the damage applied (0 when below threshold), so callers
 * can decide whether a collision crime fires. Debounced by the caller via
 * the crime runtime; here we also cap one damage application per window.
 */
export function impactDamageFor(relativeSpeed: number): number {
  const THRESHOLD = 4 // below this it's a gentle nudge
  if (relativeSpeed < THRESHOLD) return 0
  return Math.min(60, (relativeSpeed - THRESHOLD) * 6)
}

export function applyVehicleImpact(id: string, relativeSpeed: number, gameTime: number): number {
  const rec = ensure(id)
  if (gameTime - rec.lastCollisionAt < 0.6) return 0 // debounce repeated contacts
  const dmg = impactDamageFor(relativeSpeed)
  if (dmg <= 0) return 0
  rec.lastCollisionAt = gameTime
  rec.health = Math.max(0, rec.health - dmg)
  rec.disabled = rec.health <= DISABLED_HEALTH
  return dmg
}

export function isPlayerCarStolen(): boolean {
  return vehicleCrimeRuntime.records.get(PLAYER_CAR_ID)?.stolen ?? false
}

/**
 * The source vehicle id the player's drivable car currently represents, or
 * null when the car isn't stolen. This is the authoritative "which car am I
 * driving" for mission delivery — a replacement theft overwrites it, so a
 * boosted decoy can never be handed off in place of the real target.
 */
export function getPlayerCarSourceId(): string | null {
  const rec = vehicleCrimeRuntime.records.get(PLAYER_CAR_ID)
  return rec?.stolen ? rec.sourceVehicleId ?? null : null
}

/**
 * Clear ONLY the player car's stolen identity (access, stolen flag, source).
 * Used on mission handoff and terminal resolution so the delivered/abandoned
 * car is no longer treated as the player's. Leaves every other vehicle record
 * (and a full crime reset — resetVehicleCrimeRuntime — for arrest/incap/load)
 * untouched. Idempotent.
 */
export function clearStolenPlayerCar(): void {
  const rec = vehicleCrimeRuntime.records.get(PLAYER_CAR_ID)
  if (!rec) return
  rec.access = 'public'
  rec.stolen = false
  rec.ownerId = undefined
  rec.sourceVehicleId = undefined
}

export function resetVehicleCrimeRuntime(): void {
  vehicleCrimeRuntime.records.clear()
}

/** Validation: stealable spawns unique + off the same spot; owners set. */
export function validateStealableVehicles(): string[] {
  const errors: string[] = []
  const seen = new Set<string>()
  for (const v of STEALABLE_VEHICLES) {
    if (seen.has(v.id)) errors.push(`${v.id}: duplicate stealable id`)
    seen.add(v.id)
    if (!v.ownerId) errors.push(`${v.id}: missing ownerId`)
    for (const other of STEALABLE_VEHICLES) {
      if (other === v) continue
      const d = Math.hypot(other.position[0] - v.position[0], other.position[1] - v.position[1])
      if (d < 3) errors.push(`${v.id} overlaps ${other.id}`)
    }
  }
  return errors
}
