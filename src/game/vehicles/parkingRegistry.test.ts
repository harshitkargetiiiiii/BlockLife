import { describe, expect, it } from 'vitest'
import {
  PARKING_ANCHORS,
  validateParkingRegistry,
  getParkingAnchor,
  residenceAnchorFor,
  anchorsInCategory,
  parkingSizeFits,
  DEALERSHIP_ANCHOR_IDS,
  RECOVERY_ANCHOR_ID,
  IMPOUND_ANCHOR_ID,
  SERVICE_ANCHOR_ID,
} from './parkingRegistry'
import { isPointClear } from '../world/collisionQuery'
import { CITY_BOUNDS } from '../world/cityLayout'

describe('parking anchor registry', () => {
  it('validates clean (unique ids, required categories, no anchor footprint overlap)', () => {
    expect(validateParkingRegistry()).toEqual([])
  })

  it('exposes every required category', () => {
    for (const c of ['residence', 'dealership', 'service', 'impound', 'recovery', 'public'] as const) {
      expect(anchorsInCategory(c).length).toBeGreaterThan(0)
    }
  })

  it('maps a residence anchor for all three housing tiers', () => {
    for (const propertyId of ['starter_studio', 'city_loft', 'premium_apartment']) {
      const a = residenceAnchorFor(propertyId)
      expect(a, propertyId).toBeDefined()
      expect(a!.category).toBe('residence')
      expect(a!.propertyId).toBe(propertyId)
    }
  })

  it('resolves the named singleton anchors', () => {
    expect(getParkingAnchor(RECOVERY_ANCHOR_ID)?.category).toBe('recovery')
    expect(getParkingAnchor(IMPOUND_ANCHOR_ID)?.category).toBe('impound')
    expect(getParkingAnchor(SERVICE_ANCHOR_ID)?.category).toBe('service')
    for (const id of DEALERSHIP_ANCHOR_IDS) {
      expect(getParkingAnchor(id)?.category).toBe('dealership')
    }
  })

  it('accepts smaller vehicles in larger bays but not the reverse', () => {
    expect(parkingSizeFits('large', 'small')).toBe(true)
    expect(parkingSizeFits('large', 'large')).toBe(true)
    expect(parkingSizeFits('standard', 'large')).toBe(false)
    expect(parkingSizeFits('small', 'standard')).toBe(false)
  })

  it('every in-bounds anchor sits clear of every building/prop (deterministic world check)', () => {
    // isPointClear only knows the hand-authored central cityLayout (buildings, food truck,
    // kiosk, parked cars) within CITY_BOUNDS. Far-sector anchors are visually certified by the
    // V6 parking baselines; here we assert the whole central set is provably collision-free.
    const central = PARKING_ANCHORS.filter(
      (a) =>
        a.position[0] > CITY_BOUNDS.minX &&
        a.position[0] < CITY_BOUNDS.maxX &&
        a.position[1] > CITY_BOUNDS.minZ &&
        a.position[1] < CITY_BOUNDS.maxZ,
    )
    // The central retail cluster + studio home = every anchor near the origin ring.
    expect(central.length).toBeGreaterThanOrEqual(7)
    for (const a of central) {
      const radius = Math.max(a.halfLength, a.halfWidth)
      expect(isPointClear(a.position[0], a.position[1], radius), a.id).toBe(true)
    }
  })

  it('gives every housing tier and >=3 public districts a spot', () => {
    expect(anchorsInCategory('residence').length).toBeGreaterThanOrEqual(3)
    const publicDistricts = new Set(anchorsInCategory('public').map((a) => a.district))
    expect(publicDistricts.size).toBeGreaterThanOrEqual(3)
  })
})
