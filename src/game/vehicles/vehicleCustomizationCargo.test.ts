import { afterEach, describe, expect, it } from 'vitest'
import {
  UPGRADE_DEFS,
  availableUpgradesFor,
  canInstallUpgrade,
  canPaint,
  cargoSlotBonus,
  performanceDelta,
  validateUpgradeRegistry,
  wearFactorOf,
} from './vehicleCustomization'
import { cargoCapacityOf, loadCargo, unloadCargo } from './vehicleCargo'
import {
  getActiveVehicleProjection,
} from './vehicleProjection'
import { noteActiveVehicleImpact } from './vehicleService'
import { mintOwnedVehicle, resetVehicleOwnership, setActiveVehicle } from './vehicleOwnershipRuntime'
import { getVehicleDef } from './vehicleRegistry'

afterEach(() => resetVehicleOwnership())

function mint(defId: string, upgrades: string[] = []) {
  const v = mintOwnedVehicle(defId, { acquiredVia: 'purchase', receipt: `r_${Math.random()}`, day: 1, price: 0, location: { kind: 'parked', anchorId: 'a' } })
  v.customization.upgrades = upgrades
  return v
}

describe('vehicle customization', () => {
  it('validates the upgrade registry clean', () => {
    expect(validateUpgradeRegistry()).toEqual([])
    expect(UPGRADE_DEFS.length).toBeGreaterThanOrEqual(3)
  })

  it('offers only class-compatible upgrades (the Van has no performance tune)', () => {
    const vanUpgrades = availableUpgradesFor(getVehicleDef('veh_van')!).map((u) => u.category)
    expect(vanUpgrades).not.toContain('performance')
    expect(availableUpgradesFor(getVehicleDef('veh_compact')!).map((u) => u.category)).toContain('performance')
  })

  it('refuses install when incompatible / already installed / unaffordable', () => {
    const van = mint('veh_van')
    // Van disallows performance.
    expect(canInstallUpgrade(van.id, 'up_sport_tune', 100000)).toEqual({ ok: false, reason: 'incompatible' })
    const compact = mint('veh_compact', ['up_sport_tune'])
    expect(canInstallUpgrade(compact.id, 'up_sport_tune', 100000)).toEqual({ ok: false, reason: 'already_installed' })
    const fresh = mint('veh_compact')
    expect(canInstallUpgrade(fresh.id, 'up_sport_tune', 10)).toEqual({ ok: false, reason: 'insufficient_funds' })
    expect(canInstallUpgrade(fresh.id, 'up_sport_tune', 100000).ok).toBe(true)
  })

  it('validates paint against the class palette', () => {
    const v = mint('veh_compact')
    const def = getVehicleDef('veh_compact')!
    expect(canPaint(v.id, def.paintPalette[0])).toEqual({ ok: true })
    expect(canPaint(v.id, '#ffffff')).toEqual({ ok: false, reason: 'incompatible' })
  })

  it('performance/cargo/durability effect readers reflect installed upgrades', () => {
    const v = mint('veh_compact', ['up_sport_tune', 'up_cargo_rack', 'up_reinforced_frame'])
    expect(performanceDelta(v)).toEqual({ maxSpeed: 2, acceleration: 1 })
    expect(cargoSlotBonus(v)).toBe(4)
    expect(wearFactorOf(v)).toBe(0.5)
  })

  it('a performance upgrade raises the projected top speed (bounded streaming-safe)', () => {
    const stock = mint('veh_compact')
    setActiveVehicle(stock.id)
    const stockSpeed = getActiveVehicleProjection().tuning.maxSpeed
    resetVehicleOwnership()
    const tuned = mint('veh_compact', ['up_sport_tune'])
    setActiveVehicle(tuned.id)
    const tunedSpeed = getActiveVehicleProjection().tuning.maxSpeed
    expect(tunedSpeed).toBe(stockSpeed + 2)
    expect(tunedSpeed).toBeLessThanOrEqual(20) // never outruns streaming
  })

  it('a durability upgrade halves impact wear', () => {
    const tough = mint('veh_compact', ['up_reinforced_frame'])
    tough.condition = 100
    setActiveVehicle(tough.id)
    const lost = noteActiveVehicleImpact(20)
    // Base loss for speed 20 is min(20, round(14*1.5))=20; halved → 10.
    expect(lost).toBe(10)
    expect(tough.condition).toBe(90)
  })
})

describe('vehicle cargo (over the inventory service)', () => {
  it('capacity = class base + cargo upgrade', () => {
    const base = mint('veh_van')
    expect(cargoCapacityOf(base)).toBe(getVehicleDef('veh_van')!.cargoCapacity)
    const racked = mint('veh_van', ['up_cargo_rack'])
    expect(cargoCapacityOf(racked)).toBe(getVehicleDef('veh_van')!.cargoCapacity + 4)
  })

  it('load then unload moves items atomically with no duplication or loss', () => {
    const v = mint('veh_van')
    const backpack = { snack: 3 }
    const loaded = loadCargo(backpack, v, 'snack', 2)
    expect(loaded.ok).toBe(true)
    if (!loaded.ok) return
    expect(loaded.backpack['snack']).toBe(1)
    expect(loaded.cargo['snack']).toBe(2)
    // Apply + unload one back.
    v.cargo = loaded.cargo
    const unloaded = unloadCargo(loaded.backpack, v, 'snack', 1)
    expect(unloaded.ok).toBe(true)
    if (!unloaded.ok) return
    expect(unloaded.backpack['snack']).toBe(2)
    expect(unloaded.cargo['snack']).toBe(1)
  })

  it('an impounded vehicle cargo is inaccessible', () => {
    const v = mintOwnedVehicle('veh_van', { acquiredVia: 'purchase', receipt: 'i', day: 1, price: 0, location: { kind: 'impound' } })
    expect(loadCargo({ snack: 1 }, v, 'snack', 1)).toEqual({ ok: false, reason: 'unavailable' })
  })
})
