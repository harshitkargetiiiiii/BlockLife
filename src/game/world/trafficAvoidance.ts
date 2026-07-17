/**
 * Lightweight traffic/pedestrian avoidance — pure math, no physics engine.
 *
 * Ambient cars are decorative transform-driven objects with no colliders, and
 * NPCs have no physics bodies. These helpers keep them from visually phasing
 * through each other and the player:
 *  - cars brake for obstacles in a stop zone ahead of them,
 *  - pedestrians get softly pushed out of a car's footprint circle,
 *  - the walking player's velocity can't point into an ambient car.
 */

export interface Point2 {
  x: number
  z: number
}

/** True when any obstacle sits within `radius` of `pos`. */
export function isObstacleNear(pos: Point2, obstacles: Point2[], radius: number): boolean {
  for (const o of obstacles) {
    if (Math.hypot(o.x - pos.x, o.z - pos.z) <= radius) return true
  }
  return false
}

/**
 * True when any obstacle is inside the stop zone centered `lookAhead` units
 * in front of a car travelling at `heading` (atan2(x, z) convention, matching
 * the rest of the codebase).
 */
export function isObstacleAhead(
  pos: Point2,
  heading: number,
  obstacles: Point2[],
  lookAhead: number,
  radius: number,
): boolean {
  const px = pos.x + Math.sin(heading) * lookAhead
  const pz = pos.z + Math.cos(heading) * lookAhead
  return isObstacleNear({ x: px, z: pz }, obstacles, radius)
}

/**
 * Removes the component of `vel` that points toward the circle's center once
 * `pos` is inside its influence radius — a soft wall: you can slide along a
 * car or walk away from it, but never into it.
 */
export function blockVelocityTowardCircle(
  pos: Point2,
  vel: Point2,
  center: Point2,
  radius: number,
): Point2 {
  const dx = pos.x - center.x
  const dz = pos.z - center.z
  const dist = Math.hypot(dx, dz)
  if (dist >= radius || dist === 0) return vel
  const nx = dx / dist
  const nz = dz / dist
  // Positive when the velocity points at the center.
  const inward = -(vel.x * nx + vel.z * nz)
  if (inward <= 0) return vel
  return { x: vel.x + nx * inward, z: vel.z + nz * inward }
}

/**
 * Gently pushes a point out of a circle, moving at most `maxStep` per call.
 * Returns null when the point is already outside (no change needed).
 */
export function pushOutOfCircle(
  pos: Point2,
  center: Point2,
  radius: number,
  maxStep: number,
): Point2 | null {
  const dx = pos.x - center.x
  const dz = pos.z - center.z
  const dist = Math.hypot(dx, dz)
  if (dist >= radius) return null
  // Dead center: pick a stable arbitrary direction.
  const nx = dist === 0 ? 1 : dx / dist
  const nz = dist === 0 ? 0 : dz / dist
  const step = Math.min(radius - dist, maxStep)
  return { x: pos.x + nx * step, z: pos.z + nz * step }
}
