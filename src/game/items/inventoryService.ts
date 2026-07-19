import { getItemDefinition, isKnownItem } from './itemCatalog'
import type { InventoryResult, ItemStacks, ResolvedStack } from './itemTypes'
import { ITEM_DEFINITIONS } from './itemCatalog'

/**
 * Pure inventory operations over an `ItemStacks` container (item id → quantity).
 * The SAME functions serve the backpack and apartment storage — they differ
 * only by the `capacity` (occupied-slot budget) passed in. Every mutation is
 * atomic and returns a NEW container plus a typed outcome; nothing is mutated in
 * place, and no path can produce a negative or non-integer quantity.
 *
 * Capacity is measured in OCCUPIED SLOTS: an item type occupies
 * `ceil(quantity / stackLimit)` slots, so the record shape (the legacy save)
 * needs no migration while stack + capacity rules are still enforced.
 */

/** Backpack: a small carry limit that makes storage + shopping choices matter. */
export const BACKPACK_CAPACITY = 10
/** Apartment storage: a roomy but bounded stash. */
export const STORAGE_CAPACITY = 40

/** Slots a given quantity of an item occupies (unknown items count as 1 each). */
export function slotsFor(itemId: string, quantity: number): number {
  if (quantity <= 0) return 0
  const def = getItemDefinition(itemId)
  const limit = def ? def.stackLimit : quantity // unknown → single opaque slot
  return Math.ceil(quantity / limit)
}

/** Total occupied slots in a container. */
export function occupiedSlots(stacks: ItemStacks): number {
  let n = 0
  for (const [id, qty] of Object.entries(stacks)) n += slotsFor(id, qty)
  return n
}

export function countItem(stacks: ItemStacks, itemId: string): number {
  return stacks[itemId] ?? 0
}

export function hasItem(stacks: ItemStacks, itemId: string, quantity = 1): boolean {
  return countItem(stacks, itemId) >= quantity
}

/** Extra slots consumed by adding `quantity` more of `itemId` to `stacks`. */
function addedSlots(stacks: ItemStacks, itemId: string, quantity: number): number {
  const current = countItem(stacks, itemId)
  return slotsFor(itemId, current + quantity) - slotsFor(itemId, current)
}

/** Can `quantity` of `itemId` be added without breaching `capacity`? */
export function canAddItem(
  stacks: ItemStacks,
  itemId: string,
  quantity: number,
  capacity: number,
): InventoryResult {
  if (!isKnownItem(itemId)) return { ok: false, reason: 'unknown_item' }
  if (!Number.isInteger(quantity) || quantity <= 0) return { ok: false, reason: 'invalid_quantity' }
  if (occupiedSlots(stacks) + addedSlots(stacks, itemId, quantity) > capacity) {
    return { ok: false, reason: 'capacity_full' }
  }
  return { ok: true }
}

/** Add atomically: returns a new container, or a typed failure. */
export function addItem(
  stacks: ItemStacks,
  itemId: string,
  quantity: number,
  capacity: number,
): InventoryResult {
  const check = canAddItem(stacks, itemId, quantity, capacity)
  if (!check.ok) return check
  return { ok: true, stacks: { ...stacks, [itemId]: countItem(stacks, itemId) + quantity } }
}

export function canRemoveItem(stacks: ItemStacks, itemId: string, quantity: number): InventoryResult {
  if (!Number.isInteger(quantity) || quantity <= 0) return { ok: false, reason: 'invalid_quantity' }
  if (countItem(stacks, itemId) < quantity) return { ok: false, reason: 'not_enough' }
  return { ok: true }
}

/** Remove atomically: returns a new container (deleting the key at zero). */
export function removeItem(stacks: ItemStacks, itemId: string, quantity: number): InventoryResult {
  const check = canRemoveItem(stacks, itemId, quantity)
  if (!check.ok) return check
  const next = { ...stacks }
  const left = next[itemId] - quantity
  if (left <= 0) delete next[itemId]
  else next[itemId] = left
  return { ok: true, stacks: next }
}

export interface TransferResult {
  ok: boolean
  reason?: InventoryResult['reason']
  from?: ItemStacks
  to?: ItemStacks
}

/**
 * Move `quantity` of `itemId` from one container to another, atomically and
 * exactly-once: it succeeds only if BOTH the source has enough AND the
 * destination has room; on any failure neither side changes.
 */
export function transferItem(
  from: ItemStacks,
  to: ItemStacks,
  itemId: string,
  quantity: number,
  toCapacity: number,
): TransferResult {
  const canOut = canRemoveItem(from, itemId, quantity)
  if (!canOut.ok) return { ok: false, reason: canOut.reason }
  const canIn = canAddItem(to, itemId, quantity, toCapacity)
  if (!canIn.ok) return { ok: false, reason: canIn.reason }
  return {
    ok: true,
    from: removeItem(from, itemId, quantity).stacks,
    to: addItem(to, itemId, quantity, toCapacity).stacks,
  }
}

/** Resolve a container into UI rows, in catalog order, dropping unknown ids. */
export function listStacks(stacks: ItemStacks): ResolvedStack[] {
  const rows: ResolvedStack[] = []
  for (const def of ITEM_DEFINITIONS) {
    const quantity = stacks[def.id] ?? 0
    if (quantity > 0) rows.push({ def, quantity, slots: slotsFor(def.id, quantity) })
  }
  return rows
}

/**
 * Sanitise a loaded container: drop unknown/invalid ids and floor quantities to
 * non-negative integers, then TRIM to `capacity` by whole stacks (deterministic
 * catalog order) so a tampered/overfull save can never breach the slot budget.
 */
export function sanitizeStacks(raw: unknown, capacity: number): ItemStacks {
  const out: ItemStacks = {}
  if (!raw || typeof raw !== 'object') return out
  for (const def of ITEM_DEFINITIONS) {
    const v = (raw as Record<string, unknown>)[def.id]
    if (typeof v !== 'number' || !Number.isFinite(v)) continue
    const q = Math.floor(v)
    if (q <= 0) continue
    if (occupiedSlots(out) + slotsFor(def.id, q) > capacity) continue // would overflow → skip
    out[def.id] = q
  }
  return out
}
