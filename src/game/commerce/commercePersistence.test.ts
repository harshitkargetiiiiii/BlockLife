import { beforeEach, describe, expect, it } from 'vitest'
import { applyCommerceSave, serializeCommerce } from './commercePersistence'
import { commerceRuntime, getStoreStock, recordSale, resetCommerceRuntime } from './commerceRuntime'
import { stockOf } from './stockLogic'
import { sanitizeStacks } from '../items/inventoryService'

describe('commerce persistence + migration', () => {
  beforeEach(() => resetCommerceRuntime())

  it('round-trips store stock + restock clocks + receipts', () => {
    recordSale('store_mainst', 'snack', 3)
    commerceRuntime.stores['store_mainst'].lastRestockGameHours = 48
    commerceRuntime.restockReceipts.push('shelf_run#1')
    const data = serializeCommerce()
    resetCommerceRuntime()
    applyCommerceSave(data)
    expect(stockOf(getStoreStock('store_mainst'), 'snack')).toBe(5) // 8 − 3
    expect(getStoreStock('store_mainst').lastRestockGameHours).toBe(48)
    expect(commerceRuntime.restockReceipts).toContain('shelf_run#1')
  })

  it('an absent field yields deterministic FULL default stock', () => {
    applyCommerceSave(undefined)
    expect(stockOf(getStoreStock('store_mainst'), 'snack')).toBe(8)
    expect(stockOf(getStoreStock('store_kiosk'), 'snack')).toBe(6)
  })

  it('malformed nested save fails safe (no throw, defaults applied)', () => {
    expect(() =>
      applyCommerceSave({
        stores: [
          { storeId: 'store_mainst', stock: { snack: 'oops' as unknown as number, meal: 9999 }, lastRestockGameHours: -5 },
          null as never,
          { storeId: 'unknown_store', stock: {}, lastRestockGameHours: 0 },
        ],
        restockReceipts: ['ok', 42 as unknown as string],
        purchaseSeq: -3,
      }),
    ).not.toThrow()
    // Garbage snack → kept default (full 8); meal clamped to max (6); bad clock ignored.
    expect(stockOf(getStoreStock('store_mainst'), 'snack')).toBe(8)
    expect(stockOf(getStoreStock('store_mainst'), 'meal')).toBe(6)
    expect(commerceRuntime.restockReceipts).toEqual(['ok'])
  })
})

describe('inventory migration (sanitizeStacks)', () => {
  it('preserves the legacy coffee quantity and drops unknown ids', () => {
    // A legacy save: plain inventory Record with coffee + a stale unknown id.
    const migrated = sanitizeStacks({ coffee: 2, legacy_widget: 5, snack: 3 }, 10)
    expect(migrated).toEqual({ coffee: 2, snack: 3 }) // unknown dropped, coffee kept
  })
})
