import type { Vec2 } from '../world/worldTypes'
import { firstBlockerAlong } from '../crime/lineOfSight'

/**
 * Ground-plane hitscan: instant ray vs actor circles, with buildings/props
 * blocking the shot. No projectile objects, no per-frame scene traversal —
 * one ray test against the cached blocker AABBs plus the candidate actors.
 */

export interface HitscanTarget {
  id: string
  position: Vec2
  /** Body radius for the ray-circle test. */
  radius: number
  kind: 'citizen' | 'police'
}

export interface HitscanResult {
  /** True if a target was struck (clear of walls and in range). */
  hit: boolean
  targetId?: string
  targetKind?: 'citizen' | 'police'
  /** Impact point (target entry point on hit, else wall/max-range point). */
  point: Vec2
  distance: number
  /** True when a wall stopped the shot before any target. */
  blockedByWall: boolean
}

/** Nearest ray-circle entry distance along a unit ray, or null if it misses. */
function rayCircleEntry(origin: Vec2, dir: Vec2, center: Vec2, radius: number): number | null {
  const ox = origin[0] - center[0]
  const oz = origin[1] - center[1]
  const b = ox * dir[0] + oz * dir[1]
  const c = ox * ox + oz * oz - radius * radius
  const disc = b * b - c
  if (disc < 0) return null
  const sqrt = Math.sqrt(disc)
  const t0 = -b - sqrt
  const t1 = -b + sqrt
  if (t0 >= 0) return t0
  if (t1 >= 0) return 0 // origin is inside the circle → point-blank
  return null
}

export function resolveHitscan(
  origin: Vec2,
  dir: Vec2,
  range: number,
  targets: readonly HitscanTarget[],
): HitscanResult {
  const len = Math.hypot(dir[0], dir[1]) || 1
  const unit: Vec2 = [dir[0] / len, dir[1] / len]

  // Nearest actor along the ray within range.
  let best: { target: HitscanTarget; t: number } | null = null
  for (const tgt of targets) {
    const t = rayCircleEntry(origin, unit, tgt.position, tgt.radius)
    if (t === null || t > range) continue
    if (!best || t < best.t) best = { target: tgt, t }
  }

  // Where does a wall stop the shot? (props included — bullets don't pass.)
  const rayEnd: Vec2 = [origin[0] + unit[0] * range, origin[1] + unit[1] * range]
  const wall = firstBlockerAlong(origin, rayEnd, { includeProps: true })
  const wallDist = wall ? wall.distance : Infinity

  if (best && best.t <= wallDist) {
    return {
      hit: true,
      targetId: best.target.id,
      targetKind: best.target.kind,
      point: [origin[0] + unit[0] * best.t, origin[1] + unit[1] * best.t],
      distance: best.t,
      blockedByWall: false,
    }
  }
  if (wall) {
    return {
      hit: false,
      point: [origin[0] + unit[0] * wallDist, origin[1] + unit[1] * wallDist],
      distance: wallDist,
      blockedByWall: true,
    }
  }
  return { hit: false, point: rayEnd, distance: range, blockedByWall: false }
}
