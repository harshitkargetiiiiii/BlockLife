import { describe, expect, it } from 'vitest'
import { computeHomeMetrics } from './homeMetrics'
import { getFurnitureDef } from './furnitureCatalog'
import { getProperty } from './propertyRegistry'
import type { FurnitureDef } from './housingTypes'

const STARTER = getProperty('starter_studio')!
const PREMIUM = getProperty('premium_apartment')!
const def = (id: string): FurnitureDef => getFurnitureDef(id)!
const many = (id: string, n: number): FurnitureDef[] => Array.from({ length: n }, () => def(id))

describe('home metrics calculator', () => {
  it('derives base metrics from the property + fixtures with nothing placed', () => {
    const m = computeHomeMetrics(STARTER, [])
    expect(m.comfort).toBeGreaterThan(0)
    expect(m.style).toBeGreaterThan(0)
    expect(m.storageCapacity).toBe(STARTER.baseStorageCapacity)
    expect(m.sleepQuality).toBe(STARTER.baseSleepQuality)
    expect(m.hostingCapacity).toBe(0) // no seating yet
  })

  it('raises comfort/style when furniture is placed', () => {
    const base = computeHomeMetrics(PREMIUM, [])
    const furnished = computeHomeMetrics(PREMIUM, [def('sofa'), def('area_rug'), def('wall_art')])
    expect(furnished.comfort).toBeGreaterThan(base.comfort)
    expect(furnished.style).toBeGreaterThan(base.style)
  })

  it('CANNOT be inflated by duplicate spam (10 identical sofas stay bounded + sub-linear)', () => {
    const one = computeHomeMetrics(PREMIUM, [def('sofa')])
    const ten = computeHomeMetrics(PREMIUM, many('sofa', 10))
    expect(ten.comfort).toBeLessThanOrEqual(100)
    expect(ten.style).toBeLessThanOrEqual(100)
    // Ten sofas add far less than 10× a single sofa's lift over base.
    const base = computeHomeMetrics(PREMIUM, [])
    const oneLift = one.style - base.style
    const tenLift = ten.style - base.style
    expect(tenLift).toBeLessThan(oneLift * 3) // sharply diminishing, not linear
  })

  it('rewards category COVERAGE over duplicates', () => {
    const twoSofas = computeHomeMetrics(PREMIUM, [def('sofa'), def('sofa')])
    const sofaPlusRug = computeHomeMetrics(PREMIUM, [def('sofa'), def('area_rug')])
    expect(sofaPlusRug.comfort + sofaPlusRug.style).toBeGreaterThan(twoSofas.comfort + twoSofas.style)
  })

  it('uses only the BEST bed for sleep quality (beds do not stack)', () => {
    const futon = computeHomeMetrics(PREMIUM, [def('bed_futon')])
    const king = computeHomeMetrics(PREMIUM, [def('bed_kingsize')])
    const both = computeHomeMetrics(PREMIUM, [def('bed_futon'), def('bed_kingsize')])
    expect(king.sleepQuality).toBeGreaterThan(futon.sleepQuality)
    expect(both.sleepQuality).toBe(king.sleepQuality) // best bed only
  })

  it('sums storage capacity fully and derives hosting from seating (capped by property)', () => {
    const m = computeHomeMetrics(PREMIUM, [def('storage_cabinet'), def('dresser'), def('sofa')])
    expect(m.storageCapacity).toBe(PREMIUM.baseStorageCapacity + def('storage_cabinet').storage + def('dresser').storage)
    // A sofa (3 seats) → hosting min(premium cap 4, 3) = 3.
    expect(m.hostingCapacity).toBe(3)
  })

  it('caps the theme-coherence bonus and keeps every metric within [0,100]', () => {
    const m = computeHomeMetrics(PREMIUM, many('sofa', 20).concat(many('area_rug', 20)))
    expect(m.themeBonus).toBeLessThanOrEqual(8)
    expect(m.comfort).toBeGreaterThanOrEqual(0)
    expect(m.comfort).toBeLessThanOrEqual(100)
    expect(m.style).toBeLessThanOrEqual(100)
  })

  it('offers a deterministic next-upgrade hint', () => {
    expect(computeHomeMetrics(STARTER, []).nextUpgrade).toContain('bed')
  })
})
