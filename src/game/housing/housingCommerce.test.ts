import { beforeEach, describe, expect, it } from 'vitest'
import { getStoreStock, resetCommerceRuntime } from '../commerce/commerceRuntime'
import { applyCommerceSave, serializeCommerce } from '../commerce/commercePersistence'
import { FURNITURE_SHOWROOM_ID, getStoreDefinition } from '../commerce/storeDefinitions'
import { stockOf } from '../commerce/stockLogic'
import { getFurnitureDef } from './furnitureCatalog'
import { resetHousing } from './housingRuntime'
import { canBuyFurniture, commitFurnitureSale, devSetFurnitureStock, furnitureStockOf } from './housingCommerce'

/**
 * Furniture retail runs through the commerce authority, not a parallel shop (PR#18 review
 * #2): a real `furniture_showroom` store with per-def stock, the shared purchase gate, and
 * the shared receipt authority. Prices come from the furniture catalog (display == charge).
 */
describe('furniture retail through the commerce authority (review #2)', () => {
  beforeEach(() => {
    resetHousing(0)
    resetCommerceRuntime()
  })

  it('the furniture showroom is a real retail commerce store; every listing is furniture at the catalog price', () => {
    const store = getStoreDefinition(FURNITURE_SHOWROOM_ID)
    expect(store).toBeDefined()
    expect(store!.kind).toBe('retail')
    expect(store!.listings.length).toBeGreaterThanOrEqual(16)
    for (const l of store!.listings) {
      expect(l.kind).toBe('furniture')
      // Single price source → the listing price IS the catalog price.
      expect(l.priceOverride).toBe(getFurnitureDef(l.itemId)!.price)
    }
    expect(furnitureStockOf('bed_futon')).toBeGreaterThan(0) // starts stocked
  })

  it('the displayed price equals the charged price (single catalog source)', () => {
    const def = getFurnitureDef('sofa')!
    const check = canBuyFurniture('sofa', 999999)
    expect(check.ok).toBe(true)
    if (check.ok) expect(check.price).toBe(def.price)
  })

  it('refuses the purchase when the showroom is out of stock', () => {
    devSetFurnitureStock('sofa', 0)
    const check = canBuyFurniture('sofa', 999999)
    expect(check.ok).toBe(false)
    if (!check.ok) expect(check.reason).toBe('out_of_stock')
  })

  it('refuses the purchase when the player cannot afford the piece', () => {
    const def = getFurnitureDef('sofa')!
    const check = canBuyFurniture('sofa', def.price - 1)
    expect(check.ok).toBe(false)
    if (!check.ok) expect(check.reason).toBe('insufficient_funds')
  })

  it('a sale records against real stock and mints a fresh receipt from the shared authority each time', () => {
    const before = furnitureStockOf('coffee_table')
    const r1 = commitFurnitureSale('coffee_table')
    expect(furnitureStockOf('coffee_table')).toBe(before - 1)
    const r2 = commitFurnitureSale('coffee_table')
    expect(furnitureStockOf('coffee_table')).toBe(before - 2)
    expect(r1.receipt).not.toBe(r2.receipt) // distinct, monotonic receipts
  })

  it('showroom stock survives a commerce save round-trip (reload safety)', () => {
    devSetFurnitureStock('sofa', 2)
    const save = serializeCommerce()
    resetCommerceRuntime() // back to full-stock defaults
    expect(furnitureStockOf('sofa')).toBeGreaterThan(2)
    applyCommerceSave(save)
    expect(furnitureStockOf('sofa')).toBe(2) // depleted level restored exactly
    // Sanity: the runtime store id matches the authored showroom.
    expect(getStoreStock(FURNITURE_SHOWROOM_ID).storeId).toBe(FURNITURE_SHOWROOM_ID)
    expect(stockOf(getStoreStock(FURNITURE_SHOWROOM_ID), 'sofa')).toBe(2)
  })
})
