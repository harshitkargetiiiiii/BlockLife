import { beforeEach, describe, expect, it } from 'vitest'
import {
  applyVehicleImpact,
  clearStolenPlayerCar,
  getPlayerCarSourceId,
  getVehicleCrimeState,
  getVehicleOccupant,
  impactDamageFor,
  isPlayerCarStolen,
  PLAYER_CAR_ID,
  recordTheft,
  resetVehicleCrimeRuntime,
  setVehicleHealth,
  STEALABLE_VEHICLES,
  validateStealableVehicles,
  VEHICLE_MAX_HEALTH,
} from './vehicleCrimeState'

beforeEach(() => resetVehicleCrimeRuntime())

describe('vehicle crime state', () => {
  it('stealable vehicles validate: unique ids, owners, spacing', () => {
    expect(validateStealableVehicles()).toEqual([])
    expect(STEALABLE_VEHICLES.length).toBeGreaterThanOrEqual(1)
  })

  it('recording a parked theft marks the drivable car stolen + owned', () => {
    const parked = STEALABLE_VEHICLES.find((v) => v.access === 'civilian_parked')!
    const kind = recordTheft(parked.id)
    expect(kind).toBe('vehicle_theft')
    const car = getVehicleCrimeState(PLAYER_CAR_ID)
    expect(car.stolen).toBe(true)
    expect(car.access).toBe('owned_by_player')
    expect(car.ownerId).toBe(parked.ownerId)
    expect(isPlayerCarStolen()).toBe(true)
  })

  it('stealing an occupied (ambient) car is the higher-severity crime', () => {
    expect(recordTheft('vehicle_ambient_car_03')).toBe('occupied_vehicle_theft')
  })

  it('an authored occupied vehicle is a carjack and reports its driver as occupant', () => {
    const occ = STEALABLE_VEHICLES.find((v) => v.access === 'civilian_occupied')!
    expect(occ.driverId).toBeTruthy()
    // Occupied until carjacked.
    expect(getVehicleOccupant(occ.id)).toBe(occ.driverId)
    expect(recordTheft(occ.id)).toBe('occupied_vehicle_theft')
    // Driver is no longer the occupant once the car is stolen.
    expect(getVehicleOccupant(occ.id)).toBeNull()
  })

  it('parked vehicles have no occupant', () => {
    const parked = STEALABLE_VEHICLES.find((v) => v.access === 'civilian_parked')!
    expect(getVehicleOccupant(parked.id)).toBeNull()
  })

  it('impact damage ignores tiny bumps and scales with relative speed', () => {
    expect(impactDamageFor(3)).toBe(0) // below threshold
    expect(impactDamageFor(4)).toBe(0)
    expect(impactDamageFor(10)).toBeGreaterThan(0)
    expect(impactDamageFor(20)).toBeGreaterThan(impactDamageFor(10))
    expect(impactDamageFor(100)).toBeLessThanOrEqual(60) // capped
  })

  it('applies impact damage, debounces repeats, and disables at zero health', () => {
    const id = PLAYER_CAR_ID
    const d1 = applyVehicleImpact(id, 12, 100)
    expect(d1).toBeGreaterThan(0)
    // Same contact 0.3s later is debounced → no extra damage.
    expect(applyVehicleImpact(id, 12, 100.3)).toBe(0)
    // A fresh heavy hit past the window.
    applyVehicleImpact(id, 20, 101)
    expect(getVehicleCrimeState(id).health).toBeLessThan(VEHICLE_MAX_HEALTH)
    // Enough hits wreck it.
    for (let t = 102; t < 130; t++) applyVehicleImpact(id, 30, t)
    const car = getVehicleCrimeState(id)
    expect(car.health).toBe(0)
    expect(car.disabled).toBe(true)
  })

  it('setVehicleHealth clamps and toggles disabled', () => {
    setVehicleHealth(PLAYER_CAR_ID, 250)
    expect(getVehicleCrimeState(PLAYER_CAR_ID).health).toBe(VEHICLE_MAX_HEALTH)
    setVehicleHealth(PLAYER_CAR_ID, 0)
    expect(getVehicleCrimeState(PLAYER_CAR_ID).disabled).toBe(true)
    setVehicleHealth(PLAYER_CAR_ID, 50)
    expect(getVehicleCrimeState(PLAYER_CAR_ID).disabled).toBe(false)
  })

  it('a fresh vehicle starts public, full health, not stolen', () => {
    const rec = getVehicleCrimeState('some_new_car')
    expect(rec.access).toBe('public')
    expect(rec.health).toBe(VEHICLE_MAX_HEALTH)
    expect(rec.stolen).toBe(false)
  })

  it('records the exact source id the drivable car represents', () => {
    expect(getPlayerCarSourceId()).toBeNull()
    recordTheft('theft_parked_plaza')
    expect(getPlayerCarSourceId()).toBe('theft_parked_plaza')
    // Boosting a replacement OVERWRITES the source — a decoy replaces the target.
    recordTheft('theft_parked_market')
    expect(getPlayerCarSourceId()).toBe('theft_parked_market')
  })

  it('clearStolenPlayerCar resets the stolen identity (handoff/terminal)', () => {
    recordTheft('theft_occupied_plaza')
    expect(isPlayerCarStolen()).toBe(true)
    expect(getPlayerCarSourceId()).toBe('theft_occupied_plaza')
    clearStolenPlayerCar()
    expect(isPlayerCarStolen()).toBe(false)
    expect(getPlayerCarSourceId()).toBeNull()
    expect(getVehicleCrimeState(PLAYER_CAR_ID).access).toBe('public')
    // Idempotent.
    expect(() => clearStolenPlayerCar()).not.toThrow()
  })

  it('getPlayerCarSourceId is null once the car is no longer stolen', () => {
    recordTheft('theft_parked_plaza')
    resetVehicleCrimeRuntime()
    expect(getPlayerCarSourceId()).toBeNull()
  })
})
