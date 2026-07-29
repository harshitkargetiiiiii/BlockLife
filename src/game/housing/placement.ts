/**
 * Furniture placement rules (issue #17 §6) — PURE. Given the current property's
 * slots + placements + owned assets, decide whether a place / move / rotate is
 * legal and why not. One-asset-per-slot, one-slot-per-asset, category + size
 * compatibility, fixture-only slots refused, incompatible placements refused with
 * a typed reason. The runtime wrappers (housingRuntime) apply the mutation; these
 * functions never mutate anything.
 */
import { getFurnitureDef } from './furnitureCatalog'
import { getSlot, slotAccepts } from './propertyRegistry'
import { sizeFits, type FurnitureAsset, type FurnitureDef, type PlacementRefusalReason, type PropertyId, type SlotDef } from './housingTypes'

export interface PlacementCheck {
  ok: boolean
  reason?: PlacementRefusalReason
}
const OK: PlacementCheck = { ok: true }
const fail = (reason: PlacementRefusalReason): PlacementCheck => ({ ok: false, reason })

/** Can `assetId` (owned + not placed elsewhere) go into the empty, compatible `slotId`? */
export function canPlaceAsset(
  propertyId: PropertyId,
  slotId: string,
  assetId: string,
  placements: Readonly<Record<string, string>>,
  assets: Readonly<Record<string, FurnitureAsset>>,
): PlacementCheck {
  const slot = getSlot(propertyId, slotId)
  if (!slot) return fail('unknown_slot')
  if (slot.fixtureOnly) return fail('fixture_slot')
  const asset = assets[assetId]
  if (!asset) return fail('not_owned')
  const def = getFurnitureDef(asset.defId)
  if (!def) return fail('not_owned')
  if (placements[slotId]) return fail('slot_occupied')
  if (Object.values(placements).includes(assetId)) return fail('asset_placed_elsewhere')
  if (!slot.allowedCategories.includes(def.category)) return fail('incompatible_category')
  if (!sizeFits(def.size, slot.maxSize)) return fail('incompatible_size')
  return OK
}

/** Can the asset in `fromSlot` move to the empty, compatible `toSlot`? */
export function canMoveAsset(
  propertyId: PropertyId,
  fromSlot: string,
  toSlot: string,
  placements: Readonly<Record<string, string>>,
  assets: Readonly<Record<string, FurnitureAsset>>,
): PlacementCheck {
  const assetId = placements[fromSlot]
  if (!assetId) return fail('unknown_slot')
  if (fromSlot === toSlot) return OK
  const without: Record<string, string> = { ...placements }
  delete without[fromSlot]
  return canPlaceAsset(propertyId, toSlot, assetId, without, assets)
}

/** Can `newAssetId` replace whatever occupies `slotId` (old asset goes to storage)? */
export function canReplaceAsset(
  propertyId: PropertyId,
  slotId: string,
  newAssetId: string,
  placements: Readonly<Record<string, string>>,
  assets: Readonly<Record<string, FurnitureAsset>>,
): PlacementCheck {
  const without: Record<string, string> = { ...placements }
  delete without[slotId]
  return canPlaceAsset(propertyId, slotId, newAssetId, without, assets)
}

/** The next allowed rotation (slot ∩ def), cycling from `currentRot`. */
export function nextRotation(currentRot: number, slot: SlotDef, def: FurnitureDef): number {
  const near = (a: number, b: number): boolean => Math.abs(a - b) < 1e-3
  const allowed = slot.allowedRotations.filter((r) => def.allowedRotations.some((d) => near(d, r)))
  const rots = allowed.length ? allowed : slot.allowedRotations
  if (rots.length === 0) return currentRot
  const i = rots.findIndex((r) => near(r, currentRot))
  return rots[(i + 1) % rots.length]
}

/** Slots (of the given set) that could ACCEPT this def (for the furnish UI highlight). */
export function compatibleSlots(def: FurnitureDef, slots: readonly SlotDef[]): SlotDef[] {
  return slots.filter((s) => !s.fixtureOnly && slotAccepts(s, def.category, def.size))
}
