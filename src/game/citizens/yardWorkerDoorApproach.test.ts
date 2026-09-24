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
 * cycled −78.02 → −78.20 → −78.38 → −78.56 → clamped, never closer than ~3.98, and the no-progress
 * timer climbed to recovery.
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
  closest: number
  final: Vec2
  stalledAt?: Vec2
}

/** Walk one leg exactly the way AmbientCitizens steps a trip, with its no-progress rule. */
function walkLeg(from: Vec2, target: Vec2, dt: number): Walk {
  let pos: Vec2 = [from[0], from[1]]
  // AmbientCitizens: `tripLastDist` starts at Infinity; progress means beating it by 0.05.
  let tripLastDist = Infinity
  let noProgressTime = 0
  let closest = Infinity
  let corrections = 0
  let maxCorrection = 0
  for (let frame = 0; frame < 20_000; frame++) {
    const res = moveTowards(pos, target, WALK_SPEED * Math.min(dt, 0.1))
    const proposed: Vec2 = [res.position[0], res.position[1]]
    const resolved: Vec2 = [proposed[0], proposed[1]]
    resolvePersonOccupancy(resolved, CITIZEN, dt, !res.arrived, /* onPath */ true)
    const corr = Math.hypot(resolved[0] - proposed[0], resolved[1] - proposed[1])
    if (corr > 1e-9) {
      corrections++
      maxCorrection = Math.max(maxCorrection, corr)
    }
    pos = resolved
    // Arrival must be truthful: moveTowards reached the anchor AND the resolve did not move it off.
    if (res.arrived && corr < 1e-9) return { arrived: true, reason: 'arrived', corrections, maxCorrection, closest: 0, final: pos }
    const dist = Math.hypot(target[0] - pos[0], target[1] - pos[1])
    closest = Math.min(closest, dist)
    if (dist < tripLastDist - 0.05) {
      tripLastDist = dist
      noProgressTime = 0
    } else {
      noProgressTime += dt
      if (noProgressTime > NO_PROGRESS_LIMIT) {
        return { arrived: false, reason: 'no-progress recovery would fire', corrections, maxCorrection, closest, final: pos, stalledAt: pos }
      }
    }
  }
  return { arrived: false, reason: 'frame budget exhausted', corrections, maxCorrection, closest, final: pos }
}

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
      expect(
        w.arrived,
        `${w.reason}: closest ${w.closest.toFixed(3)} to the anchor, ` +
          `${w.corrections} clamp corrections (max ${w.maxCorrection.toFixed(3)}), ` +
          `stalled at ${w.stalledAt ? `[${w.stalledAt[0].toFixed(3)}, ${w.stalledAt[1].toFixed(3)}]` : '—'}`,
      ).toBe(true)
      // Arrival is truthful: the walker is ON the anchor, not merely near it.
      expect(Math.hypot(w.final[0] - target[0], w.final[1] - target[1])).toBeLessThan(1e-6)
    })
  }

  it('a walker coming straight along the doorstep line from the crate side also reaches the door', () => {
    // The shape of #34's stage-1 replan: a one-waypoint route from wherever the walker stands,
    // which on this frontage is the doorstep line itself.
    const target = dest().position as Vec2
    const w = walkLeg([target[0] + 6, target[1]], target, 0.1)
    expect(w.arrived, `${w.reason}: closest ${w.closest.toFixed(3)}`).toBe(true)
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
