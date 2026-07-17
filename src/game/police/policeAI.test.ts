import { beforeEach, describe, expect, it } from 'vitest'
import type { Vec2 } from '../world/worldTypes'
import { resetPoliceRuntime, spawnPoliceUnit } from './policeRuntime'
import {
  ARREST_HOLD_SECONDS,
  POLICE_LOS_RANGE,
  stepPoliceUnit,
  type PoliceStepContext,
} from './policeAI'

beforeEach(() => resetPoliceRuntime())

const clearLos = () => true
const noLos = () => false

function ctx(over: Partial<PoliceStepContext>): PoliceStepContext {
  return {
    suspectPos: [0, 0],
    lastKnown: null,
    suspectInVehicle: false,
    suspectSpeed: 0,
    forceCombat: false,
    gameTime: 100,
    dt: 1 / 60,
    hasLos: clearLos,
    ...over,
  }
}

describe('police AI stepping', () => {
  it('pursues on foot toward a seen suspect and closes distance', () => {
    const u = spawnPoliceUnit('vehicle', [20, 0], 'inc', 0)
    const before = Math.hypot(u.position[0], u.position[1])
    const r = stepPoliceUnit(u, ctx({ suspectPos: [0, 0], suspectSpeed: 5, dt: 0.5 }))
    expect(r.sees).toBe(true)
    expect(u.state).toBe('pursuing_on_foot')
    expect(Math.hypot(u.position[0], u.position[1])).toBeLessThan(before)
  })

  it('pursues by vehicle when the suspect is driving', () => {
    const u = spawnPoliceUnit('vehicle', [30, 0], 'inc', 0)
    const r = stepPoliceUnit(u, ctx({ suspectInVehicle: true, suspectSpeed: 10, dt: 0.5 }))
    expect(u.state).toBe('pursuing_vehicle')
    expect(r.sees).toBe(true)
  })

  it('does not see a suspect beyond LOS range or behind cover', () => {
    const far = spawnPoliceUnit('vehicle', [POLICE_LOS_RANGE + 5, 0], 'inc', 0)
    expect(stepPoliceUnit(far, ctx({ suspectSpeed: 1 })).sees).toBe(false)

    const blocked = spawnPoliceUnit('vehicle', [10, 0], 'inc', 0)
    expect(stepPoliceUnit(blocked, ctx({ hasLos: noLos })).sees).toBe(false)
  })

  it('arrests a stopped, cornered suspect only after the hold window', () => {
    const u = spawnPoliceUnit('officer', [2, 0], 'inc', 0)
    const c = ctx({ suspectPos: [0, 0], suspectSpeed: 0, dt: 0.4 })
    // Within arrest range + stopped → attempting_arrest, timer accrues.
    let r = stepPoliceUnit(u, c)
    expect(u.state).toBe('attempting_arrest')
    expect(r.arrested).toBe(false)
    // Accumulate past the hold threshold.
    let arrested = false
    for (let i = 0; i < Math.ceil(ARREST_HOLD_SECONDS / 0.4) + 1; i++) {
      arrested = stepPoliceUnit(u, c).arrested || arrested
    }
    expect(arrested).toBe(true)
  })

  it('never arrests a suspect who keeps moving', () => {
    const u = spawnPoliceUnit('officer', [2, 0], 'inc', 0)
    for (let i = 0; i < 20; i++) {
      const r = stepPoliceUnit(u, ctx({ suspectSpeed: 6, dt: 0.4 }))
      expect(r.arrested).toBe(false)
    }
    expect(u.arrestTimer).toBe(0)
  })

  it('does not arrest a suspect sitting in a vehicle (must be on foot)', () => {
    const u = spawnPoliceUnit('officer', [2, 0], 'inc', 0)
    const r = stepPoliceUnit(u, ctx({ suspectSpeed: 0, suspectInVehicle: true, dt: 0.4 }))
    expect(r.arrested).toBe(false)
    expect(u.state).toBe('pursuing_vehicle')
  })

  it('searches the last-known position when it loses sight', () => {
    const u = spawnPoliceUnit('vehicle', [40, 0], 'inc', 0)
    u.state = 'pursuing_on_foot'
    const r = stepPoliceUnit(u, ctx({ hasLos: noLos, lastKnown: [0, 0] as Vec2, dt: 0.5 }))
    expect(r.sees).toBe(false)
    expect(u.state).toBe('searching')
    expect(u.target).toEqual([0, 0])
  })

  it('enters combat against an armed-and-dangerous suspect it can see', () => {
    const u = spawnPoliceUnit('officer', [12, 0], 'inc', 0)
    const r = stepPoliceUnit(u, ctx({ forceCombat: true, suspectSpeed: 2 }))
    expect(u.state).toBe('combat')
    expect(r.sees).toBe(true)
  })

  it('applies the avoidance resolver to the stepped position', () => {
    const u = spawnPoliceUnit('vehicle', [10, 0], 'inc', 0)
    // Resolver pins z to +5 (as if pushed around a building corner).
    stepPoliceUnit(u, ctx({ suspectSpeed: 5, dt: 0.5, avoid: (p) => [p[0], 5] }))
    expect(u.position[1]).toBe(5)
  })
})
