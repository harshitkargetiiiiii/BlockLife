import { ALL_STORE_DEFINITIONS, getStoreDefinition } from './storeDefinitions'
import { commerceRuntime, resetCommerceRuntime } from './commerceRuntime'

/**
 * Commerce persistence: store stock, restock clocks, and the bounded delivery
 * receipts. Additive + fail-safe — a missing field yields deterministic default
 * (full) stock, and malformed nested data is skipped rather than thrown.
 */

export interface CommerceStoreSave {
  storeId: string
  stock: Record<string, number>
  lastRestockGameHours: number
}

export interface CommerceSaveData {
  stores: CommerceStoreSave[]
  restockReceipts: string[]
  purchaseSeq: number
}

const MAX_RECEIPTS = 64

export function serializeCommerce(): CommerceSaveData {
  return {
    stores: ALL_STORE_DEFINITIONS.map((def) => {
      const s = commerceRuntime.stores[def.id] ?? { storeId: def.id, stock: {}, lastRestockGameHours: 0 }
      return { storeId: def.id, stock: { ...s.stock }, lastRestockGameHours: s.lastRestockGameHours }
    }),
    restockReceipts: [...commerceRuntime.restockReceipts].slice(-MAX_RECEIPTS),
    purchaseSeq: commerceRuntime.purchaseSeq,
  }
}

function isFiniteNum(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v)
}

/**
 * Reset commerce to full-stock defaults, then layer a valid save on top. Each
 * listed item's stock is floored to [0, maxStock]; unknown stores/items and
 * malformed rows are ignored (fail safe → default stock).
 */
export function applyCommerceSave(data: CommerceSaveData | undefined): void {
  resetCommerceRuntime() // deterministic full-stock defaults for every store
  if (!data || typeof data !== 'object') return

  for (const row of Array.isArray(data.stores) ? data.stores : []) {
    if (!row || typeof row !== 'object') continue
    const def = getStoreDefinition(row.storeId)
    if (!def) continue
    const state = commerceRuntime.stores[def.id]
    if (isFiniteNum(row.lastRestockGameHours) && row.lastRestockGameHours >= 0) {
      state.lastRestockGameHours = row.lastRestockGameHours
    }
    const rawStock = row.stock && typeof row.stock === 'object' ? row.stock : {}
    for (const l of def.listings) {
      const v = (rawStock as Record<string, unknown>)[l.itemId]
      if (!isFiniteNum(v)) continue // absent/garbage → keep the default (full)
      state.stock[l.itemId] = Math.max(0, Math.min(l.maxStock, Math.floor(v)))
    }
  }

  if (Array.isArray(data.restockReceipts)) {
    commerceRuntime.restockReceipts = data.restockReceipts
      .filter((r): r is string => typeof r === 'string')
      .slice(-MAX_RECEIPTS)
  }
  if (isFiniteNum(data.purchaseSeq) && data.purchaseSeq >= 0) {
    commerceRuntime.purchaseSeq = Math.floor(data.purchaseSeq)
  }
}
