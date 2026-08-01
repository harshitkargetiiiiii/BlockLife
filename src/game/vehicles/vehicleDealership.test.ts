import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  canBuyVehicle,
  canTradeIn,
  commitVehicleSale,
  dealershipListings,
  devSetVehicleStock,
  reconcileVehicleDealership,
  vehicleStockOf,
  vehicleTradeValue,
  type VehiclePurchaseContext,
} from './vehicleDealership'
import { mintOwnedVehicle, resetVehicleOwnership } from './vehicleOwnershipRuntime'
import { resetCommerceRuntime } from '../commerce/commerceRuntime'
import { getVehicleDef } from './vehicleRegistry'

const OK_CTX: VehiclePurchaseContext = { money: 100000, day: 3, wanted: false, incapacitated: false, busy: false }

beforeEach(() => {
  resetVehicleOwnership()
  resetCommerceRuntime()
})
afterEach(() => {
  resetVehicleOwnership()
  resetCommerceRuntime()
})

describe('vehicle dealership (through the commerce authority)', () => {
  it('lists the four vehicle classes and seeds real stock', () => {
    expect(dealershipListings().map((d) => d.id)).toEqual(['veh_scooter', 'veh_compact', 'veh_van', 'veh_sports'])
    expect(vehicleStockOf('veh_compact')).toBeGreaterThan(0)
  })

  it('sells a Compact at exactly its base price when funds allow', () => {
    const r = canBuyVehicle('veh_compact', OK_CTX)
    expect(r.ok).toBe(true)
    expect(r.ok && r.price).toBe(getVehicleDef('veh_compact')!.basePrice)
  })

  it('refuses on insufficient funds', () => {
    const r = canBuyVehicle('veh_compact', { ...OK_CTX, money: 10 })
    expect(r).toEqual({ ok: false, reason: 'insufficient_funds' })
  })

  it('refuses while wanted / incapacitated / busy, in that precedence', () => {
    expect(canBuyVehicle('veh_compact', { ...OK_CTX, wanted: true })).toEqual({ ok: false, reason: 'wanted' })
    expect(canBuyVehicle('veh_compact', { ...OK_CTX, incapacitated: true })).toEqual({ ok: false, reason: 'incapacitated' })
    expect(canBuyVehicle('veh_compact', { ...OK_CTX, busy: true })).toEqual({ ok: false, reason: 'busy' })
  })

  it('refuses the premium sports car without the career requirement', () => {
    // Default career state = no rank / no income → ineligible.
    expect(canBuyVehicle('veh_sports', OK_CTX)).toEqual({ ok: false, reason: 'ineligible' })
  })

  it('refuses at the owned cap', () => {
    for (let i = 0; i < 4; i++) {
      mintOwnedVehicle('veh_scooter', { acquiredVia: 'purchase', receipt: `r${i}`, day: 1, price: 900, location: { kind: 'parked', anchorId: `a${i}` } })
    }
    expect(canBuyVehicle('veh_compact', OK_CTX)).toEqual({ ok: false, reason: 'at_cap' })
  })

  it('refuses when the model is out of stock (provable path)', () => {
    devSetVehicleStock('veh_compact', 0)
    expect(canBuyVehicle('veh_compact', OK_CTX)).toEqual({ ok: false, reason: 'unavailable' })
  })

  it('commits a sale by decrementing real stock and minting a receipt', () => {
    const before = vehicleStockOf('veh_compact')
    const { receipt } = commitVehicleSale('veh_compact')
    expect(vehicleStockOf('veh_compact')).toBe(before - 1)
    expect(receipt).toBeTruthy()
  })

  it('values a trade-in deterministically by condition', () => {
    const def = getVehicleDef('veh_compact')!
    const pristine = mintOwnedVehicle('veh_compact', { acquiredVia: 'purchase', receipt: 'p', day: 1, price: def.basePrice, location: { kind: 'parked', anchorId: 'a' } })
    expect(vehicleTradeValue(pristine)).toBe(def.baseTradeValue)
    pristine.condition = 0
    expect(vehicleTradeValue(pristine)).toBe(Math.round(def.baseTradeValue * 0.4))
  })

  it('trades a settled owned vehicle toward a new one for the net price', () => {
    const old = mintOwnedVehicle('veh_compact', { acquiredVia: 'purchase', receipt: 'p', day: 1, price: 4200, location: { kind: 'parked', anchorId: 'a' } })
    const scooter = getVehicleDef('veh_scooter')!
    const check = canTradeIn(old.id, 'veh_scooter', OK_CTX)
    expect(check.ok).toBe(true)
    expect(check.ok && check.tradeValue).toBe(vehicleTradeValue(old))
    expect(check.ok && check.price).toBe(Math.max(0, scooter.basePrice - vehicleTradeValue(old)))
  })

  it('refuses trading a vehicle that is impounded, active, or carrying cargo', () => {
    const impounded = mintOwnedVehicle('veh_compact', { acquiredVia: 'purchase', receipt: 'i', day: 1, price: 4200, location: { kind: 'impound' } })
    expect(canTradeIn(impounded.id, 'veh_scooter', OK_CTX)).toEqual({ ok: false, reason: 'unavailable' })

    const active = mintOwnedVehicle('veh_compact', { acquiredVia: 'purchase', receipt: 'act', day: 1, price: 4200, location: { kind: 'active' } })
    expect(canTradeIn(active.id, 'veh_scooter', OK_CTX)).toEqual({ ok: false, reason: 'busy' })

    const loaded = mintOwnedVehicle('veh_van', { acquiredVia: 'purchase', receipt: 'l', day: 1, price: 6800, location: { kind: 'parked', anchorId: 'b' } })
    loaded.cargo = { snack: 2 }
    expect(canTradeIn(loaded.id, 'veh_scooter', OK_CTX)).toEqual({ ok: false, reason: 'cargo_not_empty' })
  })

  it('reconcile is idempotent and never throws', () => {
    expect(() => reconcileVehicleDealership(48)).not.toThrow()
    expect(() => reconcileVehicleDealership(48)).not.toThrow()
  })
})
