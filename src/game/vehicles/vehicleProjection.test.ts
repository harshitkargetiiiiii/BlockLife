import { afterEach, describe, expect, it } from 'vitest'
import { getActiveVehicleProjection, conditionWear } from './vehicleProjection'
import {
  mintOwnedVehicle,
  setActiveVehicle,
  setVehicleCondition,
  resetVehicleOwnership,
} from './vehicleOwnershipRuntime'
import { VEHICLE_TUNING } from './vehicleTypes'
import { CAR_HALF_LENGTH, CAR_HALF_WIDTH } from '../traffic/vehicleObstacles'
import { getVehicleDef } from './vehicleRegistry'

afterEach(() => resetVehicleOwnership())

describe('one-shell vehicle projection', () => {
  it('with no owned vehicle projects the exact legacy Compact baseline', () => {
    const p = getActiveVehicleProjection()
    expect(p.ownedId).toBeNull()
    expect(p.defId).toBe('veh_compact')
    expect(p.halfLength).toBe(CAR_HALF_LENGTH)
    expect(p.halfWidth).toBe(CAR_HALF_WIDTH)
    expect(p.conditionDisabled).toBe(false)
    // Tuning matches VEHICLE_TUNING field-for-field (mass aside — the controller ignores it).
    for (const k of Object.keys(VEHICLE_TUNING) as (keyof typeof VEHICLE_TUNING)[]) {
      expect(p.tuning[k], k).toBe(VEHICLE_TUNING[k])
    }
  })

  it('condition wear is identity at 100 and floored below', () => {
    expect(conditionWear(100)).toBe(1)
    expect(conditionWear(0)).toBeCloseTo(0.75, 6)
    expect(conditionWear(50)).toBeGreaterThan(0.75)
    expect(conditionWear(50)).toBeLessThan(1)
    // Monotonic non-decreasing in condition.
    expect(conditionWear(80)).toBeGreaterThan(conditionWear(40))
  })

  it('an active pristine owned Compact drives exactly like the baseline', () => {
    const v = mintOwnedVehicle('veh_compact', { acquiredVia: 'purchase', receipt: 'r1', day: 1, price: 4200, location: { kind: 'active' } })
    setActiveVehicle(v.id)
    const p = getActiveVehicleProjection()
    expect(p.ownedId).toBe(v.id)
    expect(p.tuning.maxSpeed).toBe(VEHICLE_TUNING.maxSpeed)
    expect(p.tuning.acceleration).toBe(VEHICLE_TUNING.acceleration)
  })

  it('projects the active class footprint + tuning (van is bigger and hauls slower)', () => {
    const v = mintOwnedVehicle('veh_van', { acquiredVia: 'purchase', receipt: 'r2', day: 1, price: 6800, location: { kind: 'active' } })
    setActiveVehicle(v.id)
    const van = getVehicleDef('veh_van')!
    const p = getActiveVehicleProjection()
    expect(p.defId).toBe('veh_van')
    expect(p.halfLength).toBe(van.halfLength)
    expect(p.halfWidth).toBe(van.halfWidth)
    expect(p.tuning.maxSpeed).toBe(van.tuning.maxSpeed) // pristine → identity wear
    expect(p.halfLength).toBeGreaterThan(CAR_HALF_LENGTH)
  })

  it('a worn vehicle is slower but still drivable; condition 0 is disabled', () => {
    const v = mintOwnedVehicle('veh_compact', { acquiredVia: 'purchase', receipt: 'r3', day: 1, price: 4200, location: { kind: 'active' } })
    setActiveVehicle(v.id)
    setVehicleCondition(v.id, 40)
    const worn = getActiveVehicleProjection()
    expect(worn.tuning.maxSpeed).toBeLessThan(VEHICLE_TUNING.maxSpeed)
    expect(worn.tuning.maxSpeed).toBeGreaterThan(0)
    expect(worn.conditionDisabled).toBe(false)

    setVehicleCondition(v.id, 0)
    const dead = getActiveVehicleProjection()
    expect(dead.conditionDisabled).toBe(true)
  })

  it('reflects installed paint on the shell', () => {
    const v = mintOwnedVehicle('veh_sports', { acquiredVia: 'purchase', receipt: 'r4', day: 1, price: 24000, location: { kind: 'active' } })
    v.customization.paint = '#2c2c33'
    setActiveVehicle(v.id)
    expect(getActiveVehicleProjection().paint).toBe('#2c2c33')
  })
})
