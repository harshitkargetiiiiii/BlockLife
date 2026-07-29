/**
 * Furniture purchase service (issue #17 §5, PR#18 review #2). Furniture retail runs
 * through the EXISTING commerce authority — it is NOT a parallel shop. A dedicated
 * `furniture_showroom` retail store (see `commerce/storeDefinitions.ts`) lists every
 * furniture def at its catalog price, with real stock the commerce runtime reconciles,
 * decrements on sale, and persists. Buying validates through the SAME `canPurchase`
 * gate as any other store (stock/availability + funds + display==charge price) plus the
 * housing owned-asset cap; the store action records the sale + a commerce purchase
 * receipt and mints the unique asset ONLY after that transaction succeeds. The displayed
 * price always equals the charged price (the furniture catalog is the single source).
 */
import { canPurchase } from '../commerce/commerceEngine'
import { commerceRuntime, getStoreStock, nextPurchaseReceipt, reconcileStore, recordSale } from '../commerce/commerceRuntime'
import { FURNITURE_SHOWROOM_ID, getStoreDefinition } from '../commerce/storeDefinitions'
import { stockOf } from '../commerce/stockLogic'
import { getFurnitureDef } from './furnitureCatalog'
import { atOwnedAssetCap } from './housingRuntime'
import type { FurnitureDefId } from './housingTypes'

export type FurnitureBuyReason = 'unknown_item' | 'insufficient_funds' | 'at_capacity' | 'out_of_stock'
export type FurnitureBuyCheck = { ok: true; price: number } | { ok: false; reason: FurnitureBuyReason }

/** Current showroom stock for a furniture def (0 if unlisted). */
export function furnitureStockOf(defId: FurnitureDefId): number {
  return stockOf(getStoreStock(FURNITURE_SHOWROOM_ID), defId)
}

/** Lazily reconcile the showroom's stock forward to `gameHours` (idempotent, never per frame). */
export function reconcileFurnitureShowroom(gameHours: number): void {
  reconcileStore(FURNITURE_SHOWROOM_ID, gameHours)
}

/**
 * Pure purchase validation, in one place: unknown def, owned-asset cap, then the shared
 * commerce gate (stock/availability + funds + resolved price). Never mutates.
 */
export function canBuyFurniture(defId: FurnitureDefId, money: number): FurnitureBuyCheck {
  const def = getFurnitureDef(defId)
  if (!def) return { ok: false, reason: 'unknown_item' }
  if (atOwnedAssetCap()) return { ok: false, reason: 'at_capacity' }
  const store = getStoreDefinition(FURNITURE_SHOWROOM_ID)
  if (!store) return { ok: false, reason: 'unknown_item' }
  const check = canPurchase(defId, {
    store,
    stock: getStoreStock(FURNITURE_SHOWROOM_ID),
    money,
    backpack: {}, // furniture never enters the backpack — the furniture branch skips it
    backpackCapacity: 0,
    storeClosed: false, // the showroom is retail — never robbed/closed
  })
  if (!check.ok) {
    const reason: FurnitureBuyReason =
      check.reason === 'out_of_stock' ? 'out_of_stock'
      : check.reason === 'insufficient_funds' ? 'insufficient_funds'
      : 'unknown_item'
    return { ok: false, reason }
  }
  return { ok: true, price: check.price ?? def.price }
}

/**
 * Commit the commerce side of a furniture purchase: decrement showroom stock (sale
 * recording) and mint a receipt from the shared purchase-receipt authority. The caller
 * mints the asset + charges money only after this returns (mint-after-transaction).
 */
export function commitFurnitureSale(defId: FurnitureDefId): { receipt: string } {
  recordSale(FURNITURE_SHOWROOM_ID, defId, 1)
  return { receipt: nextPurchaseReceipt(FURNITURE_SHOWROOM_ID) }
}

export function furnitureBuyReasonText(reason: FurnitureBuyReason): string {
  switch (reason) {
    case 'unknown_item':
      return 'That item is unavailable.'
    case 'insufficient_funds':
      return 'Not enough money for that piece.'
    case 'at_capacity':
      return 'You already own the maximum amount of furniture.'
    case 'out_of_stock':
      return 'The showroom is out of that piece right now — check back later.'
  }
}

/** DEV/E2E only: force a showroom stock level to prove the out-of-stock path deterministically. */
export function devSetFurnitureStock(defId: FurnitureDefId, units: number): void {
  const s = getStoreStock(FURNITURE_SHOWROOM_ID)
  commerceRuntime.stores[FURNITURE_SHOWROOM_ID] = { ...s, stock: { ...s.stock, [defId]: Math.max(0, Math.trunc(units)) } }
}
