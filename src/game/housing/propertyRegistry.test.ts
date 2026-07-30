import { describe, expect, it } from 'vitest'
import { getInterior } from '../interiors/interiorRegistry'
import {
  DEFAULT_PROPERTY_ID,
  PROPERTY_DEFS,
  PROPERTY_SLOTS,
  getProperty,
  getPropertySlots,
  getSlot,
  slotAccepts,
  validatePropertyRegistry,
} from './propertyRegistry'
import { PROPERTY_TIER_ORDER } from './housingTypes'

describe('property registry', () => {
  it('validates the whole registry with zero problems', () => {
    expect(validatePropertyRegistry()).toEqual([])
  })

  it('ships exactly three tiers with stable ids and distinct interiors', () => {
    expect(PROPERTY_DEFS.map((p) => p.id)).toEqual(['starter_studio', 'city_loft', 'premium_apartment'])
    expect(PROPERTY_DEFS.map((p) => p.tier)).toEqual([...PROPERTY_TIER_ORDER])
    const interiors = PROPERTY_DEFS.map((p) => p.interiorId)
    expect(new Set(interiors).size).toBe(3)
    for (const p of PROPERTY_DEFS) expect(getInterior(p.interiorId)).toBeTruthy()
  })

  it('orders economics by tier (rent + deposit strictly increase)', () => {
    const [starter, loft, premium] = PROPERTY_DEFS
    expect(starter.rent).toBeLessThan(loft.rent)
    expect(loft.rent).toBeLessThan(premium.rent)
    expect(starter.deposit).toBeLessThanOrEqual(loft.deposit)
    expect(loft.deposit).toBeLessThan(premium.deposit)
    expect(starter.deposit).toBe(0) // migrated/default: no deposit
  })

  it('gates the upgrade tiers on real career requirements', () => {
    expect(getProperty('starter_studio')!.requirement).toEqual({})
    expect(getProperty('city_loft')!.requirement.minRank).toBe('regular')
    expect(getProperty('premium_apartment')!.requirement.minRank).toBe('experienced')
    expect(getProperty('premium_apartment')!.requirement.minRecentCareerIncome).toBeGreaterThan(0)
  })

  it('makes the default property the starter and only it needs no tour', () => {
    expect(DEFAULT_PROPERTY_ID).toBe('starter_studio')
    expect(getProperty('starter_studio')!.tourRequired).toBe(false)
    expect(getProperty('city_loft')!.tourRequired).toBe(true)
    expect(getProperty('premium_apartment')!.tourRequired).toBe(true)
  })

  it('authors slots that match maxFurnitureAssets and belong to the property', () => {
    for (const p of PROPERTY_DEFS) {
      const slots = getPropertySlots(p.id)
      expect(slots.length).toBeGreaterThan(0)
      expect(slots.filter((s) => !s.fixtureOnly).length).toBe(p.maxFurnitureAssets)
      for (const s of slots) expect(s.propertyId).toBe(p.id)
    }
    // Larger tiers offer more furnishing room.
    expect(PROPERTY_SLOTS.city_loft.length).toBeGreaterThan(PROPERTY_SLOTS.starter_studio.length)
    expect(PROPERTY_SLOTS.premium_apartment.length).toBeGreaterThan(PROPERTY_SLOTS.city_loft.length)
  })

  it('checks slot compatibility by category and size', () => {
    const bedSlot = getSlot('city_loft', 'lf_bed')!
    expect(slotAccepts(bedSlot, 'bed', 'large')).toBe(true)
    expect(slotAccepts(bedSlot, 'seating', 'small')).toBe(false)
    const tableSlot = getSlot('city_loft', 'lf_coffee')!
    expect(slotAccepts(tableSlot, 'table', 'small')).toBe(true)
    expect(slotAccepts(tableSlot, 'table', 'large')).toBe(false) // maxSize small
  })

  it('flags an out-of-bounds slot', () => {
    const problems = validateWith((slots) => {
      slots.starter_studio = [
        {
          id: 'ss_oob',
          propertyId: 'starter_studio',
          room: 'X',
          local: [99, 99],
          baseRotationY: 0,
          allowedCategories: ['decor'],
          maxSize: 'small',
          allowedRotations: [0],
          clearance: [0.5, 0.5],
        },
        ...slots.starter_studio,
      ]
    })
    expect(problems.some((e) => e.includes('outside the room'))).toBe(true)
  })
})

// Helper: temporarily mutate a copy of the slot map to exercise a failure path.
function validateWith(mutate: (slots: typeof PROPERTY_SLOTS) => void): string[] {
  const backup = JSON.parse(JSON.stringify(PROPERTY_SLOTS))
  try {
    mutate(PROPERTY_SLOTS)
    return validatePropertyRegistry()
  } finally {
    for (const k of Object.keys(PROPERTY_SLOTS) as (keyof typeof PROPERTY_SLOTS)[]) PROPERTY_SLOTS[k] = backup[k]
  }
}
