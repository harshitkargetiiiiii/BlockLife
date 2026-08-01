import { beforeEach, describe, expect, it } from 'vitest'
import {
  canGiveRide,
  getRidePassenger,
  hasUsableRideVehicle,
  resetVehicleRide,
  setRidePassenger,
} from './vehicleSocial'
import {
  mintOwnedVehicle,
  resetVehicleOwnership,
  setVehicleCondition,
  setVehicleLocation,
} from './vehicleOwnershipRuntime'
import { getDerivedRelationship, ingestSocialEvent, resetSocial } from '../social/socialRuntime'

// Maya starts as a pure stranger (defaultRelationship rel({})), so tier transitions here are earned,
// never seeded — unlike Ravi, who begins friendly.
const MAYA = 'npc_maya_01'

const own = (defId: string, i = 0) =>
  mintOwnedVehicle(defId, {
    acquiredVia: 'purchase',
    receipt: `r${i}`,
    day: 1,
    price: 1000,
    location: { kind: 'parked', anchorId: `park_${i}` },
  })

/** Raise `id` to the FRIENDLY tier through the real event pipeline (no test back-door). */
function befriend(id: string): void {
  for (let d = 1; d <= 4; d++) {
    ingestSocialEvent({ id: `ride_test_act_${id}_${d}`, kind: 'activity_completed', actorId: id, gameDay: d, gameHour: 12 })
  }
}

describe('vehicle → social ride adapter (issue #19 §11)', () => {
  beforeEach(() => {
    resetVehicleOwnership()
    resetSocial()
    resetVehicleRide()
  })

  it('hasUsableRideVehicle needs an owned seats>=2 vehicle with positive condition, not impounded', () => {
    expect(hasUsableRideVehicle()).toBe(false) // own nothing
    own('veh_scooter', 0) // seats 1 — never a ride vehicle
    expect(hasUsableRideVehicle()).toBe(false)
    const compact = own('veh_compact', 1) // seats 4
    expect(hasUsableRideVehicle()).toBe(true)
    // A wrecked (condition 0) or impounded vehicle can't carry a passenger.
    setVehicleCondition(compact.id, 0)
    expect(hasUsableRideVehicle()).toBe(false)
    setVehicleCondition(compact.id, 80)
    expect(hasUsableRideVehicle()).toBe(true)
    setVehicleLocation(compact.id, { kind: 'impound' })
    expect(hasUsableRideVehicle()).toBe(false)
  })

  it('canGiveRide requires having met, a friendly+ relationship, and a usable vehicle', () => {
    own('veh_compact', 0)
    // A stranger (never met) is refused as ineligible.
    expect(canGiveRide(MAYA)).toEqual({ ok: false, reason: 'ineligible' })
    ingestSocialEvent({ id: 'met', kind: 'met', actorId: MAYA, gameDay: 1, gameHour: 9 })
    // Met but only an acquaintance — still ineligible (a ride is never bought with vehicle value).
    expect(getDerivedRelationship(MAYA).tier).toBe('acquaintance')
    expect(canGiveRide(MAYA)).toEqual({ ok: false, reason: 'ineligible' })
    befriend(MAYA)
    expect(['friendly', 'trusted', 'close']).toContain(getDerivedRelationship(MAYA).tier)
    expect(canGiveRide(MAYA)).toEqual({ ok: true })
  })

  it('a friendly NPC is still refused when there is no usable vehicle', () => {
    befriend(MAYA)
    expect(getDerivedRelationship(MAYA).tier).toBe('friendly')
    // Own only a scooter — friend, but no passenger seat.
    own('veh_scooter', 0)
    expect(canGiveRide(MAYA)).toEqual({ ok: false, reason: 'unavailable' })
  })

  it('the passenger runtime is a simple transient slot (set / read / reset)', () => {
    expect(getRidePassenger()).toBeNull()
    setRidePassenger(MAYA)
    expect(getRidePassenger()).toBe(MAYA)
    resetVehicleRide()
    expect(getRidePassenger()).toBeNull()
  })
})
