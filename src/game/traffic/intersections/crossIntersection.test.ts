import { describe, expect, it } from 'vitest'
import {
  compileCrossIntersection,
  crossingTraverseSeconds,
  getCrossingEntrySignal,
  getCrossingSignal,
  getIntersectionPhaseAt,
  getMovementSignal,
  validateCrossIntersection,
} from './crossIntersection'

const SPEC = {
  localId: 'harbor_cross',
  center: [48, -160] as [number, number],
  districtId: 'waterfront_north',
}

describe('cross-street intersection compile', () => {
  it('is deterministic with stable ids and exactly 12 movements', () => {
    const a = compileCrossIntersection('s0_-2', SPEC)
    const b = compileCrossIntersection('s0_-2', SPEC)
    expect(a.intersection.movements).toEqual(b.intersection.movements)
    expect(a.segments).toEqual(b.segments)
    expect(a.intersection.movements).toHaveLength(12)
    for (const m of a.intersection.movements) {
      expect(m.segmentId.startsWith('s0_-2_harbor_cross_')).toBe(true)
    }
    // Every approach has straight, left and right — and nothing else.
    for (const approach of ['south', 'north', 'east', 'west']) {
      const kinds = a.intersection.movements.filter((m) => m.approach === approach).map((m) => m.kind)
      expect(kinds.sort()).toEqual(['left', 'right', 'straight'])
    }
  })

  it('movement paths stay inside the junction bounds; validation is clean', () => {
    const { intersection } = compileCrossIntersection('s0_-2', SPEC)
    expect(validateCrossIntersection(intersection)).toEqual([])
  })

  it('right-hand rule: no illegal reverse movements exist', () => {
    const { intersection, segments } = compileCrossIntersection('s0_-2', SPEC)
    // A northbound (south approach) car enters at x = cx+off and its
    // straight exit continues north on the SAME side — never onto the
    // southbound lane (x = cx-off).
    const straight = intersection.movements.find((m) => m.approach === 'south' && m.kind === 'straight')!
    expect(straight.path[0][0]).toBe(50)
    expect(straight.path[straight.path.length - 1][0]).toBe(50)
    // No movement returns to its own entry edge (no U-turns in the box).
    for (const m of intersection.movements) {
      const first = m.path[0]
      const last = m.path[m.path.length - 1]
      expect(first[0] !== last[0] || first[1] !== last[1]).toBe(true)
    }
    expect(segments.every((s) => s.kind === 'junction')).toBe(true)
  })

  it('conflict groups: perpendicular straights conflict, same-approach never does', () => {
    const { intersection } = compileCrossIntersection('s0_-2', SPEC)
    const sStraight = intersection.movements.find((m) => m.id === 'harbor_cross_south_straight')!
    const eStraight = intersection.movements.find((m) => m.id === 'harbor_cross_east_straight')!
    const shared = sStraight.conflictGroupIds.filter((g) => eStraight.conflictGroupIds.includes(g))
    expect(shared.length).toBeGreaterThan(0)
    // Opposing straights run on parallel offset lanes — no crossing.
    const nStraight = intersection.movements.find((m) => m.id === 'harbor_cross_north_straight')!
    const opposing = sStraight.conflictGroupIds.filter((g) => nStraight.conflictGroupIds.includes(g))
    expect(opposing).toEqual([])
    // Left turns conflict with opposing straight traffic.
    const sLeft = intersection.movements.find((m) => m.id === 'harbor_cross_south_left')!
    const leftVsOpposing = sLeft.conflictGroupIds.filter((g) => nStraight.conflictGroupIds.includes(g))
    expect(leftVsOpposing.length).toBeGreaterThan(0)
  })

  it('stop lines sit before the box on every approach', () => {
    const { intersection } = compileCrossIntersection('s0_-2', SPEC)
    expect(intersection.stopLines).toHaveLength(4)
    expect(intersection.stopLines.find((l) => l.approach === 'south')!.position[1]).toBeGreaterThan(
      intersection.bounds.maxZ,
    )
    expect(intersection.stopLines.find((l) => l.approach === 'north')!.position[1]).toBeLessThan(
      intersection.bounds.minZ,
    )
  })
})

describe('signal plan', () => {
  const { intersection } = compileCrossIntersection('s0_-2', SPEC)

  it('phase progression is deterministic and cycles cleanly', () => {
    const cycle = intersection.cycleLength
    expect(cycle).toBe(8 + 2 + 8 + 2 + 6 + 2 + 6 + 2 + 8 + 2)
    expect(getIntersectionPhaseAt(intersection, 0).step.id).toBe('green_south')
    expect(getIntersectionPhaseAt(intersection, 0)).toEqual(getIntersectionPhaseAt(intersection, cycle))
    expect(getIntersectionPhaseAt(intersection, 9).step.id).toBe('clear_south')
    expect(getIntersectionPhaseAt(intersection, 11).step.id).toBe('green_north')
  })

  it('exactly one approach (or pedestrians) is served at a time', () => {
    for (let t = 0.5; t < intersection.cycleLength; t += 1) {
      const { step } = getIntersectionPhaseAt(intersection, t)
      expect(step.permittedVehicleGroups.length).toBeLessThanOrEqual(1)
      if (step.permittedPedestrianGroups.length > 0) {
        expect(step.permittedVehicleGroups).toEqual([])
      }
    }
  })

  it('movement and crossing signals derive from the same clock', () => {
    expect(getMovementSignal(intersection, 'south', 1)).toBe('green')
    expect(getMovementSignal(intersection, 'north', 1)).toBe('red')
    expect(getMovementSignal(intersection, 'north', 11)).toBe('green')
    const walkStart = intersection.cycleLength - 10 // walk_all begins here
    expect(getCrossingSignal(intersection, walkStart + 1)).toBe('walk')
    expect(getCrossingSignal(intersection, 1)).toBe('dont_walk')
    for (let t = 0; t < intersection.cycleLength; t += 0.5) {
      if (getCrossingSignal(intersection, t) === 'walk') {
        for (const approach of ['south', 'north', 'east', 'west'] as const) {
          expect(getMovementSignal(intersection, approach, t)).toBe('red')
        }
      }
    }
  })

  it('a broken plan (two conflicting approaches green) fails validation', () => {
    const broken = {
      ...intersection,
      phases: intersection.phases.map((p) =>
        p.id === 'green_south' ? { ...p, permittedVehicleGroups: ['south', 'east'] } : p,
      ),
    }
    const errors = validateCrossIntersection(broken)
    expect(errors.some((e) => /conflicting movements/.test(e))).toBe(true)
  })
})

describe('pedestrian crossings (live crossing v1)', () => {
  const { intersection } = compileCrossIntersection('s0_-2', SPEC)
  const walkStart = intersection.cycleLength - 10 // walk_all 8s + clear_walk 2s

  it('crossings carry curb wait spots clear of the roadway; stop lines sit behind the bands', () => {
    expect(validateCrossIntersection(intersection)).toEqual([])
    for (const c of intersection.crossings) {
      expect(c.waitSpots).toHaveLength(2)
    }
    // Regression guard: stop lines once sat 1.4 past the box edge — INSIDE
    // the crossing band, parking yielding cars on pedestrians.
    const south = intersection.stopLines.find((l) => l.approach === 'south')!
    const band = intersection.crossings.find((c) => c.arm === 'south')!
    expect(Math.abs(south.position[1] - band.center[1])).toBeGreaterThan(band.halfExtents[1])
  })

  it('movement segments name their entry and exit crossings for vehicle yields', () => {
    const { segments } = compileCrossIntersection('s0_-2', SPEC)
    const straight = segments.find((s) => s.id === 's0_-2_harbor_cross_south_straight')!
    expect(straight.crossingZoneIds).toEqual([
      's0_-2_harbor_cross_cross_south',
      's0_-2_harbor_cross_cross_north',
    ])
    const right = segments.find((s) => s.id === 's0_-2_harbor_cross_south_right')!
    expect(right.crossingZoneIds).toEqual([
      's0_-2_harbor_cross_cross_south',
      's0_-2_harbor_cross_cross_east',
    ])
  })

  it('entry signal: walk only with enough remaining time, clearance after, dont_walk on greens', () => {
    const crossing = intersection.crossings[0]
    const need = crossingTraverseSeconds(crossing)
    expect(need).toBeLessThanOrEqual(10) // fits walk 8 + clearance 2
    expect(getCrossingEntrySignal(intersection, crossing, walkStart + 0.5)).toBe('walk')
    // Deep into walk: remaining + clearance no longer covers the traverse.
    expect(getCrossingEntrySignal(intersection, crossing, walkStart + 7.9)).toBe('clearance')
    // clear_walk phase: committed crossers finish, nobody new enters.
    expect(getCrossingEntrySignal(intersection, crossing, walkStart + 8.5)).toBe('clearance')
    // Vehicle service: hard dont_walk.
    expect(getCrossingEntrySignal(intersection, crossing, 1)).toBe('dont_walk')
    expect(getCrossingEntrySignal(intersection, crossing, 21)).toBe('dont_walk')
  })

  it('an infeasible crossing (walk too short to traverse) fails validation', () => {
    const wide = compileCrossIntersection('s0_-2', { ...SPEC, halfSize: 6, walkSeconds: 2, clearanceSeconds: 1 })
    const errors = validateCrossIntersection(wide.intersection)
    expect(errors.some((e) => /needs .*s but walk\+clearance/.test(e))).toBe(true)
  })

  it('a wait spot on the roadway fails validation', () => {
    const broken = {
      ...intersection,
      crossings: intersection.crossings.map((c) =>
        c.arm === 'south' ? { ...c, waitSpots: [[48, c.center[1]], c.waitSpots[1]] as never } : c,
      ),
    }
    expect(validateCrossIntersection(broken).some((e) => /stands on the roadway/.test(e))).toBe(true)
  })
})
