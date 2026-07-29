/**
 * Furniture purchase service (issue #17 §5). A thin catalog surface that REUSES the
 * existing economy authority for money — it does NOT build a second store engine.
 * Buying validates money + owned-asset capacity, then the store action charges the
 * economy and mints ONE unique reload-safe asset through the housing runtime, with
 * an exact-once purchase transaction. Furniture is a durable catalog: every piece
 * is always available (a showroom orders it in), so there is no per-item stock to
 * deplete — documented in docs/HOUSING_FURNITURE_AND_PROPERTY.md. Displayed price
 * always equals the charged price (the def's price is the single source).
 */
import { getFurnitureDef } from './furnitureCatalog'
import { atOwnedAssetCap } from './housingRuntime'
import type { FurnitureDefId } from './housingTypes'

export type FurnitureBuyReason = 'unknown_item' | 'insufficient_funds' | 'at_capacity'
export type FurnitureBuyCheck = { ok: true; price: number } | { ok: false; reason: FurnitureBuyReason }

/** Pure purchase validation: unknown def, capacity, and funds — in one place. */
export function canBuyFurniture(defId: FurnitureDefId, money: number): FurnitureBuyCheck {
  const def = getFurnitureDef(defId)
  if (!def) return { ok: false, reason: 'unknown_item' }
  if (atOwnedAssetCap()) return { ok: false, reason: 'at_capacity' }
  if (money < def.price) return { ok: false, reason: 'insufficient_funds' }
  return { ok: true, price: def.price }
}

export function furnitureBuyReasonText(reason: FurnitureBuyReason): string {
  switch (reason) {
    case 'unknown_item':
      return 'That item is unavailable.'
    case 'insufficient_funds':
      return 'Not enough money for that piece.'
    case 'at_capacity':
      return 'You already own the maximum amount of furniture.'
  }
}
