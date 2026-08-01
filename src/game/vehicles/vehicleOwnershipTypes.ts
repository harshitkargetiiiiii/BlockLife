/**
 * Vehicle Ownership v1 (issue #19 §2/§13) — the typed, serializable STATE that owns
 * LEGITIMATE owned vehicles. Durable IDs + scalars + bounded arrays only; never a Rapier
 * body, React ref, camera, streamed handle, or transient marker (those live in the runtime
 * registry / scene). A stolen civilian/mission vehicle is NOT represented here — it stays a
 * transient crime identity in `vehicleCrimeState` (§2 legitimate-vs-stolen boundary).
 */
import type { ItemStacks } from '../items/itemTypes'
import type { VehicleDefId } from './vehicleRegistry'

/** Unique reload-safe owned-asset id — always `ov_<n>` (n = monotonic assetSeq). */
export type OwnedVehicleId = string

/** Where a legitimate owned vehicle currently is. Exactly one at a time (§2). */
export type VehicleLocationState =
  | { kind: 'active' } // the one physical player shell projects this asset
  | { kind: 'parked'; anchorId: string } // parked at one authored anchor
  | { kind: 'dealership' } // held during an atomic trade
  | { kind: 'impound' } // seized by police
  | { kind: 'recovery' } // bounded safe holding (disabled/invalid geometry/lost shell)

/** Installed cosmetic + functional customization on an owned asset. */
export interface VehicleCustomization {
  paint: string
  wheels: string
  /** Installed functional upgrade ids (one per slot; see the upgrade registry). */
  upgrades: string[]
}

/** A bounded audit/history entry (acquisition/trade/service/impound/recovery). */
export interface VehicleHistoryEntry {
  kind: 'acquired' | 'traded_in' | 'repaired' | 'customized' | 'impounded' | 'released' | 'recovered'
  day: number
  /** Money delta at the event (negative = paid). */
  amount: number
  /** Commerce receipt / exact-once key that produced it, when money moved. */
  receipt?: string
  note?: string
}

/** One legitimate owned vehicle asset. */
export interface OwnedVehicle {
  id: OwnedVehicleId
  defId: VehicleDefId
  /** How it was acquired + the commerce receipt that minted it. */
  acquiredVia: 'purchase' | 'trade' | 'migration'
  acquisitionReceipt: string
  purchaseDay: number
  purchasePrice: number
  /** 0..100, persistent (§7). `disabled` derives from condition <= 0. */
  condition: number
  customization: VehicleCustomization
  /** Per-asset cargo (typed adapter over the item catalog — §8). Occupied-slot math is the
   *  inventory service's; this is just the durable stacks + a bounded overflow holding. */
  cargo: ItemStacks
  cargoOverflow: ItemStacks
  location: VehicleLocationState
  /** Last known safe world transform (for save-while-driving + recovery), if ever activated. */
  lastTransform?: { x: number; z: number; heading: number }
  history: VehicleHistoryEntry[]
}

/** The serialized vehicle-ownership save slice (§13). Additive + versioned. */
export interface VehicleOwnershipState {
  version: number
  /** Owned assets by id (Record so a duplicate id can't mint twice). */
  assets: Record<OwnedVehicleId, OwnedVehicle>
  /** Monotonic owned-asset id counter — kept ahead of any `ov_<n>` so a reload never collides. */
  assetSeq: number
  /** The currently active/selected legitimate asset id, or null (on foot / driving a stolen car). */
  activeAssetId: OwnedVehicleId | null
  /** Exactly-once legacy-migration marker (§3). */
  migrated: boolean
  /** Bounded FIFO of applied exact-once money/asset transaction keys (purchase/trade/repair/…). */
  appliedTxnKeys: string[]
}

export type VehicleOwnershipSaveData = VehicleOwnershipState

// ---- bounds (all state is bounded by construction) ------------------------
export const VEHICLE_OWNED_CAP = 4 // §4 recommended owned-vehicle cap
export const VEHICLE_HISTORY_MAX = 24 // per-asset bounded audit history
export const VEHICLE_APPLIED_TXN_KEYS_MAX = 256
export const VEHICLE_SAVE_VERSION = 1

/** Condition bands for phone/cosmetic status text (§7 display). */
export type ConditionBand = 'pristine' | 'good' | 'worn' | 'damaged' | 'disabled'

export function conditionBand(condition: number): ConditionBand {
  if (condition <= 0) return 'disabled'
  if (condition < 25) return 'damaged'
  if (condition < 55) return 'worn'
  if (condition < 85) return 'good'
  return 'pristine'
}

/** Typed refusal reasons shared across purchase/trade/park/customize/repair gates. */
export type VehicleRefusalReason =
  | 'insufficient_funds'
  | 'ineligible'
  | 'unavailable'
  | 'wanted'
  | 'incapacitated'
  | 'busy'
  | 'no_parking'
  | 'at_cap'
  | 'not_owned'
  | 'stolen_forbidden'
  | 'cargo_not_empty'
  | 'not_at_location'
  | 'moving'
  | 'occupied_anchor'
  | 'incompatible'
  | 'already_installed'
  | 'unknown'
