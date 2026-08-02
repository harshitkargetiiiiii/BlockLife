/**
 * Vehicle Ownership runtime (issue #19 §2/§15) — a module singleton holding the LEGITIMATE
 * owned-vehicle state (ids + scalars + bounded arrays), mutated via named functions, never in
 * render. It lives OUTSIDE zustand (like the housing/commerce/social runtimes) so it survives
 * sector streaming; the DOM UI re-renders via a `vehicleVersion` store counter. Money flows
 * through the economy, receipts/stock through commerce, theft/stolen identity through
 * `vehicleCrimeState` — this runtime owns none of those, only durable ownership.
 */
import type { ItemStacks } from '../items/itemTypes'
import {
  VEHICLE_APPLIED_TXN_KEYS_MAX,
  VEHICLE_HISTORY_MAX,
  VEHICLE_OWNED_CAP,
  VEHICLE_SAVE_VERSION,
  type OwnedVehicle,
  type OwnedVehicleId,
  type VehicleCustomization,
  type VehicleHistoryEntry,
  type VehicleLocationState,
  type VehicleOwnershipState,
} from './vehicleOwnershipTypes'
import { getVehicleDef, type VehicleDefId } from './vehicleRegistry'

export function defaultVehicleOwnershipState(): VehicleOwnershipState {
  return {
    version: VEHICLE_SAVE_VERSION,
    assets: {},
    assetSeq: 0,
    activeAssetId: null,
    migrated: false,
    appliedTxnKeys: [],
  }
}

export const vehicleOwnershipRuntime = {
  state: defaultVehicleOwnershipState(),
  debugEnabled: false,
}

export function resetVehicleOwnership(): void {
  vehicleOwnershipRuntime.state = defaultVehicleOwnershipState()
}

// ---- reads ----------------------------------------------------------------

export function getOwnedVehicles(): OwnedVehicle[] {
  return Object.values(vehicleOwnershipRuntime.state.assets)
}

export function getVehicle(id: OwnedVehicleId | null | undefined): OwnedVehicle | undefined {
  return id ? vehicleOwnershipRuntime.state.assets[id] : undefined
}

export function getActiveVehicle(): OwnedVehicle | undefined {
  return getVehicle(vehicleOwnershipRuntime.state.activeAssetId)
}

export function ownedCount(): number {
  return Object.keys(vehicleOwnershipRuntime.state.assets).length
}

export function atOwnedCap(): boolean {
  return ownedCount() >= VEHICLE_OWNED_CAP
}

/** The owned asset parked at `anchorId`, if any (one vehicle per anchor — §5). */
export function getVehicleAtAnchor(anchorId: string): OwnedVehicle | undefined {
  return getOwnedVehicles().find((v) => v.location.kind === 'parked' && v.location.anchorId === anchorId)
}

export function isAnchorOccupied(anchorId: string, exceptAssetId?: OwnedVehicleId): boolean {
  const v = getVehicleAtAnchor(anchorId)
  return v !== undefined && v.id !== exceptAssetId
}

// ---- exact-once transaction ledger ----------------------------------------

export function hasVehicleTxnKey(key: string): boolean {
  return vehicleOwnershipRuntime.state.appliedTxnKeys.includes(key)
}

/** Mark a money/asset transaction key applied (bounded FIFO). Returns false on a duplicate
 *  (a true no-op) so an accidental replay can never double-charge or double-mint (§4). */
export function markVehicleTxn(key: string): boolean {
  const s = vehicleOwnershipRuntime.state
  if (s.appliedTxnKeys.includes(key)) return false
  s.appliedTxnKeys.push(key)
  if (s.appliedTxnKeys.length > VEHICLE_APPLIED_TXN_KEYS_MAX) {
    s.appliedTxnKeys.splice(0, s.appliedTxnKeys.length - VEHICLE_APPLIED_TXN_KEYS_MAX)
  }
  return true
}

// ---- mint / mutate --------------------------------------------------------

function freshCustomization(defId: VehicleDefId): VehicleCustomization {
  const def = getVehicleDef(defId)
  return { paint: def?.baseColor ?? '#d7e6ee', wheels: 'wheels_standard', upgrades: [] }
}

const EMPTY_STACKS = (): ItemStacks => ({})

/**
 * Mint a unique owned vehicle asset for a bought/traded/migrated definition. Caller is
 * responsible for the money + commerce receipt BEFORE minting (§4 mint-after-sale). The new
 * asset starts at a caller-chosen location (dealership pickup → parked/active). Never touches
 * `vehicleCrimeState`; stealing can never reach this path (§2).
 */
export function mintOwnedVehicle(
  defId: VehicleDefId,
  opts: { acquiredVia: OwnedVehicle['acquiredVia']; receipt: string; day: number; price: number; location: VehicleLocationState },
): OwnedVehicle {
  const s = vehicleOwnershipRuntime.state
  const def = getVehicleDef(defId)
  s.assetSeq += 1
  const asset: OwnedVehicle = {
    id: `ov_${s.assetSeq}`,
    defId,
    acquiredVia: opts.acquiredVia,
    acquisitionReceipt: opts.receipt,
    purchaseDay: Math.trunc(opts.day),
    purchasePrice: Math.max(0, Math.round(opts.price)),
    condition: def?.baseCondition ?? 100,
    customization: freshCustomization(defId),
    cargo: EMPTY_STACKS(),
    cargoOverflow: EMPTY_STACKS(),
    location: opts.location,
    history: [],
  }
  addHistory(asset, { kind: 'acquired', day: asset.purchaseDay, amount: -asset.purchasePrice, receipt: opts.receipt })
  s.assets[asset.id] = asset
  return asset
}

/** Remove an owned asset (trade-in). Returns the removed asset for the audit trail. */
export function removeOwnedVehicle(id: OwnedVehicleId): OwnedVehicle | undefined {
  const s = vehicleOwnershipRuntime.state
  const asset = s.assets[id]
  if (!asset) return undefined
  delete s.assets[id]
  if (s.activeAssetId === id) s.activeAssetId = null
  return asset
}

/** Append a bounded audit-history entry to an asset. */
export function addHistory(asset: OwnedVehicle, entry: VehicleHistoryEntry): void {
  asset.history.push(entry)
  if (asset.history.length > VEHICLE_HISTORY_MAX) asset.history.splice(0, asset.history.length - VEHICLE_HISTORY_MAX)
}

/** Set an asset's location (parked/active/dealership/impound/recovery). Enforces one-active. */
export function setVehicleLocation(id: OwnedVehicleId, location: VehicleLocationState): void {
  const s = vehicleOwnershipRuntime.state
  const asset = s.assets[id]
  if (!asset) return
  // Only one asset may be `active` at a time; activating one deactivates the previous.
  if (location.kind === 'active') {
    for (const other of getOwnedVehicles()) {
      if (other.id !== id && other.location.kind === 'active') {
        // The previously-active owned asset is dropped to recovery holding by the caller;
        // here we defensively keep it out of `active` so two never claim the shell.
        other.location = { kind: 'recovery' }
      }
    }
    s.activeAssetId = id
  } else if (s.activeAssetId === id) {
    s.activeAssetId = null
  }
  asset.location = location
}

/** Set the selected/active asset id directly (selection without moving the shell yet). */
export function setActiveVehicle(id: OwnedVehicleId | null): void {
  vehicleOwnershipRuntime.state.activeAssetId = id
}

/** Clamp + set a persistent condition value; returns the disabled flag. */
export function setVehicleCondition(id: OwnedVehicleId, condition: number): boolean {
  const asset = vehicleOwnershipRuntime.state.assets[id]
  if (!asset) return false
  asset.condition = Math.max(0, Math.min(100, Math.round(condition)))
  return asset.condition <= 0
}

export function isVehicleDisabled(id: OwnedVehicleId | null | undefined): boolean {
  const asset = getVehicle(id)
  return asset ? asset.condition <= 0 : false
}
