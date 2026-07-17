import type { Point2 } from '../world/trafficAvoidance'

/**
 * Linear braking envelope: full stop inside `stopDistance`, full speed
 * beyond `slowDistance`, smooth ramp in between. No snapping.
 */
export function gradeSpeedForDistance(
  distance: number,
  stopDistance: number,
  slowDistance: number,
  limit: number,
): number {
  if (distance <= stopDistance) return 0
  if (distance >= slowDistance) return limit
  return (limit * (distance - stopDistance)) / (slowDistance - stopDistance)
}

export interface LookaheadOptions {
  /** How far ahead of the agent to scan. */
  lookAhead: number
  /** Half-width of the corridor being scanned (lane half-width). */
  laneHalfWidth: number
  /** Radius of the obstacles being tested. */
  obstacleRadius: number
}

export interface ObstacleAhead {
  /** Longitudinal distance to the nearest obstacle in the corridor (>= 0). */
  distance: number
  index: number
}

/**
 * Corridor lookahead: projects each obstacle onto the agent's forward axis
 * (heading uses the codebase's atan2(x, z) convention). An obstacle counts
 * only if it is in front (not behind) within `lookAhead`, and within the
 * lane corridor laterally. Returns the nearest hit or null.
 */
export function getObstacleAhead(
  position: Point2,
  heading: number,
  obstacles: Point2[],
  options: LookaheadOptions,
): ObstacleAhead | null {
  const fx = Math.sin(heading)
  const fz = Math.cos(heading)
  let best: ObstacleAhead | null = null
  for (let i = 0; i < obstacles.length; i++) {
    const o = obstacles[i]
    const dx = o.x - position.x
    const dz = o.z - position.z
    const longitudinal = dx * fx + dz * fz
    const lateral = Math.abs(dx * fz - dz * fx)
    if (
      longitudinal > -options.obstacleRadius &&
      longitudinal < options.lookAhead &&
      lateral < options.laneHalfWidth + options.obstacleRadius
    ) {
      const distance = Math.max(0, longitudinal)
      if (!best || distance < best.distance) best = { distance, index: i }
    }
  }
  return best
}

/** True when the agent's forward axis points toward `target` (dot > ~0). */
export function isHeadingToward(
  position: Point2,
  heading: number,
  target: Point2,
  minAlignment = 0.15,
): boolean {
  const dx = target.x - position.x
  const dz = target.z - position.z
  const dist = Math.hypot(dx, dz)
  if (dist < 1e-6) return true
  const fx = Math.sin(heading)
  const fz = Math.cos(heading)
  return (dx * fx + dz * fz) / dist > minAlignment
}
