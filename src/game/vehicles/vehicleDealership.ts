/**
 * Vehicle dealership service (issue #19 §4). Vehicle retail + trade-in runs through the EXISTING
 * commerce authority — NOT a parallel shop. A dedicated `vehicle_dealership` retail store (see
 * `commerce/storeDefinitions.ts`) lists every listed vehicle def at its base price, with real
 * stock the commerce runtime reconciles, decrements on sale, and persists. A purchase validates
 * through the SAME `canPurchase` gate as any store (stock/availability + funds + display==charge)
 * PLUS the vehicle gates: legitimacy (never a stolen identity), player state (wanted / incapacitated
 * / busy), career eligibility, and the owned cap. The store action records the sale + a commerce
 * receipt and mints the unique owned asset ONLY after money moves (mint-after-sale). Trade-in
 * valuation is deterministic (base trade value scaled by persistent condition). This module is
 * pure/validation + commerce commit; the atomic money+asset move lives in the store action.
 */
import { canPurchase } from '../commerce/commerceEngine'
import { commerceRuntime, getStoreStock, nextPurchaseReceipt, reconcileStore, recordSale } from '../commerce/commerceRuntime'
import { VEHICLE_DEALERSHIP_ID, getStoreDefinition } from '../commerce/storeDefinitions'
import { stockOf } from '../commerce/stockLogic'
import { getVehicleDef, VEHICLE_DEFS, type VehicleDef, type VehicleDefId } from './vehicleRegistry'
import { atOwnedCap, getVehicle } from './vehicleOwnershipRuntime'
import { vehicleEligibility } from './vehicleEligibility'
import type { OwnedVehicle, VehicleRefusalReason } from './vehicleOwnershipTypes'

export type VehicleBuyCheck =
  | { ok: true; price: number }
  | { ok: false; reason: VehicleRefusalReason }

/** Player-state gates the caller resolves from the live authorities (crime/health/activity). */
export interface VehiclePurchaseContext {
  money: number
  day: number
  /** Any active wanted level blocks a legitimate dealership transaction (§4). */
  wanted: boolean
  /** Incapacitated (very low health / hospital) blocks buying (§4). */
  incapacitated: boolean
  /** Busy in an exclusive activity (robbery / active shift / mission that owns the player). */
  busy: boolean
}

/** The listed dealership defs, in registry order (never sorted at runtime) — for the Garage UI. */
export function dealershipListings(): readonly VehicleDef[] {
  return VEHICLE_DEFS.filter((d) => d.listed)
}

/** Current dealership stock for a vehicle def (0 if unlisted). */
export function vehicleStockOf(defId: VehicleDefId): number {
  return stockOf(getStoreStock(VEHICLE_DEALERSHIP_ID), defId)
}

/** Lazily reconcile dealership stock forward to `gameHours` (idempotent, never per frame). */
export function reconcileVehicleDealership(gameHours: number): void {
  reconcileStore(VEHICLE_DEALERSHIP_ID, gameHours)
}

/**
 * Pure purchase validation in one place: unknown/unlisted def, player-state gates, career
 * eligibility, owned cap, then the shared commerce gate (stock + funds + resolved price).
 * Never mutates. Precedence is fixed so the refusal message is deterministic.
 */
export function canBuyVehicle(defId: VehicleDefId, ctx: VehiclePurchaseContext): VehicleBuyCheck {
  const def = getVehicleDef(defId)
  if (!def || !def.listed) return { ok: false, reason: 'unavailable' }
  if (ctx.wanted) return { ok: false, reason: 'wanted' }
  if (ctx.incapacitated) return { ok: false, reason: 'incapacitated' }
  if (ctx.busy) return { ok: false, reason: 'busy' }
  if (!vehicleEligibility(def.requirement, ctx.day).eligible) return { ok: false, reason: 'ineligible' }
  if (atOwnedCap()) return { ok: false, reason: 'at_cap' }
  const store = getStoreDefinition(VEHICLE_DEALERSHIP_ID)
  if (!store) return { ok: false, reason: 'unavailable' }
  const check = canPurchase(defId, {
    store,
    stock: getStoreStock(VEHICLE_DEALERSHIP_ID),
    money: ctx.money,
    backpack: {}, // a vehicle never enters the backpack — the durable-asset branch skips it
    backpackCapacity: 0,
    storeClosed: false, // the dealership is retail — never robbed/closed
  })
  if (!check.ok) {
    const reason: VehicleRefusalReason =
      check.reason === 'out_of_stock' ? 'unavailable'
      : check.reason === 'insufficient_funds' ? 'insufficient_funds'
      : 'unavailable'
    return { ok: false, reason }
  }
  return { ok: true, price: check.price ?? def.basePrice }
}

/**
 * Deterministic trade-in value of an owned asset (§4): base trade value scaled by persistent
 * condition (a pristine car returns its full base trade value; a wreck a bounded fraction).
 * Never exceeds the def's base trade value (which the registry keeps below its price).
 */
const TRADE_CONDITION_FLOOR = 0.4
export function vehicleTradeValue(asset: OwnedVehicle): number {
  const def = getVehicleDef(asset.defId)
  if (!def) return 0
  const cond = Math.max(0, Math.min(100, asset.condition)) / 100
  const factor = TRADE_CONDITION_FLOOR + (1 - TRADE_CONDITION_FLOOR) * cond
  return Math.max(0, Math.round(def.baseTradeValue * factor))
}

export type VehicleTradeCheck =
  | { ok: true; price: number; tradeValue: number }
  | { ok: false; reason: VehicleRefusalReason }

/**
 * Validate a trade-in of `tradeInId` toward buying `newDefId`. The old asset must be a settled,
 * owned, empty-cargo vehicle that is not impounded or the active shell mid-drive (you can't trade
 * a seized car or the car you're driving). The owned cap is NOT a blocker (one leaves as one
 * arrives). Net price = max(0, newPrice − tradeValue). Career eligibility + player-state gates on
 * the NEW vehicle still apply.
 */
export function canTradeIn(
  tradeInId: string,
  newDefId: VehicleDefId,
  ctx: VehiclePurchaseContext,
): VehicleTradeCheck {
  const old = getVehicle(tradeInId)
  if (!old) return { ok: false, reason: 'not_owned' }
  if (old.location.kind === 'impound') return { ok: false, reason: 'unavailable' }
  if (old.location.kind === 'active') return { ok: false, reason: 'busy' }
  if (hasCargo(old)) return { ok: false, reason: 'cargo_not_empty' }
  const newDef = getVehicleDef(newDefId)
  if (!newDef || !newDef.listed) return { ok: false, reason: 'unavailable' }
  if (ctx.wanted) return { ok: false, reason: 'wanted' }
  if (ctx.incapacitated) return { ok: false, reason: 'incapacitated' }
  if (ctx.busy) return { ok: false, reason: 'busy' }
  if (!vehicleEligibility(newDef.requirement, ctx.day).eligible) return { ok: false, reason: 'ineligible' }
  if (vehicleStockOf(newDefId) <= 0) return { ok: false, reason: 'unavailable' }
  const tradeValue = vehicleTradeValue(old)
  const net = Math.max(0, newDef.basePrice - tradeValue)
  if (ctx.money < net) return { ok: false, reason: 'insufficient_funds' }
  return { ok: true, price: net, tradeValue }
}

function hasCargo(asset: OwnedVehicle): boolean {
  const total = (s: Record<string, number>): number => Object.values(s).reduce((n, q) => n + (q > 0 ? q : 0), 0)
  return total(asset.cargo) + total(asset.cargoOverflow) > 0
}

/**
 * Commit the commerce side of a vehicle sale: decrement dealership stock (sale recording) and
 * mint a receipt from the shared purchase-receipt authority. The caller charges money + mints the
 * owned asset only after this returns (mint-after-transaction).
 */
export function commitVehicleSale(defId: VehicleDefId): { receipt: string } {
  recordSale(VEHICLE_DEALERSHIP_ID, defId, 1)
  return { receipt: nextPurchaseReceipt(VEHICLE_DEALERSHIP_ID) }
}

/** A commerce receipt for a paid SERVICE (repair / upgrade install) through the SAME receipt
 *  authority as sales (§7/§9) — no second ledger; the service fee is charged by the store action. */
export function nextServiceReceipt(): string {
  return nextPurchaseReceipt(VEHICLE_DEALERSHIP_ID)
}

export function vehicleRefusalText(reason: VehicleRefusalReason): string {
  switch (reason) {
    case 'insufficient_funds': return 'Not enough money for that vehicle.'
    case 'ineligible': return "You don't qualify for that vehicle yet."
    case 'unavailable': return 'That vehicle is unavailable right now.'
    case 'wanted': return 'Settle your record before doing business here.'
    case 'incapacitated': return "You're in no shape to do this right now."
    case 'busy': return "You can't do that while you're occupied."
    case 'at_cap': return 'You already own the maximum number of vehicles — trade one in.'
    case 'not_owned': return "You don't own that vehicle."
    case 'stolen_forbidden': return 'A stolen vehicle is not yours to trade or keep.'
    case 'cargo_not_empty': return 'Empty the cargo before trading this vehicle in.'
    case 'no_parking': return 'No safe parking is available for that vehicle.'
    case 'not_at_location': return "You're not at the right place for that."
    case 'moving': return 'Come to a full stop first.'
    case 'occupied_anchor': return 'A vehicle is already parked there.'
    case 'incompatible': return "That doesn't fit this vehicle."
    case 'already_installed': return 'That is already installed.'
    case 'unknown': return 'That action is unavailable.'
  }
}

/** DEV/E2E only: force dealership stock for a def to prove the out-of-stock path deterministically. */
export function devSetVehicleStock(defId: VehicleDefId, units: number): void {
  const s = getStoreStock(VEHICLE_DEALERSHIP_ID)
  commerceRuntime.stores[VEHICLE_DEALERSHIP_ID] = {
    ...s,
    stock: { ...s.stock, [defId]: Math.max(0, Math.trunc(units)) },
  }
}
