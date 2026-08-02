import { afterEach, describe, expect, it } from 'vitest'
import { DELIVERY_PAY_BONUS, deliveryPayBonus, ownsUsableDeliveryVehicle } from './vehicleCareer'
import { mintOwnedVehicle, resetVehicleOwnership, setVehicleCondition, setVehicleLocation } from './vehicleOwnershipRuntime'

afterEach(() => resetVehicleOwnership())

describe('vehicle → career delivery adapter (§10)', () => {
  it('no vehicles → no delivery bonus', () => {
    expect(ownsUsableDeliveryVehicle()).toBe(false)
    expect(deliveryPayBonus()).toBe(0)
  })

  it('a usable delivery-tagged vehicle (Van/Compact) qualifies for the flat capped bonus', () => {
    mintOwnedVehicle('veh_van', { acquiredVia: 'purchase', receipt: 'r', day: 1, price: 6800, location: { kind: 'parked', anchorId: 'a' } })
    expect(ownsUsableDeliveryVehicle()).toBe(true)
    expect(deliveryPayBonus()).toBe(DELIVERY_PAY_BONUS)
  })

  it('a non-delivery class (Scooter) does not qualify', () => {
    mintOwnedVehicle('veh_scooter', { acquiredVia: 'purchase', receipt: 'r', day: 1, price: 900, location: { kind: 'parked', anchorId: 'a' } })
    expect(deliveryPayBonus()).toBe(0)
  })

  it('a disabled or impounded delivery vehicle does not qualify', () => {
    const v = mintOwnedVehicle('veh_van', { acquiredVia: 'purchase', receipt: 'r', day: 1, price: 6800, location: { kind: 'parked', anchorId: 'a' } })
    setVehicleCondition(v.id, 0)
    expect(deliveryPayBonus()).toBe(0)
    setVehicleCondition(v.id, 100)
    setVehicleLocation(v.id, { kind: 'impound' })
    expect(deliveryPayBonus()).toBe(0)
  })
})
