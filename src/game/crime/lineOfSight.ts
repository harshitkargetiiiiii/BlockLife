import type { Vec2 } from '../world/worldTypes'
import { collectSolidFootprints } from '../world/solidFootprints'

/**
 * Ground-plane line-of-sight for witnesses (buildings block) and firearm
 * hitscan (buildings + solid props block). Buildings and props are static,
 * so their axis-aligned footprints are cached once at first use — no
 * per-frame allocation or scene traversal.
 */

interface Blocker {
  id: string
  minX: number
  maxX: number
  minZ: number
  maxZ: number
  isProp: boolean
}

let blockersCache: Blocker[] | null = null

function blockers(): Blocker[] {
  if (blockersCache) return blockersCache
  blockersCache = collectSolidFootprints().map((f) => {
    // Buildings never rotate — use their true axis-aligned extents. Rotated
    // prop footprints use their bounding box (a safe over-approximation).
    const isBuilding = f.source === 'building'
    const hx = isBuilding ? f.halfWidth : Math.max(f.halfWidth, f.halfLength)
    const hz = isBuilding ? f.halfLength : Math.max(f.halfWidth, f.halfLength)
    return {
      id: f.id,
      minX: f.position.x - hx,
      maxX: f.position.x + hx,
      minZ: f.position.z - hz,
      maxZ: f.position.z + hz,
      isProp: f.source === 'prop',
    }
  })
  return blockersCache
}

/** Test/dev: force the blocker cache to rebuild (after content changes). */
export function invalidateBlockerCache(): void {
  blockersCache = null
}

/** Segment/AABB intersection via the slab method (with a small margin). */
export function segmentIntersectsAabb(
  a: Vec2,
  b: Vec2,
  minX: number,
  maxX: number,
  minZ: number,
  maxZ: number,
): boolean {
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

export interface LineOfSightOptions {
  /** Also let solid props block the line (firearms). Default false. */
  includeProps?: boolean
  /** Blocker ids to ignore (e.g. the shooter's own vehicle). */
  ignoreIds?: ReadonlySet<string>
}

/** True when nothing solid blocks the ground-plane segment from → to. */
export function hasLineOfSight(from: Vec2, to: Vec2, options: LineOfSightOptions = {}): boolean {
  for (const blk of blockers()) {
    if (blk.isProp && !options.includeProps) continue
    if (options.ignoreIds?.has(blk.id)) continue
    if (segmentIntersectsAabb(from, to, blk.minX, blk.maxX, blk.minZ, blk.maxZ)) return false
  }
  return true
}

/** The first blocker the segment hits, with its entry distance, or null. */
export function firstBlockerAlong(
  from: Vec2,
  to: Vec2,
  options: LineOfSightOptions = {},
): { id: string; distance: number } | null {
  let best: { id: string; distance: number } | null = null
  const dx = to[0] - from[0]
  const dz = to[1] - from[1]
  const len = Math.hypot(dx, dz) || 1
  for (const blk of blockers()) {
    if (blk.isProp && !options.includeProps) continue
    if (options.ignoreIds?.has(blk.id)) continue
    if (!segmentIntersectsAabb(from, to, blk.minX, blk.maxX, blk.minZ, blk.maxZ)) continue
    // Approx entry distance = distance to the blocker centre along the ray.
    const cx = (blk.minX + blk.maxX) / 2
    const cz = (blk.minZ + blk.maxZ) / 2
    const t = ((cx - from[0]) * dx + (cz - from[1]) * dz) / (len * len)
    const distance = Math.max(0, Math.min(1, t)) * len
    if (!best || distance < best.distance) best = { id: blk.id, distance }
  }
  return best
}
