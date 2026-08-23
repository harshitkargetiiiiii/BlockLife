import type { Vec2 } from '../world/worldTypes'
import { AMBIENT_CITIZENS, type AmbientCitizen } from './ambientCitizenData'
import { INTERSECTIONS } from '../traffic/intersections/intersectionRegistry'
import type { CompiledCrossIntersection } from '../traffic/intersections/crossIntersection'

/**
 * Authored loop-path clearance validation (issue #31).
 *
 * A `loop_walk` citizen walks a fixed authored path forever. The 300s integrity
 * soak proved a specific SUSTAINED-overlap failure mode: when a loop's path rings
 * a **signalized crossing** — the junction box and the curb WAIT SPOTS where
 * pedestrians stand still for the walk signal — the looping walker sweeps back
 * over the stationary waiters (and over the pier/dock shuttles authored on that
 * same ring) every lap. Idle waiters are skipped by the person-separation
 * resolver (so a chokepoint never deadlocks), so that overlap is never cleared →
 * the sustained `person_person_overlap` at Harbor Cross (`cit_hc_loop_cw` vs
 * `east_shuttle` / `waterfront_gazer` / `plaza_stroller`).
 *
 * The invariant is therefore CROSSING-ZONE occupancy — a loop must keep clearance
 * from every crossing wait spot and stay out of every junction box. It is
 * deliberately NOT "clear every citizen dwell point": ambient walkers all over
 * the city pass close to lone sitters without any sustained overlap (a transient
 * perpendicular pass, which the 1806-cycle soak confirmed benign). Flagging those
 * would reject legitimate crossings; the principled, soak-verified condition is
 * the concentrated stationary-wait occupancy at a signalized intersection.
 *
 * Pure DATA validator over the authored citizen list + the compiled intersection
 * registry — no runtime, no scene. Fails on the pre-fix Harbor Cross loops
 * (which ring the crossing) and passes on the corrected authoring.
 */

// A stationary person overlaps another within r_a + r_b = 0.35 + 0.35 = 0.70;
// a loop path must stay strictly clear of a wait spot, with margin.
export const WAIT_CLEARANCE = 0.9
// A loop must not skim the road junction box — its curb ring is the wait zone.
export const JUNCTION_MARGIN = 2.0

export interface ClearanceViolation {
  citizenId: string
  kind: 'crossing_wait' | 'junction_box'
  at: Vec2
  detail: string
}

/** Closed-loop segments for >2 waypoints; a plain back-and-forth for 2. */
function loopSegments(wps: readonly Vec2[]): [Vec2, Vec2][] {
  const segs: [Vec2, Vec2][] = []
  for (let i = 0; i < wps.length - 1; i++) segs.push([wps[i], wps[i + 1]])
  if (wps.length > 2) segs.push([wps[wps.length - 1], wps[0]])
  return segs
}

function distPointSeg(p: Vec2, a: Vec2, b: Vec2): number {
  const dx = b[0] - a[0]
  const dz = b[1] - a[1]
  const len2 = dx * dx + dz * dz
  if (len2 === 0) return Math.hypot(p[0] - a[0], p[1] - a[1])
  let t = ((p[0] - a[0]) * dx + (p[1] - a[1]) * dz) / len2
  t = Math.max(0, Math.min(1, t))
  return Math.hypot(p[0] - (a[0] + t * dx), p[1] - (a[1] + t * dz))
}

export interface Aabb {
  minX: number
  maxX: number
  minZ: number
  maxZ: number
}

/**
 * Segment/AABB intersection via Liang-Barsky slab clipping. True when [a,b]
 * touches or crosses the box — endpoint(s) inside, crossing straight through
 * with BOTH endpoints outside, tangent to an edge/corner, or a degenerate
 * zero-length segment sitting inside/on the boundary. (The previous
 * endpoints-inside check missed the crossing-through case.)
 */
export function segIntersectsAabb(a: Vec2, b: Vec2, box: Aabb): boolean {
  const dx = b[0] - a[0]
  const dz = b[1] - a[1]
  // Half-plane form p·t ≤ q for the four slabs; clip the parameter to [t0, t1].
  const p = [-dx, dx, -dz, dz]
  const q = [a[0] - box.minX, box.maxX - a[0], a[1] - box.minZ, box.maxZ - a[1]]
  let t0 = 0
  let t1 = 1
  for (let i = 0; i < 4; i++) {
    if (p[i] === 0) {
      if (q[i] < 0) return false // parallel to this slab and wholly outside it
    } else {
      const r = q[i] / p[i]
      if (p[i] < 0) {
        if (r > t1) return false
        if (r > t0) t0 = r
      } else {
        if (r < t0) return false
        if (r < t1) t1 = r
      }
    }
  }
  return t0 <= t1
}

/**
 * Exact minimum distance from a segment to an AABB. Returns 0 whenever the
 * segment intersects or touches the box (crossing-through included); otherwise
 * the true segment-to-boundary distance. Correct for horizontal / vertical /
 * diagonal / tangent / near-but-outside / degenerate segments — no sampling.
 */
export function distSegBox(a: Vec2, b: Vec2, box: Aabb): number {
  if (segIntersectsAabb(a, b, box)) return 0
  // Outside and non-crossing → closest approach is to one of the four edges;
  // for two non-crossing 2D segments that is the min of the four endpoint→segment distances.
  const c: Vec2[] = [
    [box.minX, box.minZ],
    [box.maxX, box.minZ],
    [box.maxX, box.maxZ],
    [box.minX, box.maxZ],
  ]
  let best = Infinity
  for (let i = 0; i < 4; i++) {
    const e0 = c[i]
    const e1 = c[(i + 1) % 4]
    best = Math.min(best, distPointSeg(a, e0, e1), distPointSeg(b, e0, e1), distPointSeg(e0, a, b), distPointSeg(e1, a, b))
  }
  return best
}

export function findLoopWalkClearanceViolations(
  citizens: readonly AmbientCitizen[] = AMBIENT_CITIZENS,
  intersections: readonly CompiledCrossIntersection[] = INTERSECTIONS,
  waitClearance = WAIT_CLEARANCE,
): ClearanceViolation[] {
  const violations: ClearanceViolation[] = []
  const waitSpots: Vec2[] = intersections.flatMap((x) => x.crossings.flatMap((cr) => cr.waitSpots))
  const boxes = intersections.map((x) => x.bounds)

  for (const loop of citizens) {
    if (loop.behaviorType !== 'loop_walk' || !loop.waypoints) continue
    for (const [a, b] of loopSegments(loop.waypoints)) {
      for (const ws of waitSpots) {
        const d = distPointSeg(ws, a, b)
        if (d < waitClearance)
          violations.push({ citizenId: loop.id, kind: 'crossing_wait', at: ws, detail: `${d.toFixed(2)} from crossing wait spot (${ws[0]},${ws[1]}); need ≥ ${waitClearance}` })
      }
      for (const box of boxes) {
        const d = distSegBox(a, b, box)
        if (d < JUNCTION_MARGIN)
          violations.push({ citizenId: loop.id, kind: 'junction_box', at: a, detail: `${d.toFixed(2)} from junction box; need ≥ ${JUNCTION_MARGIN}` })
      }
    }
  }
  return violations
}
