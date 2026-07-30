import type { StoreDefinition, StoreListing } from './commerceTypes'
import { FURNITURE_DEFS } from '../housing/furnitureCatalog'

/**
 * The two robbable convenience stores + the furniture showroom. Everything
 * store-specific is DATA: catalog, prices, stock caps, and restock cadence. The
 * convenience stores reuse their existing robbery interior + register interactable
 * (never a second interior/cashier). Main Street is the fuller shop; the Waterfront
 * kiosk is a small themed stall. The furniture showroom is a RETAIL store: it has no
 * register/interior/robbery — the housing UI buys through it, but it runs on the same
 * stock/reconcile/sale/receipt machinery as the shops (issue #17 §5, PR#18 review #2).
 */

const MAINST_STORE: StoreDefinition = {
  id: 'store_mainst',
  name: 'Main St Convenience',
  registerInteractableId: 'store_mainst_register',
  interiorId: 'store_mainst',
  activityId: 'robbery_mainst_store',
  restockGameHours: 12,
  listings: [
    { itemId: 'snack', maxStock: 8, restockAmount: 4 },
    { itemId: 'meal', maxStock: 6, restockAmount: 3 },
    { itemId: 'energy_drink', maxStock: 8, restockAmount: 4 },
    { itemId: 'first_aid', maxStock: 4, restockAmount: 2 },
    { itemId: 'ammo_box', maxStock: 4, restockAmount: 2 },
    { itemId: 'wardrobe_teal', maxStock: 1, restockAmount: 1 },
  ],
  sourceRef: { file: 'src/game/commerce/storeDefinitions.ts', symbol: 'MAINST_STORE' },
}

const KIOSK_STORE: StoreDefinition = {
  id: 'store_kiosk',
  name: 'Waterfront Kiosk',
  registerInteractableId: 'store_kiosk_register',
  interiorId: 'store_kiosk',
  activityId: 'robbery_waterfront_kiosk',
  restockGameHours: 10,
  listings: [
    { itemId: 'snack', maxStock: 6, restockAmount: 3 },
    { itemId: 'energy_drink', maxStock: 6, restockAmount: 3 },
    { itemId: 'wardrobe_gold', maxStock: 1, restockAmount: 1 },
  ],
  sourceRef: { file: 'src/game/commerce/storeDefinitions.ts', symbol: 'KIOSK_STORE' },
}

/** The furniture showroom — a RETAIL store (no register/interior/robbery). Its listings
 *  are the furniture catalog defs; the price is the catalog price (single source, so the
 *  displayed price equals the charged price). Generous stock + daily restock — a piece is
 *  "ordered in" rather than truly scarce, but every sale decrements real stock and the
 *  out-of-stock path is a first-class, provable state. */
export const FURNITURE_SHOWROOM_ID = 'furniture_showroom'
const SHOWROOM_LISTINGS: readonly StoreListing[] = FURNITURE_DEFS.map((d) => ({
  itemId: d.id,
  kind: 'furniture',
  priceOverride: d.price,
  maxStock: 12,
  restockAmount: 4,
}))
const FURNITURE_SHOWROOM: StoreDefinition = {
  id: FURNITURE_SHOWROOM_ID,
  name: 'City Furnishings',
  kind: 'retail',
  restockGameHours: 24,
  listings: SHOWROOM_LISTINGS,
  sourceRef: { file: 'src/game/commerce/storeDefinitions.ts', symbol: 'FURNITURE_SHOWROOM' },
}

/** Deterministic order (never sorted at runtime). The robbable convenience stores. */
export const STORE_DEFINITIONS: readonly StoreDefinition[] = [MAINST_STORE, KIOSK_STORE]
/** EVERY store the commerce runtime owns — the shops PLUS the furniture showroom. Used by
 *  runtime init + persistence so showroom stock is reload-safe; the robbable-only paths
 *  (register/interior maps, robbery validation) keep using STORE_DEFINITIONS. */
export const ALL_STORE_DEFINITIONS: readonly StoreDefinition[] = [...STORE_DEFINITIONS, FURNITURE_SHOWROOM]

const BY_ID: Record<string, StoreDefinition> = Object.fromEntries(
  ALL_STORE_DEFINITIONS.map((s) => [s.id, s]),
)
// Register/interior maps are ROBBABLE-only: a retail store has neither and must never be
// opened at a register or matched to an interior.
const BY_REGISTER: Record<string, StoreDefinition> = Object.fromEntries(
  STORE_DEFINITIONS.filter((s) => s.registerInteractableId).map((s) => [s.registerInteractableId as string, s]),
)

export function getStoreDefinition(id: string): StoreDefinition | undefined {
  return BY_ID[id]
}

/** The store a register interactable opens, if any. */
export function getStoreForRegister(interactableId: string): StoreDefinition | undefined {
  return BY_REGISTER[interactableId]
}

/** The store hosted by an interior, if any. */
export function getStoreForInterior(interiorId: string): StoreDefinition | undefined {
  return STORE_DEFINITIONS.find((s) => s.interiorId === interiorId)
}

/** Resolve a listing's effective price (override or the item's catalog price). */
export function listingPrice(
  store: StoreDefinition,
  itemId: string,
  catalogPrice: number,
): number {
  const l = store.listings.find((x) => x.itemId === itemId)
  return l?.priceOverride ?? catalogPrice
}
