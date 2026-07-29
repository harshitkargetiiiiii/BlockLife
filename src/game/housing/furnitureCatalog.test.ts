import { describe, expect, it } from 'vitest'
import {
  FURNITURE_DEFS,
  activityUnlocks,
  furnitureByCategory,
  getFurnitureDef,
  isFurnitureDefId,
  validateFurnitureCatalog,
} from './furnitureCatalog'

describe('furniture catalog', () => {
  it('validates with zero problems', () => {
    expect(validateFurnitureCatalog()).toEqual([])
  })

  it('ships at least 16 definitions across the required category minimums', () => {
    expect(FURNITURE_DEFS.length).toBeGreaterThanOrEqual(16)
    expect(furnitureByCategory('bed').length).toBeGreaterThanOrEqual(3)
    expect(furnitureByCategory('seating').length).toBeGreaterThanOrEqual(3)
    expect(furnitureByCategory('table').length).toBeGreaterThanOrEqual(2)
    expect(furnitureByCategory('entertainment').length).toBeGreaterThanOrEqual(2)
    expect(furnitureByCategory('storage').length).toBeGreaterThanOrEqual(3)
    expect(furnitureByCategory('wardrobe').length).toBeGreaterThanOrEqual(2)
    expect(furnitureByCategory('lighting').length + furnitureByCategory('decor').length).toBeGreaterThanOrEqual(3)
  })

  it('has unique ids and a stable resolver', () => {
    const ids = new Set(FURNITURE_DEFS.map((d) => d.id))
    expect(ids.size).toBe(FURNITURE_DEFS.length)
    expect(getFurnitureDef('bed_kingsize')?.category).toBe('bed')
    expect(getFurnitureDef('nope')).toBeUndefined()
    expect(isFurnitureDefId('sofa')).toBe(true)
    expect(isFurnitureDefId('ghost')).toBe(false)
  })

  it('beds carry sleep, storage carries storage, seating carries seats', () => {
    for (const d of FURNITURE_DEFS) {
      if (d.sleepQuality > 0) expect(d.category).toBe('bed')
      if (d.storage > 0) expect(d.category).toBe('storage')
    }
    expect(getFurnitureDef('sofa')?.seating).toBe(3)
    expect(getFurnitureDef('bed_kingsize')?.sleepQuality).toBeGreaterThan(getFurnitureDef('bed_futon')!.sleepQuality)
  })

  it('maps entertainment/table pieces to their home activities', () => {
    expect(activityUnlocks('tv_flatscreen')).toContain('movie_night')
    expect(activityUnlocks('coffee_table')).toContain('coffee_home')
    expect(activityUnlocks('dining_table')).toContain('dinner_home')
    expect(activityUnlocks('stool')).toEqual([])
  })

  it('marks the wardrobes as preset-enabling', () => {
    expect(getFurnitureDef('wardrobe_basic')?.enablesWardrobe).toBe(true)
    expect(getFurnitureDef('wardrobe_mirror')?.enablesWardrobe).toBe(true)
    expect(getFurnitureDef('sofa')?.enablesWardrobe).toBeFalsy()
  })
})
