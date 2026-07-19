import type { StoreDefinition } from './commerceTypes'

/**
 * The two authored stores. Everything store-specific is DATA: catalog, prices,
 * stock caps, and restock cadence. Both reuse their existing robbery interior +
 * register interactable (never a second interior/cashier). Main Street is the
 * fuller shop; the Waterfront kiosk is a small themed stall.
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

/** Deterministic store order (never sorted at runtime). */
export const STORE_DEFINITIONS: readonly StoreDefinition[] = [MAINST_STORE, KIOSK_STORE]

const BY_ID: Record<string, StoreDefinition> = Object.fromEntries(
  STORE_DEFINITIONS.map((s) => [s.id, s]),
)
const BY_REGISTER: Record<string, StoreDefinition> = Object.fromEntries(
  STORE_DEFINITIONS.map((s) => [s.registerInteractableId, s]),
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
