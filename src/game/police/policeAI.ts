import type { Vec2 } from '../world/worldTypes'
import type { PoliceState, PoliceUnit } from './policeTypes'

/**
 * Pure police-unit AI stepping. Given a unit and a per-frame context, this
 * advances the unit's state machine and moves it via BOUNDED direct pursuit
 * toward the suspect (when seen) or the last-known position (when searching).
 *
 * Kept side-effect-free (mutates only the passed unit) so it is fully unit
 * testable. The live driver supplies obstacle avoidance and the LOS test; it
 * also relays sighting to the wanted runtime based on `result.sees`.
 */

export const POLICE_LOS_RANGE = 42
export const ARREST_RANGE = 3
export const ARREST_HOLD_SECONDS = 1.2
/** Below this suspect speed we treat them as stopped / surrendering. */
export const SURRENDER_SPEED = 1.2
export const POLICE_SPEED_VEHICLE = 13
export const POLICE_SPEED_FOOT = 4.6
/** How long a unit searches a last-known spot before giving up that lead. */
export const SEARCH_GIVE_UP_SECONDS = 12

export interface PoliceStepContext {
  /** Suspect world position (x,z). */
  suspectPos: Vec2
  /** Last reported/seen suspect position, or null. */
  lastKnown: Vec2 | null
  /** Whether the suspect is currently in a vehicle. */
  suspectInVehicle: boolean
  /** Suspect planar speed (units/s) — drives arrest/surrender detection. */
  suspectSpeed: number
  /** True when the response is armed-and-dangerous (L3 or attacked police). */
  forceCombat: boolean
  gameTime: number
  dt: number
  /** Building line-of-sight test (true if unobstructed). */
  hasLos: (from: Vec2, to: Vec2) => boolean
  /** Optional obstacle resolver: nudges a proposed position out of solids. */
  avoid?: (pos: Vec2) => Vec2
  /**
   * Next road-route waypoint to steer toward (emergency road-graph pursuit).
   * When set, a pursuing/responding cruiser follows the road instead of driving
   * straight at the target; null → direct steering (close-range containment or
   * off-road fallback).
   */
  roadWaypoint?: Vec2 | null
  /**
   * True for a dismounted OFFICER — always pursues on foot (never at vehicle
   * speed, never on the road network), so a fleeing car outpaces it and it
   * drops to searching, exactly as intended.
   */
  onFoot?: boolean
}

export interface PoliceStepResult {
  /** Whether this unit currently sees the suspect (for wanted relay). */
  sees: boolean
  /** True on the frame this unit completes an arrest. */
  arrested: boolean
}

function dist(a: Vec2, b: Vec2): number {
  return Math.hypot(a[0] - b[0], a[1] - b[1])
}

/** Move `unit` toward `target` by up to `speed*dt`, applying avoidance. */
function moveToward(unit: PoliceUnit, target: Vec2, speed: number, ctx: PoliceStepContext): void {
  const dx = target[0] - unit.position[0]
  const dz = target[1] - unit.position[1]
  const d = Math.hypot(dx, dz)
  if (d < 1e-4) return
  unit.heading = Math.atan2(dx, dz)
  const step = Math.min(speed * ctx.dt, d)
  let next: Vec2 = [unit.position[0] + (dx / d) * step, unit.position[1] + (dz / d) * step]
  if (ctx.avoid) next = ctx.avoid(next)
  unit.position = next
}

export function stepPoliceUnit(unit: PoliceUnit, ctx: PoliceStepContext): PoliceStepResult {
  if (unit.state === 'despawning') return { sees: false, arrested: false }

  const toSuspect = dist(unit.position, ctx.suspectPos)
  const sees = toSuspect < POLICE_LOS_RANGE && ctx.hasLos(unit.position, ctx.suspectPos)
  unit.seesSuspect = sees

  if (sees) {
    unit.timeSinceSeen = 0
  } else {
    unit.timeSinceSeen += ctx.dt
  }

  // Choose what to chase: the live suspect if seen, else the last-known lead.
  const target = sees ? ctx.suspectPos : (ctx.lastKnown ?? unit.target ?? ctx.suspectPos)
  unit.target = target

  let arrested = false
  let nextState: PoliceState = unit.state

  const inArrestRange = sees && toSuspect <= ARREST_RANGE
  const suspectStopped = ctx.suspectSpeed <= SURRENDER_SPEED

  if (ctx.forceCombat && sees) {
    // Armed-and-dangerous response: hold ground and engage (M5 fires shots).
    nextState = 'combat'
    unit.arrestTimer = 0
    // Close only to a standoff distance.
    if (toSuspect > 8) moveToward(unit, target, POLICE_SPEED_FOOT, ctx)
  } else if (inArrestRange && suspectStopped && !ctx.suspectInVehicle) {
    // Cornered a stopped suspect on foot → make the arrest.
    nextState = 'attempting_arrest'
    unit.arrestTimer += ctx.dt
    if (unit.arrestTimer >= ARREST_HOLD_SECONDS) arrested = true
  } else {
    unit.arrestTimer = 0
    if (sees) {
      // An officer on foot always pursues on foot at foot speed; a cruiser
      // matches the suspect's mode/speed.
      const asVehicle = ctx.suspectInVehicle && !ctx.onFoot
      nextState = asVehicle ? 'pursuing_vehicle' : 'pursuing_on_foot'
      const speed = asVehicle ? POLICE_SPEED_VEHICLE : POLICE_SPEED_FOOT
      // Follow the road route when one exists (emergency graph pursuit), else
      // steer directly (close range / off-road fallback / on foot).
      moveToward(unit, ctx.roadWaypoint ?? target, speed, ctx)
    } else if (unit.timeSinceSeen >= SEARCH_GIVE_UP_SECONDS && !ctx.lastKnown) {
      nextState = 'returning'
    } else {
      // Head to the last-known point and sweep — over roads when routed.
      nextState = unit.state === 'responding' ? 'responding' : 'searching'
      const arrivedAtLead = dist(unit.position, target) < 2.5
      if (!arrivedAtLead) moveToward(unit, ctx.roadWaypoint ?? target, POLICE_SPEED_VEHICLE, ctx)
      else if (unit.timeSinceSeen >= SEARCH_GIVE_UP_SECONDS) nextState = 'returning'
    }
  }

  unit.state = nextState
  return { sees, arrested }
}
