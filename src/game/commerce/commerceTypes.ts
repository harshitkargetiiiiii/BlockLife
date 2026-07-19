/**
 * Personal Economy, Inventory & Shopping v1 — commerce domain types.
 *
 * ONE reusable commerce engine serves both stores; they differ only by DATA
 * (catalog, prices, stock caps, restock cadence). Store definitions reference
 * existing store interiors + register interactables (no new interior, no
 * duplicated cashier). Stock is deterministic and persistent; it advances via
 * the existing game clock through lazy reconciliation (never a per-frame loop).
 */

export interface StoreListing {
  /** Catalog item id sold here. */
  itemId: string
  /** Store-specific price; falls back to the item's catalog price when absent. */
  priceOverride?: number
  /** Max units held on the shelf. */
  maxStock: number
  /** Units restored per restock interval (clamped to maxStock). */
  restockAmount: number
}

export interface StoreDefinition {
  /** Stable store id (also the persistence key). */
  id: string
  name: string
  /** The register interactable that opens the shop (reused from the robbery interior). */
  registerInteractableId: string
  /** The interior this store occupies. */
  interiorId: string
  /** The robbery activity id for this store — links commerce ↔ recovery. */
  activityId: string
  /** Game-hours between restocks. */
  restockGameHours: number
  listings: readonly StoreListing[]
  sourceRef: { file: string; symbol: string }
}

/** Persistent per-store stock: item id → current units, plus the restock clock. */
export interface StoreStockState {
  storeId: string
  stock: Record<string, number>
  /** Game-hours (day*24+hour) of the last reconciled restock tick. */
  lastRestockGameHours: number
}

/** Why a purchase was refused (typed — the UI shows the matching message). */
export type PurchaseFailure =
  | 'unknown_store'
  | 'unknown_item'
  | 'not_sold_here'
  | 'store_closed' // robbed / recovering / mid-robbery
  | 'out_of_stock'
  | 'insufficient_funds'
  | 'backpack_full'
  | 'item_restricted'

export interface PurchaseCheck {
  ok: boolean
  reason?: PurchaseFailure
  /** Resolved unit price on success. */
  price?: number
}
