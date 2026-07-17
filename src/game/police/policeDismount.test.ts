import { describe, expect, it } from 'vitest'
import { cruiserExit, planDismounts, POLICE_DISMOUNT_RANGE } from './policeDismount'
import type { PoliceUnit } from './policeTypes'

function cruiser(id: string, pos: [number, number]): PoliceUnit {
  return {
    id,
    kind: 'vehicle',
    state: 'pursuing_vehicle',
    incidentId: 'inc_1',
    target: null,
    position: pos,
    heading: 0,
    health: 100,
    spawnedAt: 0,
    seesSuspect: true,
    arrestTimer: 0,
    timeSinceSeen: 0,
    lastShotAt: -Infinity,
  }
}

function officer(id: string, cruiserId: string): PoliceUnit {
  return { ...cruiser(id, [0, 0]), id, kind: 'officer', cruiserId, state: 'pursuing_on_foot' }
}

describe('planDismounts', () => {
  it('never dismounts when the suspect is in a vehicle', () => {
    const plans = planDismounts({
      units: [cruiser('c1', [10, 10])],
      suspectPos: [10, 10],
      suspectOnFoot: false,
      officerCap: 2,
      currentOfficers: 0,
    })
    expect(plans).toEqual([])
  })

  it('dismounts one officer from a cruiser within range of an on-foot suspect', () => {
    const plans = planDismounts({
      units: [cruiser('c1', [12, 6])],
      suspectPos: [10, 6],
      suspectOnFoot: true,
      officerCap: 2,
      currentOfficers: 0,
    })
    expect(plans).toHaveLength(1)
    expect(plans[0].cruiserId).toBe('c1')
    expect(plans[0].incidentId).toBe('inc_1')
  })

  it('does not dismount from a cruiser beyond dismount range', () => {
    const far: [number, number] = [10 + POLICE_DISMOUNT_RANGE + 5, 6]
    const plans = planDismounts({
      units: [cruiser('c1', far)],
      suspectPos: [10, 6],
      suspectOnFoot: true,
      officerCap: 2,
      currentOfficers: 0,
    })
    expect(plans).toEqual([])
  })

  it('never dismounts twice from the same cruiser', () => {
    const c = cruiser('c1', [11, 6])
    const o = officer('o1', 'c1')
    const plans = planDismounts({
      units: [c, o],
      suspectPos: [10, 6],
      suspectOnFoot: true,
      officerCap: 3,
      currentOfficers: 1,
    })
    expect(plans).toEqual([])
  })

  it('respects the officer cap across multiple cruisers', () => {
    const plans = planDismounts({
      units: [cruiser('c1', [11, 6]), cruiser('c2', [12, 6]), cruiser('c3', [13, 6])],
      suspectPos: [10, 6],
      suspectOnFoot: true,
      officerCap: 2,
      currentOfficers: 1, // one already out → budget is 1
    })
    expect(plans).toHaveLength(1)
  })

  it('emits no plans when the cap is already met', () => {
    const plans = planDismounts({
      units: [cruiser('c1', [11, 6])],
      suspectPos: [10, 6],
      suspectOnFoot: true,
      officerCap: 2,
      currentOfficers: 2,
    })
    expect(plans).toEqual([])
  })
})

describe('cruiserExit geometry', () => {
  it('offsets to the vehicle right side at heading 0 (+x)', () => {
    const [x, z] = cruiserExit(5, 5, 0)
    expect(x).toBeGreaterThan(5)
    expect(z).toBeCloseTo(5, 5)
  })

  it('stays a fixed distance from the cruiser regardless of heading', () => {
    for (const h of [0, Math.PI / 2, Math.PI, -1.3]) {
      const [x, z] = cruiserExit(0, 0, h)
      expect(Math.hypot(x, z)).toBeCloseTo(2.2, 5)
    }
  })
})
