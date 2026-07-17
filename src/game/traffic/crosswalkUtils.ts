import type { Vec2 } from '../world/worldTypes'
import type { Point2 } from '../world/trafficAvoidance'
import type { CarAgentView, CrosswalkZone } from './trafficTypes'
import { isHeadingToward } from './trafficAwareness'

/** Axis-aligned containment test against a crosswalk zone. */
export function pointInZone(p: Point2, zone: CrosswalkZone): boolean {
  return (
    Math.abs(p.x - zone.center[0]) <= zone.size[0] / 2 &&
    Math.abs(p.z - zone.center[1]) <= zone.size[1] / 2
  )
}

/**
 * Segment/AABB intersection (slab method): does the straight walk from `a`
 * to `b` pass through the crosswalk zone? Used to detect that a pedestrian's
 * next waypoint takes them across a road.
 */
export function segmentCrossesZone(a: Vec2, b: Vec2, zone: CrosswalkZone): boolean {
  const minX = zone.center[0] - zone.size[0] / 2
  const maxX = zone.center[0] + zone.size[0] / 2
  const minZ = zone.center[1] - zone.size[1] / 2
  const maxZ = zone.center[1] + zone.size[1] / 2
  const dx = b[0] - a[0]
  const dz = b[1] - a[1]

  let tMin = 0
  let tMax = 1
  for (const [origin, delta, lo, hi] of [
    [a[0], dx, minX, maxX],
    [a[1], dz, minZ, maxZ],
  ] as const) {
    if (Math.abs(delta) < 1e-9) {
      if (origin < lo || origin > hi) return false
    } else {
      let t1 = (lo - origin) / delta
      let t2 = (hi - origin) / delta
      if (t1 > t2) [t1, t2] = [t2, t1]
      tMin = Math.max(tMin, t1)
      tMax = Math.min(tMax, t2)
      if (tMin > tMax) return false
    }
  }
  return true
}

/** The first crosswalk the segment a→b passes through, or null. */
export function findCrosswalkOnSegment(
  a: Vec2,
  b: Vec2,
  crosswalks: CrosswalkZone[],
): CrosswalkZone | null {
  for (const zone of crosswalks) {
    if (segmentCrossesZone(a, b, zone)) return zone
  }
  return null
}

export interface CrosswalkSafetyOptions {
  /** A car this close to the zone, approaching, makes crossing unsafe. */
  dangerDistance: number
  /** At or below this speed a car counts as stopped/yielding (safe). */
  stoppedSpeed: number
}

/**
 * Simplified pedestrian safety rule: the crossing is unsafe if any car is
 * near the zone, moving toward it, and not already stopped/yielding. A car
 * sitting inside the zone while still rolling is also unsafe.
 */
export function isCrosswalkSafeToEnter(
  zone: CrosswalkZone,
  cars: CarAgentView[],
  options: CrosswalkSafetyOptions,
): boolean {
  const center: Point2 = { x: zone.center[0], z: zone.center[1] }
  for (const car of cars) {
    if (car.speed <= options.stoppedSpeed) continue
    const distance = Math.hypot(car.position.x - center.x, car.position.z - center.z)
    if (distance > options.dangerDistance) continue
    if (pointInZone(car.position, zone)) return false
    if (isHeadingToward(car.position, car.heading, center)) return false
  }
  return true
}
