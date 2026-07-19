/**
 * Universal person-occupancy resolution (issue §2). ONE deterministic, bounded,
 * post-movement contract that closes the "citizens phase through each other /
 * stand inside cars / get pushed into walls" bug family for EVERY person kind,
 * regardless of animation state.
 *
 * These are PURE helpers over plain data so the whole contract unit-tests
 * without a canvas. The live system (occupancySystem) builds the spatial index
 * from the entity registry each frame and writes corrections back to the owning
 * runtimes. Order matters and is fixed:
 *
 *   1. accept intended position (input)
 *   2. moving↔moving spacing        (shared push)
 *   3. moving↔stationary spacing    (mover yields; idler holds)
 *   4. stationary↔stationary repair (symmetric — spawn/reset overlap)
 *   5. person↔vehicle footprint     (hard push-out)
 *   6. person↔static solid          (hard push-out — MANDATORY final clamp)
 *   7. validate finite result
 *
 * Person spacing (2–4) is a capped SOFT nudge so a dense crowd never gridlocks;
 * vehicle/solid exclusion (5–6) are HARD clamps because a person must never end
 * up inside a car or a wall. Small transient contact is tolerated; sustained
 * material overlap is not.
 */
import type { Footprint2D, OrientedBox2D } from './entityTypes'

export interface Occupant {
  id: string
  x: number
  z: number
  radius: number
  /** Moving actors yield around stationary ones; stationary hold their ground. */
  moving: boolean
}

export interface OccupancyOptions {
  /** Max soft person-spacing nudge per second (kept below walk speed ≈1.4). */
  maxSpacingPerSecond?: number
  dt: number
  /**
   * Whether a MOVING actor yields around a STATIONARY one. Default true (a
   * mover arcs around an idler). The live BlockLife path sets this FALSE: with
   * waypoint-based trips, a destination can legitimately sit within an idler's
   * radius, so pushing the mover off its path would prevent arrival and strand
   * the trip (see CONVENTIONS: person-separation is deliberately trip-safe).
   * Transient mover-through-idler contact is tolerated; only SUSTAINED overlap
   * (two idlers stuck) is corrected, via the stationary↔stationary repair.
   */
  yieldAroundStationary?: boolean
}

const DEFAULT_MAX_SPACING_PER_SECOND = 1.2

/** Push a circle centre out of an axis-aligned box; returns corrected [x, z]. */
export function pushCircleOutOfAabb(
  x: number,
  z: number,
  r: number,
  b: Footprint2D,
): [number, number] {
  const cx = Math.max(b.minX, Math.min(x, b.maxX))
  const cz = Math.max(b.minZ, Math.min(z, b.maxZ))
  const dx = x - cx
  const dz = z - cz
  const d2 = dx * dx + dz * dz
  if (d2 >= r * r) return [x, z]
  if (d2 > 1e-12) {
    const d = Math.sqrt(d2)
    const push = r - d
    return [x + (dx / d) * push, z + (dz / d) * push]
  }
  // Centre is inside the box — exit along the least-penetration axis.
  const toMinX = x - b.minX
  const toMaxX = b.maxX - x
  const toMinZ = z - b.minZ
  const toMaxZ = b.maxZ - z
  const minPen = Math.min(toMinX, toMaxX, toMinZ, toMaxZ)
  if (minPen === toMinX) return [b.minX - r, z]
  if (minPen === toMaxX) return [b.maxX + r, z]
  if (minPen === toMinZ) return [x, b.minZ - r]
  return [x, b.maxZ + r]
}

/**
 * Push a circle centre out of an oriented box (vehicle footprint). Transforms
 * into the box's local frame (heading = atan2(dx,dz), forward = (sin,cos)),
 * resolves as an AABB, transforms back.
 */
export function pushCircleOutOfOrientedBox(
  x: number,
  z: number,
  r: number,
  box: OrientedBox2D,
): [number, number] {
  const cos = Math.cos(box.headingY)
  const sin = Math.sin(box.headingY)
  const relX = x - box.x
  const relZ = z - box.z
  // world → local (lx = along width/right, lz = along length/forward)
  const lx = relX * cos - relZ * sin
  const lz = relX * sin + relZ * cos
  const [lxp, lzp] = pushCircleOutOfAabb(lx, lz, r, {
    minX: -box.halfWidth,
    maxX: box.halfWidth,
    minZ: -box.halfLength,
    maxZ: box.halfLength,
  })
  if (lxp === lx && lzp === lz) return [x, z]
  // local → world
  const relXp = lxp * cos + lzp * sin
  const relZp = -lxp * sin + lzp * cos
  return [box.x + relXp, box.z + relZp]
}

/**
 * Soft person↔person spacing displacement for `self` against `neighbours`.
 * Movement-priority weighting (per the ordered contract):
 *   - both moving      → self takes HALF (neighbour takes the other half)
 *   - self moving only → self takes FULL (yields around the idler)
 *   - self idle only   → self takes NONE (the mover yields; idler holds)
 *   - both idle        → self takes HALF (symmetric spawn-overlap repair)
 * Summed then capped below walk speed so a dense crowd can never gridlock.
 */
export function personSpacingDisplacement(
  self: Occupant,
  neighbours: readonly Occupant[],
  opts: OccupancyOptions,
): [number, number] {
  let ax = 0
  let az = 0
  for (const other of neighbours) {
    if (other.id === self.id) continue
    const minDist = self.radius + other.radius
    const dx = self.x - other.x
    const dz = self.z - other.z
    const d2 = dx * dx + dz * dz
    if (d2 >= minDist * minDist || d2 < 1e-10) continue
    const d = Math.sqrt(d2)
    const overlap = minDist - d
    let share: number
    if (self.moving && other.moving) share = 0.5
    else if (self.moving && !other.moving) share = opts.yieldAroundStationary === false ? 0 : 1
    else if (!self.moving && other.moving) share = 0
    else share = 0.5
    if (share === 0) continue
    ax += (dx / d) * overlap * share
    az += (dz / d) * overlap * share
  }
  const mag = Math.hypot(ax, az)
  if (mag < 1e-9) return [0, 0]
  const cap = (opts.maxSpacingPerSecond ?? DEFAULT_MAX_SPACING_PER_SECOND) * opts.dt
  const step = Math.min(mag, cap)
  return [(ax / mag) * step, (az / mag) * step]
}

/**
 * Full ordered resolution for one occupant. `neighbours` are nearby people,
 * `vehicles` nearby oriented vehicle footprints, `solids` nearby static AABBs.
 * Returns the corrected [x, z]; always finite.
 */
export function resolveOccupant(
  self: Occupant,
  neighbours: readonly Occupant[],
  vehicles: readonly OrientedBox2D[],
  solids: readonly Footprint2D[],
  opts: OccupancyOptions,
): [number, number] {
  // (2–4) soft person spacing
  const [dx, dz] = personSpacingDisplacement(self, neighbours, opts)
  let x = self.x + dx
  let z = self.z + dz
  // (5) hard vehicle exclusion
  for (const v of vehicles) {
    ;[x, z] = pushCircleOutOfOrientedBox(x, z, self.radius, v)
  }
  // (6) hard static-solid exclusion — the mandatory final clamp
  for (const s of solids) {
    ;[x, z] = pushCircleOutOfAabb(x, z, self.radius, s)
  }
  // (7) validate — never publish a NaN/Inf position
  if (!Number.isFinite(x) || !Number.isFinite(z)) return [self.x, self.z]
  return [x, z]
}
