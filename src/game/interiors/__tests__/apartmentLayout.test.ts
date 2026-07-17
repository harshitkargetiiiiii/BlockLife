import { beforeEach, describe, expect, it } from 'vitest'
import {
  APARTMENT_FURNITURE,
  APARTMENT_SPAWN,
  APARTMENT_STREET_EXIT,
  INTERIOR_ORIGIN,
  validateApartmentLayout,
} from '../apartmentLayout'
import { APARTMENT_INTERACTABLES } from '../../../data/interactables'
import { CITY_BOUNDS } from '../../world/cityLayout'
import { DEFAULT_APPEARANCE, isPlayerAppearance } from '../interiorTypes'
import { createInitialGameState, useGameStore } from '../../store/useGameStore'

describe('apartment layout', () => {
  it('validates with no errors', () => {
    expect(validateApartmentLayout()).toEqual([])
  })

  it('has unique furniture ids including all core pieces', () => {
    const ids = APARTMENT_FURNITURE.map((f) => f.id)
    expect(new Set(ids).size).toBe(ids.length)
    for (const core of ['bed', 'wardrobe', 'mirror', 'storage', 'desk', 'lamp', 'window', 'door']) {
      expect(ids).toContain(core)
    }
  })

  it('interior sits far outside the city bounds', () => {
    expect(
      INTERIOR_ORIGIN[0] > CITY_BOUNDS.maxX + 50 || INTERIOR_ORIGIN[0] < CITY_BOUNDS.minX - 50,
    ).toBe(true)
  })

  it('street exit is inside the city, near the apartment entrance', () => {
    expect(APARTMENT_STREET_EXIT[0]).toBeGreaterThan(CITY_BOUNDS.minX)
    expect(APARTMENT_STREET_EXIT[0]).toBeLessThan(CITY_BOUNDS.maxX)
    expect(APARTMENT_STREET_EXIT[2]).toBeGreaterThan(CITY_BOUNDS.minZ)
    expect(APARTMENT_STREET_EXIT[2]).toBeLessThan(CITY_BOUNDS.maxZ)
  })

  it('interior interactables have unique ids and sit near the interior origin', () => {
    const ids = APARTMENT_INTERACTABLES.map((i) => i.id)
    expect(new Set(ids).size).toBe(ids.length)
    for (const def of APARTMENT_INTERACTABLES) {
      expect(Math.abs(def.position![0] - INTERIOR_ORIGIN[0])).toBeLessThan(10)
      expect(Math.abs(def.position![2] - INTERIOR_ORIGIN[1])).toBeLessThan(10)
    }
  })
})

describe('apartment location mode (store)', () => {
  beforeEach(() => {
    useGameStore.setState(createInitialGameState())
  })

  it('entering the apartment sets the location and exiting restores it', () => {
    const store = useGameStore.getState()
    expect(store.location).toBe('city')
    store.enterApartment()
    expect(useGameStore.getState().location).toBe('apartment')
    useGameStore.getState().exitApartment()
    expect(useGameStore.getState().location).toBe('city')
  })

  it('cannot enter while driving, cannot exit while already outside', () => {
    useGameStore.setState({ mode: 'driving' })
    useGameStore.getState().enterApartment()
    expect(useGameStore.getState().location).toBe('city')
    useGameStore.setState({ mode: 'walking' })
    useGameStore.getState().exitApartment() // no-op outside
    expect(useGameStore.getState().location).toBe('city')
  })

  it('sleeping in the bed restores energy, bumps hunger and advances the day', () => {
    useGameStore.setState((s) => ({
      stats: { ...s.stats, energy: 20, hunger: 10, day: 3, hour: 23 },
    }))
    useGameStore.getState().performActivityAction('sleep')
    const stats = useGameStore.getState().stats
    expect(stats.energy).toBe(100)
    expect(stats.hunger).toBeGreaterThan(10)
    expect(stats.day).toBe(4)
    expect(stats.hour).toBe(7)
  })

  it('APARTMENT_SPAWN is inside the interior room', () => {
    expect(Math.abs(APARTMENT_SPAWN[0] - INTERIOR_ORIGIN[0])).toBeLessThan(6)
    expect(Math.abs(APARTMENT_SPAWN[2] - INTERIOR_ORIGIN[1])).toBeLessThan(5)
  })
})

describe('appearance (store)', () => {
  beforeEach(() => {
    useGameStore.setState(createInitialGameState())
  })

  it('defaults to the classic look', () => {
    expect(useGameStore.getState().appearance).toEqual(DEFAULT_APPEARANCE)
  })

  it('setAppearance merges partial updates', () => {
    useGameStore.getState().setAppearance({ shirtColor: '#d1495b' })
    const a = useGameStore.getState().appearance
    expect(a.shirtColor).toBe('#d1495b')
    expect(a.pantsColor).toBe(DEFAULT_APPEARANCE.pantsColor)
  })

  it('isPlayerAppearance guards malformed values', () => {
    expect(isPlayerAppearance(DEFAULT_APPEARANCE)).toBe(true)
    expect(isPlayerAppearance({ shirtColor: '#fff' })).toBe(false)
    expect(isPlayerAppearance(null)).toBe(false)
  })

  it('wardrobe/storage panels open through interact kinds and close with closePanel', () => {
    useGameStore.setState({ activeInteractableId: 'apartment_wardrobe' })
    useGameStore.getState().interact()
    expect(useGameStore.getState().ui.panel).toBe('wardrobe')
    useGameStore.getState().closePanel()
    useGameStore.setState({ activeInteractableId: 'apartment_storage' })
    useGameStore.getState().interact()
    expect(useGameStore.getState().ui.panel).toBe('storage')
    // Storage never mutates the bag.
    useGameStore.setState({ inventory: { coffee: 2 } })
    useGameStore.getState().closePanel()
    expect(useGameStore.getState().inventory).toEqual({ coffee: 2 })
  })
})
