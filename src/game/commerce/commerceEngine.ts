import type { ItemStacks } from '../items/itemTypes'
import { canAddItem } from '../items/inventoryService'
import { getItemDefinition } from '../items/itemCatalog'
import { listingPrice } from './storeDefinitions'
import { stockOf } from './stockLogic'
import type { PurchaseCheck, StoreDefinition, StoreStockState } from './commerceTypes'

/**
 * Pure purchase validation. It checks — atomically, in one place — store state,
 * listing, stock, money, and backpack room, returning a typed outcome. The store
 * action applies money − price, stock − 1, and the item grant together in a
 * single transaction; this function never mutates anything.
 */

export interface PurchaseContext {
  store: StoreDefinition
  stock: StoreStockState
  money: number
  backpack: ItemStacks
  backpackCapacity: number
  /** Robbed / recovering / mid-robbery — commerce is refused while true. */
  storeClosed: boolean
}

export function canPurchase(itemId: string, ctx: PurchaseContext): PurchaseCheck {
  if (ctx.storeClosed) return { ok: false, reason: 'store_closed' }
  const listing = ctx.store.listings.find((l) => l.itemId === itemId)
  if (!listing) return { ok: false, reason: 'not_sold_here' }
  // Furniture listings grant a unique housing ASSET (minted by the housing layer after the
  // sale), not a backpack item — so skip the item-catalog + backpack-room checks. Stock,
  // funds, and the price (== the furniture catalog price via priceOverride) are the same
  // authority as any other purchase (PR#18 review #2). The asset cap is the caller's gate.
  if (listing.kind === 'furniture') {
    if (stockOf(ctx.stock, itemId) <= 0) return { ok: false, reason: 'out_of_stock' }
    const price = listing.priceOverride ?? 0
    if (ctx.money < price) return { ok: false, reason: 'insufficient_funds' }
    return { ok: true, price }
  }
  const def = getItemDefinition(itemId)
  if (!def) return { ok: false, reason: 'unknown_item' }
  if (stockOf(ctx.stock, itemId) <= 0) return { ok: false, reason: 'out_of_stock' }
  const price = listingPrice(ctx.store, itemId, def.price)
  if (ctx.money < price) return { ok: false, reason: 'insufficient_funds' }
  const room = canAddItem(ctx.backpack, itemId, 1, ctx.backpackCapacity)
  if (!room.ok) return { ok: false, reason: room.reason === 'capacity_full' ? 'backpack_full' : 'item_restricted' }
  return { ok: true, price }
}
