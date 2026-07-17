import type { Point2 } from '../world/trafficAvoidance'

/**
 * Vehicle-vs-vehicle awareness. v1 treated the player's driven car as a
 * point with pedestrian-scale radii — two car *centers* 2.6 apart are already
 * interpenetrating bodies (cars are ~2×3.9), which is exactly the overlap
 * bug seen in playtesting. v2 models vehicles as oriented rectangles.
 */
export interface VehicleFootprint {
  id: string
  kind: 'driven' | 'ambient'
  position: Point2
  heading: number
  halfLength: number
  halfWidth: number
  speed: number
}

/** Matches CarMesh: 2 wide × 3.9 long. */
export const CAR_HALF_LENGTH = 1.95
export const CAR_HALF_WIDTH = 1.0

export interface VehicleAheadOptions {
  lookAhead: number
  laneHalfWidth: number
  /** Own body half-length (distances are measured to the other car's near edge). */
  ownHalfLength: number
  /**
   * Own id, for the corner-deadlock tiebreak: when two ambient cars converge
   * on a turn they can each see the other diagonally "ahead" and freeze
   * forever. The car with the lower id ignores a *stopped, diagonal* ambient
   * blocker and creeps through; the other keeps waiting. Same-lane queues are
   * unaffected (queued cars are nearly parallel, cos ≥ diagonal threshold).
   */
  selfId?: string
}

export interface VehicleAhead {
  /** Distance from own center to the other vehicle's near edge (>= 0). */
  distance: number
  index: number
  kind: VehicleFootprint['kind']
}

/**
 * Corridor lookahead against vehicle rectangles. The other vehicle's extent
 * is projected onto our forward/lateral axes so a car parked across the lane
 * is seen by its true width. Ambient-vs-ambient only considers vehicles
 * heading roughly the same direction (following) — oncoming traffic in the
 * adjacent lane must not trigger mutual head-on braking (deadlock); true
 * conflicts are caught by the footprint-overlap emergency check instead.
 * The driven car is always considered, whatever its orientation.
 */
export function getVehicleObstacleAhead(
  position: Point2,
  heading: number,
  vehicles: VehicleFootprint[],
  options: VehicleAheadOptions,
): VehicleAhead | null {
  const fx = Math.sin(heading)
  const fz = Math.cos(heading)
  let best: VehicleAhead | null = null
  for (let i = 0; i < vehicles.length; i++) {
    const v = vehicles[i]
    const dTheta = v.heading - heading
    const cos = Math.cos(dTheta)
    // Skip only clearly OPPOSING ambient traffic (adjacent-lane head-on
    // braking would deadlock both lanes). Perpendicular cars stay visible:
    // a car poking its nose into this corridor at a ring corner or a
    // junction crossing must be braked for — the corner tiebreak below
    // resolves any mutual perpendicular freeze.
    if (v.kind === 'ambient' && cos < -0.25) continue
    // Corner-deadlock tiebreak (see VehicleAheadOptions.selfId).
    if (
      v.kind === 'ambient' &&
      cos < 0.87 &&
      v.speed < 0.15 &&
      options.selfId !== undefined &&
      options.selfId < v.id
    ) {
      continue
    }

    const dx = v.position.x - position.x
    const dz = v.position.z - position.z
    const longitudinal = dx * fx + dz * fz
    const lateral = Math.abs(dx * fz - dz * fx)
    const sin = Math.sin(dTheta)
    const extentLateral = v.halfLength * Math.abs(sin) + v.halfWidth * Math.abs(cos)
    const extentLongitudinal = v.halfLength * Math.abs(cos) + v.halfWidth * Math.abs(sin)
    if (lateral >= options.laneHalfWidth + extentLateral) continue

    const nearEdge = longitudinal - extentLongitudinal
    if (nearEdge <= -options.ownHalfLength || nearEdge >= options.lookAhead) continue
    const distance = Math.max(0, nearEdge)
    if (!best || distance < best.distance) best = { distance, index: i, kind: v.kind }
  }
  return best
}

/** Corner points of an oriented rectangle footprint (allocates — debug/tests/emergency only). */
function corners(v: VehicleFootprint, inflate = 0): [number, number][] {
  const fx = Math.sin(v.heading)
  const fz = Math.cos(v.heading)
  const rx = fz
  const rz = -fx
  const hl = v.halfLength + inflate
  const hw = v.halfWidth + inflate
  return [
    [v.position.x + fx * hl + rx * hw, v.position.z + fz * hl + rz * hw],
    [v.position.x + fx * hl - rx * hw, v.position.z + fz * hl - rz * hw],
    [v.position.x - fx * hl - rx * hw, v.position.z - fz * hl - rz * hw],
    [v.position.x - fx * hl + rx * hw, v.position.z - fz * hl + rz * hw],
  ]
}

/** Separating-axis test between two oriented rectangle footprints. */
export function areVehicleFootprintsOverlapping(
  a: VehicleFootprint,
  b: VehicleFootprint,
  inflate = 0,
): boolean {
  const ca = corners(a, inflate)
  const cb = corners(b)
  const axes: [number, number][] = [
    [Math.sin(a.heading), Math.cos(a.heading)],
    [Math.cos(a.heading), -Math.sin(a.heading)],
    [Math.sin(b.heading), Math.cos(b.heading)],
    [Math.cos(b.heading), -Math.sin(b.heading)],
  ]
  for (const [ax, az] of axes) {
    let minA = Infinity
    let maxA = -Infinity
    for (const [x, z] of ca) {
      const p = x * ax + z * az
      if (p < minA) minA = p
      if (p > maxA) maxA = p
    }
    let minB = Infinity
    let maxB = -Infinity
    for (const [x, z] of cb) {
      const p = x * ax + z * az
      if (p < minB) minB = p
      if (p > maxB) maxB = p
    }
    if (maxA < minB || maxB < minA) return false
  }
  return true
}

/**
 * Emergency anti-overlap: true when this car's (slightly inflated) footprint
 * already touches another vehicle AHEAD of its midline. The caller must set
 * target speed to zero AND stop advancing until the conflict clears.
 *
 * Directional on purpose: contact strictly BEHIND the midline must not
 * freeze the car — driving forward is what clears it. Without this, two cars
 * meeting at a corner (perpendicular, so the corridor lookahead skips them)
 * would freeze each other permanently: nose-to-flank inflated contact where
 * the front car brakes for the car touching its rear quarter.
 */
export function hasEmergencyVehicleContact(
  self: VehicleFootprint,
  vehicles: VehicleFootprint[],
  inflate = 0.25,
): boolean {
  const fx = Math.sin(self.heading)
  const fz = Math.cos(self.heading)
  for (const v of vehicles) {
    if (v.id === self.id) continue
    if (!areVehicleFootprintsOverlapping(self, v, inflate)) continue
    const longitudinal =
      (v.position.x - self.position.x) * fx + (v.position.z - self.position.z) * fz
    if (longitudinal > 0) return true
  }
  return false
}
