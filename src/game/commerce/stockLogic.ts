import type { StoreDefinition, StoreStockState } from './commerceTypes'

/**
 * Pure store-stock logic: deterministic initial stock, LAZY multi-interval
 * restock reconciliation, and selling. Reconciliation is idempotent at a fixed
 * game time and computes the number of elapsed restock intervals in O(1) — a
 * large time skip (sleep, a long session) never iterates hour by hour. Stock is
 * always clamped to [0, maxStock].
 */

/** A fresh store: every listing at its max, restock clock at hour 0. */
export function initialStock(store: StoreDefinition): StoreStockState {
  const stock: Record<string, number> = {}
  for (const l of store.listings) stock[l.itemId] = l.maxStock
  return { storeId: store.id, stock, lastRestockGameHours: 0 }
}

/**
 * Reconcile stock forward to `gameHours`. Adds `restockAmount × intervals` to
 * each listing (clamped to max) and advances the restock clock by whole
 * intervals only, so partial progress carries to the next reconcile. Repeated
 * calls at the same time are a no-op. Never advances while the clock hasn't
 * moved a full interval; the caller only invokes this off the batched game
 * clock (never per frame, never while paused).
 */
export function reconcileStock(
  state: StoreStockState,
  store: StoreDefinition,
  gameHours: number,
): StoreStockState {
  const elapsed = gameHours - state.lastRestockGameHours
  if (!(elapsed >= store.restockGameHours)) return state // < 1 interval → unchanged
  const intervals = Math.floor(elapsed / store.restockGameHours)
  const stock: Record<string, number> = { ...state.stock }
  for (const l of store.listings) {
    const current = stock[l.itemId] ?? 0
    stock[l.itemId] = Math.min(l.maxStock, current + l.restockAmount * intervals)
  }
  return {
    storeId: state.storeId,
    stock,
    lastRestockGameHours: state.lastRestockGameHours + intervals * store.restockGameHours,
  }
}

/** Current stock of an item at a store (0 if unlisted/absent). */
export function stockOf(state: StoreStockState, itemId: string): number {
  return state.stock[itemId] ?? 0
}

/** Sell `quantity` units: returns a new state with stock reduced (never below 0). */
export function sellUnits(state: StoreStockState, itemId: string, quantity: number): StoreStockState {
  const current = stockOf(state, itemId)
  return {
    ...state,
    stock: { ...state.stock, [itemId]: Math.max(0, current - quantity) },
  }
}

/**
 * Restock a store to full (or by amounts) from a legitimate delivery (Shelf
 * Run). Kept separate from the time-based restock so a manual restock and the
 * clock don't fight; both clamp to max.
 */
export function restockToFull(state: StoreStockState, store: StoreDefinition): StoreStockState {
  const stock: Record<string, number> = { ...state.stock }
  for (const l of store.listings) stock[l.itemId] = l.maxStock
  return { ...state, stock }
}
