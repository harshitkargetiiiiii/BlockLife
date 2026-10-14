import { beforeEach, describe, expect, it } from 'vitest'
import { CITIZEN_DESTINATIONS, planPedestrianRoute } from './destinations/pedestrianDestinations'
import { moveTowards } from '../npc/npcBehavior'
import { resolvePersonOccupancy } from '../world/integrity/personOccupancy'
import { collectSolidFootprints } from '../world/solidFootprints'
import { registry } from '../world/runtimeRegistry'
import type { Vec2 } from '../world/worldTypes'
import { PROPS } from '../world/cityLayout'
import { TRACK_B_RELOCATED_CRATES, propsAtContractBaseline } from '../assets/contractPropBaseline'

/**
 * Issue #34 Track B — the yard worker's stall, reproduced on the REAL movement and occupancy path.
 *
 * #34 proved the SEQUENCE on the CI runner: the commuter reaches its final waypoint, then oscillates
 * about 4 units short of `pdest_s-1_-2_w1` (dist 3.89–4.22, `mayMove` true, no crossing) until the 45 s
 * no-progress rule fires and recovery diverts the trip. It did not prove WHY the last 4 units could not
 * be closed.
 *
 * This walks the planner's own final leg with the production step (`moveTowards` at the citizen's
 * `walkSpeed`, capped at `min(dt, 0.1)` exactly as AmbientCitizens does) and the production occupancy
 * contract (`resolvePersonOccupancy`, `onPath: true`), against the real compiled city solids, and
 * applies the same no-progress rule. It compares the PROPOSED position with the RESOLVED one each
 * frame, so any progress the clamp takes back is attributed rather than inferred.
 *
 * What it found, before the fix: Yard 12's `warehouse` front-detail crate (`s-1_-2_w1_front_0`) was
 * placed at `out 1.6` from the wall — its solid footprint spanning out 1.2–2.2 — straddling the door
 * anchor's own doorstep line at `out 1.5`, 3.2 m beside the door. The final leg approaches the door
 * along the frontage, so the walker's centre entered the crate's east face; the MANDATORY static-solid
 * clamp (universal, on-path or not) pushed it back along the minimum-penetration axis — straight back
 * up its own approach — to x = −78.020, the exact position #34 recorded in normal render. It then
 * cycled −78.02 → −78.20 → −78.38 → −78.56 → clamped, never standing closer than 3.98 (its proposed
 * steps, which the no-progress rule measures, reached 3.80), and the no-progress timer climbed to
 * recovery.
 */

const CITIZEN = 'cit_dd_yard_worker'
const HOME_NODE = 'pn_blvd_e_gate'
const DEST_ID = 'pdest_s-1_-2_w1'
const WALK_SPEED = 1.8 // ambientCitizenData.ts
const NO_PROGRESS_LIMIT = 45 // AmbientCitizens: trip.noProgressTime > 45 → recoverTrip
const CRATE_ID = 's-1_-2_w1_front_0'

interface Walk {
  arrived: boolean
  reason: string
  corrections: number
  maxCorrection: number
  /** Closest PROPOSED distance — the quantity AmbientCitizens' no-progress rule measures. */
  closest: number
  /** Closest RESOLVED distance — where the walker actually stood after occupancy. */
  closestResolved: number
  /** Resolved position after the last frame walked. */
  final: Vec2
  /** Where the walker stood (resolved) when the no-progress rule fired. */
  stalledAt?: Vec2
}

/**
 * Walk one leg in AmbientCitizens' exact order (`walking_to_destination`):
 *   1. `moveTowards` proposes the step (`s.pos = res.position`);
 *   2. if it did NOT arrive, the no-progress rule measures the distance from that PROPOSED
 *      position and fires recovery after 45 s without beating `tripLastDist` by 0.05;
 *      if it DID arrive, the trip advances — arrival is decided here, before occupancy;
 *   3. `resolvePersonOccupancy` (`onPath: true`, `isMoving = !arrived`) then resolves the position.
 * Arrival is therefore reported exactly as production decides it; the tests assert SEPARATELY that the
 * resolved position after that frame is really on the anchor. Proposed vs resolved is compared every
 * frame so progress the clamp takes back is attributed, not inferred.
 */
function walkLeg(from: Vec2, target: Vec2, dt: number): Walk {
  let pos: Vec2 = [from[0], from[1]]
  // AmbientCitizens: `tripLastDist` starts at Infinity; progress means beating it by 0.05.
  let tripLastDist = Infinity
  let noProgressTime = 0
  let closest = Infinity
  let closestResolved = Infinity
  let corrections = 0
  let maxCorrection = 0
  for (let frame = 0; frame < 20_000; frame++) {
    const standing: Vec2 = [pos[0], pos[1]]
    const res = moveTowards(pos, target, WALK_SPEED * Math.min(dt, 0.1))
    const proposed: Vec2 = [res.position[0], res.position[1]]
    if (!res.arrived) {
      const dist = Math.hypot(target[0] - proposed[0], target[1] - proposed[1])
      closest = Math.min(closest, dist)
      if (dist < tripLastDist - 0.05) {
        tripLastDist = dist
        noProgressTime = 0
      } else {
        noProgressTime += dt
        if (noProgressTime > NO_PROGRESS_LIMIT) {
          return {
            arrived: false,
            reason: 'no-progress recovery would fire',
            corrections,
            maxCorrection,
            closest,
            closestResolved,
            final: standing,
            stalledAt: standing,
          }
        }
      }
    }
    const resolved: Vec2 = [proposed[0], proposed[1]]
    resolvePersonOccupancy(resolved, CITIZEN, dt, !res.arrived, /* onPath */ true)
    const corr = Math.hypot(resolved[0] - proposed[0], resolved[1] - proposed[1])
    if (corr > 1e-9) {
      corrections++
      maxCorrection = Math.max(maxCorrection, corr)
    }
    pos = resolved
    closestResolved = Math.min(closestResolved, Math.hypot(target[0] - pos[0], target[1] - pos[1]))
    if (res.arrived) {
      return { arrived: true, reason: 'arrived', corrections, maxCorrection, closest: 0, closestResolved, final: pos }
    }
  }
  return { arrived: false, reason: 'frame budget exhausted', corrections, maxCorrection, closest, closestResolved, final: pos }
}

const fmt = (v?: Vec2) => (v ? `[${v[0].toFixed(3)}, ${v[1].toFixed(3)}]` : '—')
const summarize = (w: Walk) =>
  `${w.reason}: closest proposed ${w.closest.toFixed(3)} / resolved ${w.closestResolved.toFixed(3)} to the anchor, ` +
  `${w.corrections} clamp corrections (max ${w.maxCorrection.toFixed(3)}), stalled at ${fmt(w.stalledAt)}`

const dest = () => CITIZEN_DESTINATIONS.find((d) => d.id === DEST_ID)!
const finalLeg = (): [Vec2, Vec2] => {
  const plan = planPedestrianRoute(CITIZEN, HOME_NODE, DEST_ID)!
  const wp = plan.waypoints
  return [wp[wp.length - 2] as Vec2, wp[wp.length - 1] as Vec2]
}

beforeEach(() => {
  registry.npcPositions.clear()
  registry.movingPersonIds.clear()
})

describe('issue #34 Track B — the yard worker reaches Yard 12\'s door on the real occupancy path', () => {
  it('the planner\'s final leg ends at the unchanged door anchor', () => {
    const d = dest()
    expect(d.position, 'destination anchor unchanged').toEqual([-82.36000000000001, -238.5])
    expect(d.capacity, 'capacity unchanged').toBe(2)
    const [, target] = finalLeg()
    expect(target, 'the leg ends at the destination anchor itself').toEqual(d.position)
  })

  for (const [label, dt] of [['a slow runner (step capped at 0.1 s)', 0.1], ['60 fps', 1 / 60]] as const) {
    it(`walks the final leg to the door and arrives truthfully — ${label}`, () => {
      const [from, target] = finalLeg()
      const w = walkLeg(from, target, dt)
      expect(w.arrived, summarize(w)).toBe(true)
      // Independent of how production declares arrival: the RESOLVED position is on the anchor.
      expect(Math.hypot(w.final[0] - target[0], w.final[1] - target[1]), 'resolved position on the anchor').toBeLessThan(1e-6)
    })
  }

  it('a walker coming straight along the doorstep line from the crate side also reaches the door', () => {
    // The shape of #34's stage-1 replan: a one-waypoint route from wherever the walker stands,
    // which on this frontage is the doorstep line itself.
    const target = dest().position as Vec2
    const w = walkLeg([target[0] + 6, target[1]], target, 0.1)
    expect(w.arrived, summarize(w)).toBe(true)
    expect(Math.hypot(w.final[0] - target[0], w.final[1] - target[1]), 'resolved position on the anchor').toBeLessThan(1e-6)
  })

  it('the crate is still solid: collision protection is preserved, not bypassed', () => {
    const crate = collectSolidFootprints().find((s) => s.id === CRATE_ID)
    expect(crate, 'the Yard 12 crate still has a solid footprint').toBeDefined()
    // ...and it no longer covers the doorstep line the anchor sits on.
    const anchorZ = dest().position[1]
    const nearEdge = crate!.position.z - crate!.halfLength
    expect(nearEdge, 'crate footprint clears the doorstep line by at least a person radius').toBeGreaterThan(anchorZ + 0.35)
  })

  it('the fix moved exactly the three warehouse crates, only outward, by exactly 0.9 — nothing else', () => {
    const baseline = propsAtContractBaseline()
    const differing = PROPS.filter((p, i) => JSON.stringify(p) !== JSON.stringify(baseline[i])).map((p) => p.id)
    expect(differing.sort(), 'the only props that differ from the contract baseline').toEqual(
      Object.keys(TRACK_B_RELOCATED_CRATES).sort(),
    )
    for (const [id, m] of Object.entries(TRACK_B_RELOCATED_CRATES)) {
      const p = PROPS.find((x) => x.id === id)!
      expect(p.type, `${id} is still a crate`).toBe('crate')
      expect(p.rotationY, `${id} rotation unchanged`).toBeUndefined()
      expect(p.position[0], `${id} did not move along the frontage`).toBe(m.before[0])
      // All three are SOUTH-door warehouses, so "outward" is +z: out 1.6 -> 2.5 is exactly +0.9.
      expect(p.position[1] - m.before[1], `${id} moved outward by exactly 0.9`).toBeCloseTo(0.9, 9)
    }
  })
})
