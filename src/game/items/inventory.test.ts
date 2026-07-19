import { describe, expect, it } from 'vitest'
import { ITEM_DEFINITIONS, getItemDefinition } from './itemCatalog'
import { validateItemCatalog } from './itemValidation'
import { APPEARANCE_PRESETS, LOCKED_PALETTE_IDS } from '../interiors/interiorTypes'
import {
  BACKPACK_CAPACITY,
  STORAGE_CAPACITY,
  addItem,
  canAddItem,
  countItem,
  hasItem,
  listStacks,
  occupiedSlots,
  removeItem,
  sanitizeStacks,
  slotsFor,
  transferItem,
} from './inventoryService'
import type { ItemStacks } from './itemTypes'

const paletteCtx = () => ({
  paletteIds: new Set(APPEARANCE_PRESETS.map((p) => p.id)),
  lockedPaletteIds: new Set(LOCKED_PALETTE_IDS),
})

describe('item catalog', () => {
  it('validates the shipped catalog against the real wardrobe palette', () => {
    expect(validateItemCatalog(paletteCtx())).toEqual([])
  })

  it('keeps the legacy coffee id as a quest-reserved item', () => {
    const coffee = getItemDefinition('coffee')!
    expect(coffee.category).toBe('quest')
    expect(coffee.questReserved).toBe(true)
    expect(coffee.usable).toBe(false)
    expect(coffee.discardable).toBe(false)
    expect(coffee.storable).toBe(false)
  })

  it('ships the required proof items', () => {
    for (const id of ['coffee', 'snack', 'meal', 'energy_drink', 'first_aid', 'ammo_box', 'wardrobe_teal', 'wardrobe_gold', 'restock_crate']) {
      expect(getItemDefinition(id), id).toBeDefined()
    }
  })

  it('flags a catalog with an unlock that targets a non-locked palette', () => {
    const errs = validateItemCatalog({
      paletteIds: new Set(['blue']),
      lockedPaletteIds: new Set(), // teal/gold now count as unknown/non-locked
    })
    expect(errs.length).toBeGreaterThan(0)
  })
})

describe('inventory service — slots & capacity', () => {
  it('measures occupied slots as ceil(qty / stackLimit)', () => {
    expect(slotsFor('snack', 10)).toBe(1) // snack stacks to 10
    expect(slotsFor('snack', 11)).toBe(2)
    expect(slotsFor('snack', 25)).toBe(3)
    expect(occupiedSlots({ snack: 25, meal: 5 })).toBe(3 + 1)
  })

  it('rejects an add that would breach capacity, atomically', () => {
    // Fill the backpack with 10 single-stack meals-worth… use ammo_box (stack 5).
    const full: ItemStacks = { meal: 5 * BACKPACK_CAPACITY } // meal stacks to 5 → 10 slots
    expect(occupiedSlots(full)).toBe(BACKPACK_CAPACITY)
    const r = canAddItem(full, 'snack', 1, BACKPACK_CAPACITY)
    expect(r.ok).toBe(false)
    expect(r.reason).toBe('capacity_full')
    // The add returns the failure and no stacks.
    expect(addItem(full, 'snack', 1, BACKPACK_CAPACITY).stacks).toBeUndefined()
  })

  it('rejects unknown items and invalid quantities', () => {
    expect(canAddItem({}, 'nope', 1, BACKPACK_CAPACITY).reason).toBe('unknown_item')
    expect(canAddItem({}, 'snack', 0, BACKPACK_CAPACITY).reason).toBe('invalid_quantity')
    expect(canAddItem({}, 'snack', 1.5, BACKPACK_CAPACITY).reason).toBe('invalid_quantity')
  })

  it('adds and removes atomically without negatives', () => {
    const a = addItem({}, 'snack', 3, BACKPACK_CAPACITY).stacks!
    expect(countItem(a, 'snack')).toBe(3)
    const b = addItem(a, 'snack', 2, BACKPACK_CAPACITY).stacks!
    expect(countItem(b, 'snack')).toBe(5)
    const c = removeItem(b, 'snack', 5).stacks!
    expect(hasItem(c, 'snack')).toBe(false) // key deleted at zero
    expect(removeItem(c, 'snack', 1).reason).toBe('not_enough')
  })

  it('transfers exactly-once and rolls back if the destination is full', () => {
    const from: ItemStacks = { first_aid: 2 }
    const toFull: ItemStacks = { meal: 5 * 2 } // 2 slots used of a tiny capacity 2
    const blocked = transferItem(from, toFull, 'first_aid', 1, 2)
    expect(blocked.ok).toBe(false)
    expect(blocked.reason).toBe('capacity_full')
    // Neither side changed on failure.
    const ok = transferItem(from, {}, 'first_aid', 1, STORAGE_CAPACITY)
    expect(ok.ok).toBe(true)
    expect(countItem(ok.from!, 'first_aid')).toBe(1)
    expect(countItem(ok.to!, 'first_aid')).toBe(1)
    // Transferring more than held fails.
    expect(transferItem(from, {}, 'first_aid', 5, STORAGE_CAPACITY).reason).toBe('not_enough')
  })

  it('lists resolved stacks in catalog order, dropping empties', () => {
    const rows = listStacks({ meal: 3, snack: 12 })
    expect(rows.map((r) => r.def.id)).toEqual(['snack', 'meal']) // catalog order
    expect(rows.find((r) => r.def.id === 'snack')!.slots).toBe(2)
  })

  it('sanitises a loaded container: drops unknown ids, floors, trims overflow', () => {
    const clean = sanitizeStacks({ snack: 4, bogus: 9, meal: -2, coffee: 1.9 }, BACKPACK_CAPACITY)
    expect(clean).toEqual({ snack: 4, coffee: 1 })
    // A tampered overfull save is trimmed to the capacity budget.
    const over = sanitizeStacks({ meal: 999 }, BACKPACK_CAPACITY)
    expect(occupiedSlots(over)).toBeLessThanOrEqual(BACKPACK_CAPACITY)
  })
})

describe('deterministic catalog order', () => {
  it('is a stable list starting with coffee', () => {
    expect(ITEM_DEFINITIONS[0].id).toBe('coffee')
  })
})
