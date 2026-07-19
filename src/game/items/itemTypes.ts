/**
 * Personal Economy, Inventory & Shopping v1 — the item domain keystone.
 *
 * Items are IMMUTABLE authored definitions with stable semantic ids and source
 * refs (same pattern as missions / robbery / sectors). Effects are typed DATA
 * interpreted by a pure service (`itemEffects.ts`) with injected context — never
 * executable callbacks baked into authored data. Nothing here references a mesh,
 * body, React node, or the store; the catalog is a pure lookup.
 *
 * The backpack + apartment storage are `Record<itemId, quantity>` containers
 * (the existing save shape). Capacity is measured in OCCUPIED SLOTS — an item
 * type occupies `ceil(quantity / stackLimit)` slots — so the record shape is
 * preserved (old saves load unchanged) while stack + capacity rules are enforced
 * by the pure `inventoryService`.
 */

export type ItemCategory =
  | 'food' // snacks + meals — reduce hunger
  | 'drink' // energy drinks — restore energy
  | 'medical' // first-aid — restore health
  | 'ammo' // reserve handgun rounds
  | 'quest' // story/quest items (e.g. coffee for Ravi)
  | 'cosmetic' // wardrobe-palette unlocks
  | 'supply' // mission cargo (e.g. the Shelf Run restock crate)

/**
 * A typed, data-only effect applied when an item is USED. Interpreted by the
 * pure effect service against injected authorities (stats, health, ammo,
 * wardrobe). `none` items are not usable (quest/supply carry no on-use effect).
 */
export type ItemEffect =
  | { kind: 'feed'; hunger: number } // reduce hunger by `hunger`
  | { kind: 'refresh'; energy: number } // restore energy by `energy`
  | { kind: 'heal'; health: number } // restore health by `health`
  | { kind: 'ammo'; rounds: number } // add `rounds` to the handgun reserve
  | { kind: 'unlock'; paletteId: string } // unlock a wardrobe palette colour
  | { kind: 'none' } // no on-use effect

export interface ItemDefinition {
  /** Stable semantic id (persisted; never renumbered). */
  id: string
  name: string
  /** One-line description for the Bag/Shop UI. */
  description: string
  category: ItemCategory
  /** Emoji token shown in the UI (no external image assets). */
  icon: string
  /** Max quantity per occupied slot (>=1). Total qty may span multiple slots. */
  stackLimit: number
  /** Base catalog price (money units, >=0). Stores may override per-listing. */
  price: number
  /** Consumable via the Bag "Use" action (interprets `effect`). */
  usable: boolean
  /** May be discarded from the bag. */
  discardable: boolean
  /** May be moved into apartment storage. */
  storable: boolean
  /**
   * Protected while an active quest still needs it: cannot be used, discarded,
   * or stored (the smallest safe policy so a required interaction can't be made
   * impossible). Coffee for Ravi is the v1 example.
   */
  questReserved: boolean
  effect: ItemEffect
  sourceRef: { file: string; symbol: string }
}

/** A container's contents: item id → integer quantity (>=1 when present). */
export type ItemStacks = Record<string, number>

/** A resolved stack row for the UI: the definition + how much is held. */
export interface ResolvedStack {
  def: ItemDefinition
  quantity: number
  /** Occupied slots for this quantity: ceil(quantity / stackLimit). */
  slots: number
}

/** Why a container mutation was refused (typed, never a silent partial write). */
export type InventoryFailure =
  | 'unknown_item'
  | 'invalid_quantity'
  | 'capacity_full' // no free slots for the added stacks
  | 'not_enough' // removing more than held
  | 'not_usable'
  | 'not_discardable'
  | 'not_storable'
  | 'quest_reserved'

export interface InventoryResult {
  ok: boolean
  reason?: InventoryFailure
  /** The resulting container on success (never mutated in place). */
  stacks?: ItemStacks
}
