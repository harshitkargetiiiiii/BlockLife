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

/** Min distance from a segment to an AABB (0 if it enters the box). */
function distSegBox(a: Vec2, b: Vec2, box: { minX: number; maxX: number; minZ: number; maxZ: number }): number {
  const inside = (p: Vec2) => p[0] >= box.minX && p[0] <= box.maxX && p[1] >= box.minZ && p[1] <= box.maxZ
  if (inside(a) || inside(b)) return 0
  const corners: Vec2[] = [
    [box.minX, box.minZ],
    [box.maxX, box.minZ],
    [box.maxX, box.maxZ],
    [box.minX, box.maxZ],
  ]
  let best = Infinity
  for (let i = 0; i < 4; i++) {
    const c1 = corners[i]
    const c2 = corners[(i + 1) % 4]
    best = Math.min(best, distPointSeg(c1, a, b), distPointSeg(c2, a, b), distPointSeg(a, c1, c2), distPointSeg(b, c1, c2))
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
