import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { useGameStore } from './useGameStore'
import { getOwnedVehicles, resetVehicleOwnership, getActiveVehicle, setVehicleLocation } from '../vehicles/vehicleOwnershipRuntime'
import { resetCommerceRuntime } from '../commerce/commerceRuntime'
import { vehicleStockOf } from '../vehicles/vehicleDealership'
import { getVehicleDef } from '../vehicles/vehicleRegistry'
import { getParkingAnchor } from '../vehicles/parkingRegistry'
import { registry } from '../world/runtimeRegistry'
import { beginActivity, cancelActivity, resetSocial } from '../social/socialRuntime'
import { driveAroundActivity } from '../social/socialActivities'

// Buying/trading/retrieving all require the on-foot player to be AT the authored dealership bay
// (§4/§5). Bought cars park at park_dealer_a, so standing there also satisfies the retrieve gate.
const DEALER = getParkingAnchor('park_dealer_a')!
const SERVICE = getParkingAnchor('park_service')!

function setMoney(money: number, day = 3): void {
  useGameStore.setState((st) => ({ stats: { ...st.stats, money, day }, playerIncapacitated: false, mode: 'walking', recovery: null, location: 'city' }))
  registry.playerPosition.set(DEALER.position[0], 1.2, DEALER.position[1])
}

beforeEach(() => {
  resetVehicleOwnership()
  resetCommerceRuntime()
  setMoney(100000)
})
afterEach(() => {
  resetVehicleOwnership()
  resetCommerceRuntime()
})

describe('buyVehicle / tradeInVehicle store actions (atomic money + asset)', () => {
  it('buys a Compact: one owned asset appears, money drops by exactly the price, stock decrements', () => {
    const price = getVehicleDef('veh_compact')!.basePrice
    const stockBefore = vehicleStockOf('veh_compact')
    const moneyBefore = useGameStore.getState().stats.money
    useGameStore.getState().buyVehicle('veh_compact')
    const owned = getOwnedVehicles()
    expect(owned).toHaveLength(1)
    expect(owned[0].defId).toBe('veh_compact')
    expect(owned[0].location.kind).toBe('parked')
    expect(useGameStore.getState().stats.money).toBe(moneyBefore - price)
    expect(vehicleStockOf('veh_compact')).toBe(stockBefore - 1)
  })

  it('refuses on insufficient funds — no asset minted, no money moved', () => {
    setMoney(10)
    useGameStore.getState().buyVehicle('veh_compact')
    expect(getOwnedVehicles()).toHaveLength(0)
    expect(useGameStore.getState().stats.money).toBe(10)
  })

  it('refuses a purchase when the player is NOT at the dealership (§4 — no remote commerce)', () => {
    registry.playerPosition.set(-500, 1.2, -500) // nowhere near a dealership bay
    useGameStore.getState().buyVehicle('veh_compact')
    expect(getOwnedVehicles()).toHaveLength(0)
  })

  it('refuses retrieval when the player is NOT near the vehicle (§5 — no free teleport)', () => {
    useGameStore.getState().buyVehicle('veh_compact')
    const v = getOwnedVehicles()[0]
    registry.playerPosition.set(-500, 1.2, -500) // walked away from the parked car
    useGameStore.getState().retrieveVehicle(v.id)
    expect(getActiveVehicle()).toBeUndefined()
    expect(useGameStore.getState().mode).toBe('walking')
  })

  it('refuses repair/customization away from the service anchor (§7/§9)', () => {
    useGameStore.getState().buyVehicle('veh_compact')
    const v = getOwnedVehicles()[0]
    v.condition = 40
    // Still standing at the dealership, NOT the service anchor.
    const moneyBefore = useGameStore.getState().stats.money
    useGameStore.getState().repairVehicle(v.id)
    expect(getOwnedVehicles()[0].condition).toBe(40) // unchanged — refused
    expect(useGameStore.getState().stats.money).toBe(moneyBefore)
  })

  it('refuses at the owned cap — money unchanged, still exactly four vehicles', () => {
    for (let i = 0; i < 4; i++) useGameStore.getState().buyVehicle('veh_scooter')
    expect(getOwnedVehicles()).toHaveLength(4)
    const moneyAfterFour = useGameStore.getState().stats.money
    useGameStore.getState().buyVehicle('veh_compact')
    expect(getOwnedVehicles()).toHaveLength(4)
    expect(useGameStore.getState().stats.money).toBe(moneyAfterFour)
  })

  it('trade-in is atomic: old vehicle gone, new one owned, net price charged, count unchanged', () => {
    useGameStore.getState().buyVehicle('veh_compact')
    const old = getOwnedVehicles()[0]
    const moneyBefore = useGameStore.getState().stats.money
    const scooter = getVehicleDef('veh_scooter')!
    // Compact trade value (pristine) applied against the scooter's price.
    const compactTradeValue = getVehicleDef('veh_compact')!.baseTradeValue
    const expectedNet = Math.max(0, scooter.basePrice - compactTradeValue)

    useGameStore.getState().tradeInVehicle(old.id, 'veh_scooter')

    const owned = getOwnedVehicles()
    expect(owned).toHaveLength(1) // one left as one arrived — never two, never zero
    expect(owned[0].defId).toBe('veh_scooter')
    expect(owned.find((v) => v.id === old.id)).toBeUndefined() // the old asset is gone
    expect(useGameStore.getState().stats.money).toBe(moneyBefore - expectedNet)
    expect(owned[0].acquiredVia).toBe('trade')
  })

  it('never activates a bought vehicle automatically (it waits parked to be retrieved)', () => {
    useGameStore.getState().buyVehicle('veh_van')
    expect(getActiveVehicle()).toBeUndefined()
  })

  it('repairs a worn vehicle: condition restored to 100, money drops by the quote', () => {
    useGameStore.getState().buyVehicle('veh_compact')
    const v = getOwnedVehicles()[0]
    v.condition = 40
    // Repair happens at the SERVICE anchor — walk there first (§7).
    registry.playerPosition.set(SERVICE.position[0], 1.2, SERVICE.position[1])
    const moneyBefore = useGameStore.getState().stats.money
    useGameStore.getState().repairVehicle(v.id)
    expect(getOwnedVehicles()[0].condition).toBe(100)
    // 60 points * REPAIR_COST_PER_POINT (12) = 720.
    expect(useGameStore.getState().stats.money).toBe(moneyBefore - 60 * 12)
  })

  it('recover sends a DISABLED vehicle to safe holding without charging (§5 emergency)', () => {
    useGameStore.getState().buyVehicle('veh_compact')
    const v = getOwnedVehicles()[0]
    v.condition = 0 // disabled — a legitimate recovery case (a healthy car would be driven instead)
    const moneyBefore = useGameStore.getState().stats.money
    useGameStore.getState().recoverVehicle(v.id)
    expect(getOwnedVehicles()[0].location.kind).toBe('recovery')
    expect(useGameStore.getState().stats.money).toBe(moneyBefore)
  })

  it('release-from-impound charges the fee and returns the car to recovery holding', () => {
    useGameStore.getState().buyVehicle('veh_van')
    const v = getOwnedVehicles()[0]
    setVehicleLocation(v.id, { kind: 'impound' })
    const moneyBefore = useGameStore.getState().stats.money
    useGameStore.getState().releaseVehicleFromImpound(v.id)
    expect(getOwnedVehicles()[0].location.kind).toBe('recovery')
    expect(useGameStore.getState().stats.money).toBeLessThan(moneyBefore)
  })

  it('retrieve → drive → park moves the one shell through active then parked at an anchor', () => {
    useGameStore.getState().buyVehicle('veh_compact')
    const v = getOwnedVehicles()[0]
    // Retrieve: it becomes the single active driven shell.
    useGameStore.getState().retrieveVehicle(v.id)
    expect(getActiveVehicle()?.id).toBe(v.id)
    expect(useGameStore.getState().mode).toBe('driving')
    // Drive up to a public bay and stop, then park.
    const anchor = getParkingAnchor('park_public_central')!
    registry.vehiclePosition.set(anchor.position[0], 0.5, anchor.position[1])
    registry.flags.drivingSpeed = 0
    useGameStore.getState().parkVehicle()
    expect(useGameStore.getState().mode).toBe('walking')
    const parked = getOwnedVehicles()[0]
    expect(parked.location.kind).toBe('parked')
    expect(parked.location.kind === 'parked' && parked.location.anchorId).toBe('park_public_central')
    expect(getActiveVehicle()).toBeUndefined() // parking releases the active shell
  })

  it('arrest while driving an owned vehicle impounds THAT vehicle (§7)', () => {
    useGameStore.getState().buyVehicle('veh_compact')
    const v = getOwnedVehicles()[0]
    useGameStore.getState().retrieveVehicle(v.id) // mode driving, v active
    expect(useGameStore.getState().mode).toBe('driving')
    useGameStore.getState().respawnAfterIncident('arrest')
    expect(getOwnedVehicles()[0].location.kind).toBe('impound')
    // Release restores it to recovery holding for a fee (already covered above); confirm it leaves impound.
    useGameStore.setState((st) => ({ stats: { ...st.stats, money: 100000 }, recovery: null }))
    useGameStore.getState().releaseVehicleFromImpound(v.id)
    expect(getOwnedVehicles()[0].location.kind).toBe('recovery')
  })

  it('cannot park where there is no authored spot nearby', () => {
    useGameStore.getState().buyVehicle('veh_compact')
    const v = getOwnedVehicles()[0]
    useGameStore.getState().retrieveVehicle(v.id)
    registry.vehiclePosition.set(-500, 0.5, -500) // nowhere near any anchor
    registry.flags.drivingSpeed = 0
    useGameStore.getState().parkVehicle()
    expect(useGameStore.getState().mode).toBe('driving') // still driving — park refused
    expect(getActiveVehicle()?.id).toBe(v.id)
  })

  it('installs an upgrade: charges the price and records it once', () => {
    useGameStore.getState().buyVehicle('veh_compact')
    const v = getOwnedVehicles()[0]
    // Customization happens at the SERVICE anchor — walk there first (§9).
    registry.playerPosition.set(SERVICE.position[0], 1.2, SERVICE.position[1])
    const moneyBefore = useGameStore.getState().stats.money
    useGameStore.getState().installVehicleUpgrade(v.id, 'up_sport_tune')
    expect(getOwnedVehicles()[0].customization.upgrades).toContain('up_sport_tune')
    expect(useGameStore.getState().stats.money).toBe(moneyBefore - 3000)
    // A second install of the same category is refused — money unchanged.
    const money2 = useGameStore.getState().stats.money
    useGameStore.getState().installVehicleUpgrade(v.id, 'up_sport_tune')
    expect(useGameStore.getState().stats.money).toBe(money2)
  })

  it('loads and unloads cargo atomically through the backpack', () => {
    useGameStore.getState().buyVehicle('veh_van')
    const v = getOwnedVehicles()[0]
    useGameStore.setState({ inventory: { snack: 3 } })
    useGameStore.getState().loadVehicleCargo(v.id, 'snack', 2)
    expect(useGameStore.getState().inventory['snack']).toBe(1)
    expect(getOwnedVehicles()[0].cargo['snack']).toBe(2)
    useGameStore.getState().unloadVehicleCargo(v.id, 'snack', 2)
    expect(useGameStore.getState().inventory['snack']).toBe(3)
    expect(getOwnedVehicles()[0].cargo['snack'] ?? 0).toBe(0)
  })

  it('owned-vs-stolen separation: an owned vehicle can never be boosted', () => {
    useGameStore.getState().buyVehicle('veh_compact')
    const v = getOwnedVehicles()[0]
    // The steal path only targets stealable/ambient cars; an ov_<n> id is in neither.
    expect(useGameStore.getState().stealVehicle(v.id)).toBe(false)
    // The owned asset is untouched — still a legitimate parked vehicle, not a crime identity.
    expect(getOwnedVehicles()[0].location.kind).toBe('parked')
  })
})

describe('dealership + service refuse during any exclusive activity (§4/§7/§9 review round-3)', () => {
  beforeEach(() => {
    resetVehicleOwnership()
    resetCommerceRuntime()
    resetSocial()
    setMoney(100000)
  })
  afterEach(() => {
    resetSocial()
    resetVehicleOwnership()
  })

  it('buying is refused while a Social Life activity is running, then allowed once it ends', () => {
    // At a dealership bay with funds, but mid social-activity → refused (no asset, no charge).
    beginActivity(driveAroundActivity('npc_maya_01', 3, 0))
    useGameStore.getState().buyVehicle('veh_compact')
    expect(getOwnedVehicles()).toHaveLength(0)
    expect(useGameStore.getState().stats.money).toBe(100000)
    // End the activity → the same purchase now succeeds.
    cancelActivity(3, 12)
    useGameStore.getState().buyVehicle('veh_compact')
    expect(getOwnedVehicles()).toHaveLength(1)
  })

  it('paint/customization is refused while a Social Life activity is running', () => {
    // Own a car parked at the service bay; stand at the service anchor.
    useGameStore.getState().buyVehicle('veh_compact')
    const v = getOwnedVehicles()[0]
    setVehicleLocation(v.id, { kind: 'parked', anchorId: 'park_service' })
    registry.playerPosition.set(SERVICE.position[0], 1.2, SERVICE.position[1])
    beginActivity(driveAroundActivity('npc_maya_01', 3, 1))
    useGameStore.getState().paintVehicle(v.id, '#2c2c33')
    expect(getOwnedVehicles()[0].customization.paint).not.toBe('#2c2c33') // refused mid-activity
    cancelActivity(3, 12)
    useGameStore.getState().paintVehicle(v.id, '#2c2c33')
    expect(getOwnedVehicles()[0].customization.paint).toBe('#2c2c33') // allowed once free
  })
})
