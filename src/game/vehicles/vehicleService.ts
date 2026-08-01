/**
 * Vehicle lifecycle service (issue #19 §5/§7) — PURE validation + deterministic money/condition
 * math for retrieve / park / recover / repair / impound. The physical shell teleport + driving
 * mode change live in the store action; this module owns the RULES and COSTS so they are
 * headless-testable and can never silently drift from the UI. Money moves through the economy in
 * the store action; nothing here mutates money, the shell, or crime state.
 */
import { getActiveVehicle, getVehicle, setVehicleCondition } from './vehicleOwnershipRuntime'
import { getVehicleDef } from './vehicleRegistry'
import { getParkingAnchor } from './parkingRegistry'
import { wearFactorOf } from './vehicleCustomization'
import type { OwnedVehicle, VehicleRefusalReason } from './vehicleOwnershipTypes'

// ---- repair (§7) --------------------------------------------------------------
/** Money per condition point restored (a bounded, deterministic sink). */
export const REPAIR_COST_PER_POINT = 12

export interface RepairQuote {
  fromCondition: number
  toCondition: number
  points: number
  cost: number
}

/** A quote to fully restore an asset's condition to 100. */
export function repairQuote(asset: OwnedVehicle): RepairQuote {
  const to = 100
  const points = Math.max(0, to - Math.max(0, Math.min(100, asset.condition)))
  return { fromCondition: asset.condition, toCondition: to, points, cost: points * REPAIR_COST_PER_POINT }
}

export type RepairCheck = { ok: true; quote: RepairQuote } | { ok: false; reason: VehicleRefusalReason }

/** Validate a repair: owned, actually damaged, and affordable. Repair is available from the Garage
 *  app (no location gate) so a disabled car is never permanently stranded. */
export function canRepair(assetId: string, money: number): RepairCheck {
  const asset = getVehicle(assetId)
  if (!asset) return { ok: false, reason: 'not_owned' }
  const quote = repairQuote(asset)
  if (quote.points <= 0) return { ok: false, reason: 'already_installed' } // nothing to repair
  if (money < quote.cost) return { ok: false, reason: 'insufficient_funds' }
  return { ok: true, quote }
}

// ---- impound (§7) -------------------------------------------------------------
/** Base release fee, plus a bounded fraction of the class value. */
export const IMPOUND_BASE_FEE = 250
export function impoundFee(asset: OwnedVehicle): number {
  const def = getVehicleDef(asset.defId)
  return IMPOUND_BASE_FEE + Math.round((def?.baseTradeValue ?? 0) * 0.05)
}

export type ImpoundReleaseCheck = { ok: true; fee: number } | { ok: false; reason: VehicleRefusalReason }
export function canReleaseFromImpound(assetId: string, money: number): ImpoundReleaseCheck {
  const asset = getVehicle(assetId)
  if (!asset) return { ok: false, reason: 'not_owned' }
  if (asset.location.kind !== 'impound') return { ok: false, reason: 'unavailable' }
  const fee = impoundFee(asset)
  if (money < fee) return { ok: false, reason: 'insufficient_funds' }
  return { ok: true, fee }
}

// ---- driving-condition damage bridge (§7) -------------------------------------
/** Condition points lost from a physical impact of `impactSpeed` (units/s). Bounded so a single
 *  crash never destroys a car (no permanent destruction in v1) — it only wears it down. */
export function conditionLossFromImpact(impactSpeed: number): number {
  if (impactSpeed <= 6) return 0 // below the collision threshold — cosmetic, no wear
  return Math.min(20, Math.round((impactSpeed - 6) * 1.5))
}

/**
 * Apply driving-impact wear to the ACTIVE owned vehicle (§7). Called from the driving controller
 * only when a real damaging impact registered on the shell; a no-op when driving a legacy/stolen
 * car (no owned active vehicle) so only YOUR vehicles wear down. Returns the points lost.
 */
export function noteActiveVehicleImpact(impactSpeed: number): number {
  const active = getActiveVehicle()
  if (!active) return 0
  // Durability upgrades (Reinforced Frame) reduce the wear a given impact causes (§9).
  const loss = Math.round(conditionLossFromImpact(impactSpeed) * wearFactorOf(active))
  if (loss > 0) setVehicleCondition(active.id, active.condition - loss)
  return loss
}

// ---- retrieve / park / recover validators (rules only) ------------------------
export type LifecycleCheck = { ok: true } | { ok: false; reason: VehicleRefusalReason }

/** May the player start driving this owned asset? Owned, parked or in recovery (not impounded, not
 *  already the active shell), and not disabled (a condition-0 car must be repaired via the Garage
 *  first). Nearness/on-foot/streamed checks are the store action's (they need the live world). */
export function canRetrieve(assetId: string): LifecycleCheck {
  const asset = getVehicle(assetId)
  if (!asset) return { ok: false, reason: 'not_owned' }
  if (asset.location.kind === 'active') return { ok: false, reason: 'busy' }
  if (asset.location.kind === 'impound') return { ok: false, reason: 'unavailable' }
  if (asset.condition <= 0) return { ok: false, reason: 'unavailable' } // disabled — repair first
  return { ok: true }
}

/** May the currently-driven asset be parked (it must be the active shell)? Anchor fit/occupancy is
 *  `vehicleParkingService.canParkAtAnchor`; stopped/nearness is the store action's. */
export function canPark(assetId: string): LifecycleCheck {
  const asset = getVehicle(assetId)
  if (!asset) return { ok: false, reason: 'not_owned' }
  if (asset.location.kind !== 'active') return { ok: false, reason: 'not_owned' }
  return { ok: true }
}

/**
 * May the player send an owned asset to safe recovery holding? This is a BOUNDED EMERGENCY only
 * (§5), NOT a free "summon any car": permitted when the vehicle is disabled (condition ≤ 0) or its
 * parking anchor is unknown/removed (e.g. after migration) — a healthy vehicle parked at a valid
 * anchor is retrieved by DRIVING it, not recovered. Never the active shell or an impounded car.
 */
export function canRecover(assetId: string): LifecycleCheck {
  const asset = getVehicle(assetId)
  if (!asset) return { ok: false, reason: 'not_owned' }
  if (asset.location.kind === 'active') return { ok: false, reason: 'busy' }
  if (asset.location.kind === 'impound') return { ok: false, reason: 'unavailable' }
  const disabled = asset.condition <= 0
  const lostAnchor = asset.location.kind === 'parked' && !getParkingAnchor(asset.location.anchorId)
  const inRecovery = asset.location.kind === 'recovery'
  if (!disabled && !lostAnchor && !inRecovery) return { ok: false, reason: 'unavailable' }
  return { ok: true }
}
