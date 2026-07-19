import { getItemDefinition } from '../items/itemCatalog'
import { occupiedSlots } from '../items/inventoryService'
import type { ItemStacks } from '../items/itemTypes'
import { canPurchase } from './commerceEngine'
import { listingPrice } from './storeDefinitions'
import { stockOf } from './stockLogic'
import type { PurchaseFailure, StoreDefinition, StoreStockState } from './commerceTypes'

/**
 * A bounded, UI-reactive projection of a store's shopfront. Built on discrete
 * moments (opening a shop, buying) — never per frame — so the Shop panel reads
 * a plain snapshot and the commerce runtime stays out of React.
 */

export interface ShopRow {
  itemId: string
  name: string
  icon: string
  description: string
  price: number
  stock: number
  canBuy: boolean
  /** Why this row can't be bought right now, or null when it can. */
  reason: PurchaseFailure | null
}

export interface ShopView {
  storeId: string
  storeName: string
  money: number
  capacity: number
  occupied: number
  closed: boolean
  rows: ShopRow[]
}

export function buildShopView(
  store: StoreDefinition,
  stock: StoreStockState,
  money: number,
  backpack: ItemStacks,
  capacity: number,
  storeClosed: boolean,
): ShopView {
  const rows: ShopRow[] = store.listings.map((l) => {
    const def = getItemDefinition(l.itemId)
    const check = canPurchase(l.itemId, {
      store,
      stock,
      money,
      backpack,
      backpackCapacity: capacity,
      storeClosed,
    })
    return {
      itemId: l.itemId,
      name: def?.name ?? l.itemId,
      icon: def?.icon ?? '❓',
      description: def?.description ?? '',
      price: listingPrice(store, l.itemId, def?.price ?? 0),
      stock: stockOf(stock, l.itemId),
      canBuy: check.ok,
      reason: check.ok ? null : (check.reason ?? null),
    }
  })
  return {
    storeId: store.id,
    storeName: store.name,
    money,
    capacity,
    occupied: occupiedSlots(backpack),
    closed: storeClosed,
    rows,
  }
}
