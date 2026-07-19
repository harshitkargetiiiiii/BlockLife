import { STORE_DEFINITIONS, getStoreDefinition } from './storeDefinitions'
import { initialStock, reconcileStock, restockToFull, sellUnits } from './stockLogic'
import type { StoreStockState } from './commerceTypes'

/**
 * Commerce runtime — a module singleton holding DURABLE store stock + bounded
 * idempotency receipts (same pattern as the robbery / mission runtimes). It is
 * NOT stepped per frame: stock reconciles lazily on discrete moments (opening a
 * shop, sleeping, a delivery restock), so there are zero per-frame writes. The
 * UI reads a bounded projection the store mirrors into zustand on those moments.
 * Ids + scalars only; never a mesh, body, or React node — so it survives
 * interior/sector streaming.
 */

/** Bound on retained restock receipts (idempotency), so it can't grow forever. */
const MAX_RECEIPTS = 64

export const commerceRuntime = {
  /** Per-store persistent stock + restock clock (lazy-initialised). */
  stores: {} as Record<string, StoreStockState>,
  /** Applied delivery-restock receipt ids (Shelf Run) — bounded, for idempotency. */
  restockReceipts: [] as string[],
  /** Monotonic purchase sequence (diagnostics + test API receipts). */
  purchaseSeq: 0,
  debugEnabled: false,
}

/** Get (or lazily create full) stock for a store. */
export function getStoreStock(storeId: string): StoreStockState {
  let s = commerceRuntime.stores[storeId]
  if (!s) {
    const def = getStoreDefinition(storeId)
    s = def ? initialStock(def) : { storeId, stock: {}, lastRestockGameHours: 0 }
    commerceRuntime.stores[storeId] = s
  }
  return s
}

/** Reconcile a store's stock forward to `gameHours` (idempotent) and store it. */
export function reconcileStore(storeId: string, gameHours: number): StoreStockState {
  const def = getStoreDefinition(storeId)
  const current = getStoreStock(storeId)
  if (!def) return current
  const next = reconcileStock(current, def, gameHours)
  commerceRuntime.stores[storeId] = next
  return next
}

/** Record a sale of one unit (stock − quantity). */
export function recordSale(storeId: string, itemId: string, quantity = 1): void {
  commerceRuntime.stores[storeId] = sellUnits(getStoreStock(storeId), itemId, quantity)
}

export function nextPurchaseReceipt(storeId: string): string {
  commerceRuntime.purchaseSeq += 1
  return `${storeId}#buy${commerceRuntime.purchaseSeq}`
}

/**
 * Apply a legitimate delivery restock exactly once. Returns true when newly
 * applied, false when the receipt was already seen (a duplicated delivery is a
 * no-op). Receipts are bounded to the most recent MAX_RECEIPTS.
 */
export function applyDeliveryRestock(storeId: string, receiptId: string): boolean {
  if (commerceRuntime.restockReceipts.includes(receiptId)) return false
  const def = getStoreDefinition(storeId)
  if (!def) return false
  commerceRuntime.stores[storeId] = restockToFull(getStoreStock(storeId), def)
  commerceRuntime.restockReceipts.push(receiptId)
  if (commerceRuntime.restockReceipts.length > MAX_RECEIPTS) {
    commerceRuntime.restockReceipts.splice(0, commerceRuntime.restockReceipts.length - MAX_RECEIPTS)
  }
  return true
}

/** Full reset — resetGame + dev/test API. */
export function resetCommerceRuntime(): void {
  commerceRuntime.stores = {}
  commerceRuntime.restockReceipts = []
  commerceRuntime.purchaseSeq = 0
  // debugEnabled preserved across resets (dev convenience).
  for (const def of STORE_DEFINITIONS) commerceRuntime.stores[def.id] = initialStock(def)
}
