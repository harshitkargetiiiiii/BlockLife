import type { ItemDefinition } from './itemTypes'

/**
 * The authored item catalog. Every item in the game — including the legacy
 * `coffee` used by Coffee for Ravi — resolves through here. Definitions are
 * immutable, ordered deterministically, and validated (see `itemValidation.ts`).
 * Prices are tuned against the current economy (start $50, work $50/shift,
 * meal $10, missions $100–280): consumables are cheap, first-aid / ammo / a
 * wardrobe colour are a work-shift or two.
 */

const REF = (symbol: string) => ({ file: 'src/game/items/itemCatalog.ts', symbol })

const COFFEE: ItemDefinition = {
  id: 'coffee',
  name: 'Coffee',
  description: "A hot cup for Ravi. He's waiting on it.",
  category: 'quest',
  icon: '☕',
  stackLimit: 5,
  price: 5, // matches the legacy COFFEE_COST
  usable: false,
  discardable: false,
  storable: false,
  questReserved: true,
  effect: { kind: 'none' },
  sourceRef: REF('COFFEE'),
}

const SNACK: ItemDefinition = {
  id: 'snack',
  name: 'Snack Bar',
  description: 'Takes the edge off. A quick bite.',
  category: 'food',
  icon: '🍫',
  stackLimit: 10,
  price: 6,
  usable: true,
  discardable: true,
  storable: true,
  questReserved: false,
  effect: { kind: 'feed', hunger: 12 },
  sourceRef: REF('SNACK'),
}

const MEAL: ItemDefinition = {
  id: 'meal',
  name: 'Portable Meal',
  description: 'A proper meal to go. Fills you up.',
  category: 'food',
  icon: '🍱',
  stackLimit: 5,
  price: 13,
  usable: true,
  discardable: true,
  storable: true,
  questReserved: false,
  effect: { kind: 'feed', hunger: 25 },
  sourceRef: REF('MEAL'),
}

const ENERGY_DRINK: ItemDefinition = {
  id: 'energy_drink',
  name: 'Energy Drink',
  description: 'A jolt of energy for a long day.',
  category: 'drink',
  icon: '🥤',
  stackLimit: 10,
  price: 10,
  usable: true,
  discardable: true,
  storable: true,
  questReserved: false,
  effect: { kind: 'refresh', energy: 20 },
  sourceRef: REF('ENERGY_DRINK'),
}

const FIRST_AID: ItemDefinition = {
  id: 'first_aid',
  name: 'First-Aid Kit',
  description: 'Patch yourself up. Restores health.',
  category: 'medical',
  icon: '🩹',
  stackLimit: 5,
  price: 35,
  usable: true,
  discardable: true,
  storable: true,
  questReserved: false,
  effect: { kind: 'heal', health: 35 },
  sourceRef: REF('FIRST_AID'),
}

const AMMO_BOX: ItemDefinition = {
  id: 'ammo_box',
  name: 'Handgun Ammo Box',
  description: 'A box of reserve rounds for your handgun.',
  category: 'ammo',
  icon: '📦',
  stackLimit: 5,
  price: 40,
  usable: true,
  discardable: true,
  storable: true,
  questReserved: false,
  effect: { kind: 'ammo', rounds: 24 },
  sourceRef: REF('AMMO_BOX'),
}

const WARDROBE_TEAL: ItemDefinition = {
  id: 'wardrobe_teal',
  name: 'Teal Dye',
  description: 'Unlocks the Teal colour in your wardrobe.',
  category: 'cosmetic',
  icon: '🎨',
  stackLimit: 1,
  price: 70,
  usable: true,
  discardable: true,
  storable: true,
  questReserved: false,
  effect: { kind: 'unlock', paletteId: 'teal' },
  sourceRef: REF('WARDROBE_TEAL'),
}

const WARDROBE_GOLD: ItemDefinition = {
  id: 'wardrobe_gold',
  name: 'Gold Dye',
  description: 'Unlocks the Gold colour in your wardrobe.',
  category: 'cosmetic',
  icon: '🎨',
  stackLimit: 1,
  price: 90,
  usable: true,
  discardable: true,
  storable: true,
  questReserved: false,
  effect: { kind: 'unlock', paletteId: 'gold' },
  sourceRef: REF('WARDROBE_GOLD'),
}

const RESTOCK_CRATE: ItemDefinition = {
  id: 'restock_crate',
  name: 'Restock Crate',
  description: 'A sealed supply crate for a store delivery.',
  category: 'supply',
  icon: '🗳️',
  stackLimit: 1,
  price: 0, // never sold — granted by the Shelf Run activity
  usable: false,
  discardable: false, // mission cargo — dropped only by its cleanup policy
  storable: false,
  questReserved: true,
  effect: { kind: 'none' },
  sourceRef: REF('RESTOCK_CRATE'),
}

/** Deterministic catalog order (never sorted at runtime). */
export const ITEM_DEFINITIONS: readonly ItemDefinition[] = [
  COFFEE,
  SNACK,
  MEAL,
  ENERGY_DRINK,
  FIRST_AID,
  AMMO_BOX,
  WARDROBE_TEAL,
  WARDROBE_GOLD,
  RESTOCK_CRATE,
]

const BY_ID: Record<string, ItemDefinition> = Object.fromEntries(
  ITEM_DEFINITIONS.map((d) => [d.id, d]),
)

export function getItemDefinition(id: string): ItemDefinition | undefined {
  return BY_ID[id]
}

/** True when an id resolves to a real catalog item. */
export function isKnownItem(id: string): boolean {
  return id in BY_ID
}
