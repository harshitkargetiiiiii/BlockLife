/**
 * Per-vehicle cargo (issue #19 §8) — a typed adapter over the EXISTING inventory service. A
 * vehicle's cargo is `ItemStacks` (the same shape as the backpack + home storage) and its capacity
 * is occupied-slot math (`occupiedSlots`), reusing the ONE stack model — never a parallel inventory.
 * Load/unload go through the atomic exact-once `transferItem`, so items can never be duplicated or
 * lost. These functions are pure (return new stacks); the store action assigns them + bumps the UI.
 */
import { BACKPACK_CAPACITY, occupiedSlots, transferItem } from '../items/inventoryService'
import { getVehicleDef } from './vehicleRegistry'
import { cargoSlotBonus } from './vehicleCustomization'
import type { ItemStacks } from '../items/itemTypes'
import type { OwnedVehicle, VehicleRefusalReason } from './vehicleOwnershipTypes'

/** Total cargo slots this vehicle provides (class base + cargo upgrades). */
export function cargoCapacityOf(asset: OwnedVehicle): number {
  return (getVehicleDef(asset.defId)?.cargoCapacity ?? 0) + cargoSlotBonus(asset)
}

/** Occupied cargo slots currently used. */
export function cargoUsedOf(asset: OwnedVehicle): number {
  return occupiedSlots(asset.cargo)
}

export type CargoResult =
  | { ok: true; backpack: ItemStacks; cargo: ItemStacks }
  | { ok: false; reason: VehicleRefusalReason }

function accessible(asset: OwnedVehicle): boolean {
  return asset.location.kind !== 'impound' // an impounded car's cargo is inaccessible
}

/** Load `quantity` of `itemId` from the backpack into the vehicle's cargo (atomic). */
export function loadCargo(backpack: ItemStacks, asset: OwnedVehicle, itemId: string, quantity: number): CargoResult {
  if (!accessible(asset)) return { ok: false, reason: 'unavailable' }
  const r = transferItem(backpack, asset.cargo, itemId, quantity, cargoCapacityOf(asset))
  if (!r.ok) return { ok: false, reason: r.reason === 'capacity_full' ? 'cargo_not_empty' : 'unavailable' }
  return { ok: true, backpack: r.from!, cargo: r.to! }
}

/** Unload `quantity` of `itemId` from the vehicle's cargo back into the backpack (atomic). */
export function unloadCargo(backpack: ItemStacks, asset: OwnedVehicle, itemId: string, quantity: number): CargoResult {
  if (!accessible(asset)) return { ok: false, reason: 'unavailable' }
  const r = transferItem(asset.cargo, backpack, itemId, quantity, BACKPACK_CAPACITY)
  if (!r.ok) return { ok: false, reason: r.reason === 'capacity_full' ? 'unavailable' : 'unavailable' }
  return { ok: true, backpack: r.to!, cargo: r.from! }
}
