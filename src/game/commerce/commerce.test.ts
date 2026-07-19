import { beforeEach, describe, expect, it } from 'vitest'
import { STORE_DEFINITIONS, getStoreDefinition, listingPrice } from './storeDefinitions'
import { initialStock, reconcileStock, restockToFull, sellUnits, stockOf } from './stockLogic'
import { canPurchase } from './commerceEngine'
import { validateStores } from './commerceValidation'
import {
  applyDeliveryRestock,
  commerceRuntime,
  getStoreStock,
  reconcileStore,
  recordSale,
  resetCommerceRuntime,
} from './commerceRuntime'
import { ITEM_DEFINITIONS } from '../items/itemCatalog'
import { INTERIORS } from '../interiors/interiorRegistry'
import { ALL_INTERACTABLES } from '../../data/interactables'
import { ROBBERY_DEFINITIONS } from '../criminalActivities/activityDefinitions'

const MAIN = getStoreDefinition('store_mainst')!

function validationCtx() {
  return {
    itemIds: new Set(ITEM_DEFINITIONS.map((i) => i.id)),
    interiorIds: new Set(INTERIORS.map((i) => i.id)),
    interactableIds: new Set(ALL_INTERACTABLES.map((i) => i.id)),
    activityIds: new Set(ROBBERY_DEFINITIONS.map((r) => r.id)),
  }
}

describe('store definitions', () => {
  it('validate against the live item/interior/interactable/robbery registries', () => {
    expect(validateStores(validationCtx())).toEqual([])
  })
  it('both stores reuse a robbery interior + register (no new interior)', () => {
    for (const s of STORE_DEFINITIONS) {
      expect(INTERIORS.find((i) => i.id === s.interiorId)).toBeDefined()
      expect(ALL_INTERACTABLES.find((i) => i.id === s.registerInteractableId)).toBeDefined()
    }
  })
})

describe('stock reconciliation', () => {
  it('starts full and is a no-op before an interval elapses', () => {
    const s0 = initialStock(MAIN)
    expect(stockOf(s0, 'snack')).toBe(8)
    const sold = sellUnits(s0, 'snack', 3)
    expect(stockOf(sold, 'snack')).toBe(5)
    // Less than 12h later → unchanged (idempotent).
    expect(reconcileStock(sold, MAIN, 5)).toBe(sold)
    expect(reconcileStock(sold, MAIN, 11.9)).toBe(sold)
  })

  it('restocks by whole intervals and clamps to max, without hour-by-hour looping', () => {
    const sold = { ...initialStock(MAIN), stock: { ...initialStock(MAIN).stock, snack: 0 }, lastRestockGameHours: 0 }
    // 12h → +4; 24h → +8; a huge skip clamps to max (8), never exceeds.
    expect(stockOf(reconcileStock(sold, MAIN, 12), 'snack')).toBe(4)
    expect(stockOf(reconcileStock(sold, MAIN, 24), 'snack')).toBe(8)
    const big = reconcileStock(sold, MAIN, 100000)
    expect(stockOf(big, 'snack')).toBe(8) // clamped
    // The restock clock advances by whole intervals only.
    expect(big.lastRestockGameHours % MAIN.restockGameHours).toBe(0)
  })

  it('carries partial progress: reconcile at 13h then 24h totals two intervals', () => {
    const sold = { ...initialStock(MAIN), stock: { snack: 0 }, lastRestockGameHours: 0 }
    const a = reconcileStock(sold, MAIN, 13) // 1 interval, clock → 12
    expect(a.lastRestockGameHours).toBe(12)
    const b = reconcileStock(a, MAIN, 24) // 1 more interval, clock → 24
    expect(b.lastRestockGameHours).toBe(24)
    expect(stockOf(b, 'snack')).toBe(8)
  })
})

describe('purchase engine', () => {
  const base = () => ({
    store: MAIN,
    stock: initialStock(MAIN),
    money: 100,
    backpack: {} as Record<string, number>,
    backpackCapacity: 10,
    storeClosed: false,
  })

  it('permits an affordable, in-stock, roomy purchase', () => {
    const r = canPurchase('snack', base())
    expect(r.ok).toBe(true)
    expect(r.price).toBe(6)
  })
  it('refuses closed store, out of stock, no funds, full bag, unlisted item', () => {
    expect(canPurchase('snack', { ...base(), storeClosed: true }).reason).toBe('store_closed')
    expect(canPurchase('snack', { ...base(), stock: { ...initialStock(MAIN), stock: { snack: 0 } } }).reason).toBe('out_of_stock')
    expect(canPurchase('first_aid', { ...base(), money: 1 }).reason).toBe('insufficient_funds')
    expect(canPurchase('snack', { ...base(), backpack: { meal: 5 * 10 }, backpackCapacity: 10 }).reason).toBe('backpack_full')
    expect(canPurchase('restock_crate', base()).reason).toBe('not_sold_here')
  })
  it('falls back to the catalog price when a listing has no override', () => {
    expect(listingPrice(MAIN, 'snack', 999)).toBe(999) // snack has no priceOverride
  })
})

describe('commerce runtime', () => {
  beforeEach(() => resetCommerceRuntime())

  it('lazily initialises full stock and records sales', () => {
    expect(stockOf(getStoreStock('store_mainst'), 'snack')).toBe(8)
    recordSale('store_mainst', 'snack', 2)
    expect(stockOf(getStoreStock('store_mainst'), 'snack')).toBe(6)
  })

  it('reconciles a store forward on demand', () => {
    recordSale('store_mainst', 'snack', 8) // deplete
    expect(stockOf(reconcileStore('store_mainst', 12), 'snack')).toBe(4)
  })

  it('applies a delivery restock exactly once per receipt (idempotent)', () => {
    recordSale('store_mainst', 'snack', 5)
    expect(applyDeliveryRestock('store_mainst', 'shelf_run#1')).toBe(true)
    expect(stockOf(getStoreStock('store_mainst'), 'snack')).toBe(8) // full
    recordSale('store_mainst', 'snack', 5)
    // Same receipt again → no-op (does not re-fill).
    expect(applyDeliveryRestock('store_mainst', 'shelf_run#1')).toBe(false)
    expect(stockOf(getStoreStock('store_mainst'), 'snack')).toBe(3)
  })

  it('bounds the restock receipt log', () => {
    for (let i = 0; i < 200; i++) applyDeliveryRestock('store_mainst', `r${i}`)
    expect(commerceRuntime.restockReceipts.length).toBeLessThanOrEqual(64)
  })
})

// restockToFull sanity (used by delivery)
describe('restockToFull', () => {
  it('fills every listing to max', () => {
    const s = restockToFull({ storeId: 'store_mainst', stock: {}, lastRestockGameHours: 0 }, MAIN)
    for (const l of MAIN.listings) expect(s.stock[l.itemId]).toBe(l.maxStock)
  })
})
