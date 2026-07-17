import { beforeEach, describe, expect, it } from 'vitest'
import { registry } from '../world/runtimeRegistry'
import {
  DRIVER_FLEE_SECONDS,
  ejectDriver,
  ejectedDriverRuntime,
  getEjectedDrivers,
  isDriverEjected,
  resetEjectedDrivers,
  stepEjectedDrivers,
} from './ejectedDriverRuntime'

// Open ground far from any building so avoidSolids is a no-op.
const CAR: [number, number] = [1000, 1000]
const EXIT: [number, number] = [1002, 1000]

beforeEach(() => {
  resetEjectedDrivers()
  registry.npcPositions.clear()
  registry.movingPersonIds.clear()
})

describe('ejected driver runtime', () => {
  it('ejects a driver once and registers it as a live moving actor', () => {
    const d = ejectDriver({ id: 'd1', vehicleId: 'v1', exit: EXIT, fleeFrom: CAR, color: '#fff', gameTime: 100 })
    expect(d).not.toBeNull()
    expect(isDriverEjected('d1')).toBe(true)
    expect(registry.npcPositions.has('d1')).toBe(true)
    expect(registry.movingPersonIds.has('d1')).toBe(true)
  })

  it('never ejects the same driver twice (no duplicates)', () => {
    ejectDriver({ id: 'd1', vehicleId: 'v1', exit: EXIT, fleeFrom: CAR, color: '#fff', gameTime: 100 })
    const second = ejectDriver({ id: 'd1', vehicleId: 'v1', exit: EXIT, fleeFrom: CAR, color: '#fff', gameTime: 100 })
    expect(second).toBeNull()
    expect(ejectedDriverRuntime.drivers.size).toBe(1)
  })

  it('flees away from the stolen car each step', () => {
    ejectDriver({ id: 'd1', vehicleId: 'v1', exit: EXIT, fleeFrom: CAR, color: '#fff', gameTime: 100 })
    const before = getEjectedDrivers()[0].pos
    const distBefore = Math.hypot(before[0] - CAR[0], before[1] - CAR[1])
    for (let i = 0; i < 20; i++) stepEjectedDrivers(0.05, 100 + i * 0.05)
    const after = getEjectedDrivers()[0].pos
    const distAfter = Math.hypot(after[0] - CAR[0], after[1] - CAR[1])
    expect(distAfter).toBeGreaterThan(distBefore)
  })

  it('despawns after the flee window and cleans up its registrations', () => {
    ejectDriver({ id: 'd1', vehicleId: 'v1', exit: EXIT, fleeFrom: CAR, color: '#fff', gameTime: 100 })
    stepEjectedDrivers(0.05, 100 + DRIVER_FLEE_SECONDS + 1)
    expect(isDriverEjected('d1')).toBe(false)
    expect(registry.npcPositions.has('d1')).toBe(false)
    expect(registry.movingPersonIds.has('d1')).toBe(false)
  })

  it('reset clears every ejected driver and its registrations', () => {
    ejectDriver({ id: 'd1', vehicleId: 'v1', exit: EXIT, fleeFrom: CAR, color: '#fff', gameTime: 100 })
    resetEjectedDrivers()
    expect(ejectedDriverRuntime.drivers.size).toBe(0)
    expect(registry.npcPositions.has('d1')).toBe(false)
  })
})
