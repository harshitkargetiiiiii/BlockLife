/**
 * Vehicle customization (issue #19 §9) — the upgrade registry + PURE effect readers + install
 * validation. Cosmetic paint/wheels live directly on `customization`; FUNCTIONAL upgrades are ids
 * in `customization.upgrades` (one per functional category, only if the class allows it). Effects
 * are DATA read by the projection (performance), cargo (capacity) and damage (durability) — display
 * always equals execution. Money + the actual install mutation are the store action's; this module
 * never mutates money or the shell.
 */
import { getVehicleDef, type UpgradeCategory, type VehicleDef } from './vehicleRegistry'
import { getVehicle } from './vehicleOwnershipRuntime'
import type { OwnedVehicle, VehicleRefusalReason } from './vehicleOwnershipTypes'

export interface UpgradeDef {
  id: string
  category: Extract<UpgradeCategory, 'performance' | 'cargo' | 'durability'>
  displayName: string
  description: string
  price: number
  /** Performance: bounded top-speed / acceleration deltas (streaming-safe by registry validation). */
  maxSpeedDelta?: number
  accelDelta?: number
  /** Cargo: extra occupied-cargo slots. */
  cargoSlots?: number
  /** Durability: multiplies condition loss from impacts (< 1 = tougher). */
  wearFactor?: number
  sourceRef: { file: string; symbol: string }
}

const SRC = (symbol: string) => ({ file: 'src/game/vehicles/vehicleCustomization.ts', symbol })

export const UPGRADE_DEFS: readonly UpgradeDef[] = [
  { id: 'up_sport_tune', category: 'performance', displayName: 'Sport Tune', description: 'A little more top-end and punch off the line.', price: 3000, maxSpeedDelta: 2, accelDelta: 1, sourceRef: SRC('up_sport_tune') },
  { id: 'up_cargo_rack', category: 'cargo', displayName: 'Cargo Rack', description: 'Bolt-on rack — four more cargo slots.', price: 800, cargoSlots: 4, sourceRef: SRC('up_cargo_rack') },
  { id: 'up_reinforced_frame', category: 'durability', displayName: 'Reinforced Frame', description: 'Takes knocks better — half the wear from impacts.', price: 1500, wearFactor: 0.5, sourceRef: SRC('up_reinforced_frame') },
]

const BY_ID: Record<string, UpgradeDef> = Object.fromEntries(UPGRADE_DEFS.map((u) => [u.id, u]))
export function getUpgradeDef(id: string): UpgradeDef | undefined {
  return BY_ID[id]
}

/** The installed upgrade defs on an asset (dropping any unknown id defensively). */
export function installedUpgrades(asset: OwnedVehicle): UpgradeDef[] {
  return asset.customization.upgrades.map((id) => BY_ID[id]).filter((u): u is UpgradeDef => u !== undefined)
}

/** Upgrades this class may accept (from the def's allowedUpgrades), in registry order. */
export function availableUpgradesFor(def: VehicleDef): UpgradeDef[] {
  return UPGRADE_DEFS.filter((u) => def.allowedUpgrades.includes(u.category))
}

// ---- pure effect readers (used by projection / cargo / damage) ----------------
export function performanceDelta(asset: OwnedVehicle): { maxSpeed: number; acceleration: number } {
  let maxSpeed = 0
  let acceleration = 0
  for (const u of installedUpgrades(asset)) {
    maxSpeed += u.maxSpeedDelta ?? 0
    acceleration += u.accelDelta ?? 0
  }
  return { maxSpeed, acceleration }
}

export function cargoSlotBonus(asset: OwnedVehicle): number {
  let bonus = 0
  for (const u of installedUpgrades(asset)) bonus += u.cargoSlots ?? 0
  return bonus
}

/** Combined wear factor from durability upgrades (product; clamped to a sane floor). */
export function wearFactorOf(asset: OwnedVehicle): number {
  let factor = 1
  for (const u of installedUpgrades(asset)) factor *= u.wearFactor ?? 1
  return Math.max(0.25, factor)
}

// ---- install / paint validation -----------------------------------------------
export type InstallCheck = { ok: true; price: number } | { ok: false; reason: VehicleRefusalReason }

/** Validate installing `upgradeId` on `assetId`: owned, class allows the category, not already
 *  holding an upgrade of that category, and affordable. Never mutates. */
export function canInstallUpgrade(assetId: string, upgradeId: string, money: number): InstallCheck {
  const asset = getVehicle(assetId)
  if (!asset) return { ok: false, reason: 'not_owned' }
  const up = getUpgradeDef(upgradeId)
  const def = getVehicleDef(asset.defId)
  if (!up || !def) return { ok: false, reason: 'unavailable' }
  if (!def.allowedUpgrades.includes(up.category)) return { ok: false, reason: 'incompatible' }
  // One functional upgrade per category.
  if (installedUpgrades(asset).some((u) => u.category === up.category)) return { ok: false, reason: 'already_installed' }
  if (money < up.price) return { ok: false, reason: 'insufficient_funds' }
  return { ok: true, price: up.price }
}

export type PaintCheck = { ok: true } | { ok: false; reason: VehicleRefusalReason }
/** Validate a paint swap: owned + the colour is in the class palette. Cheap cosmetic (no money). */
export function canPaint(assetId: string, color: string): PaintCheck {
  const asset = getVehicle(assetId)
  if (!asset) return { ok: false, reason: 'not_owned' }
  const def = getVehicleDef(asset.defId)
  if (!def || !def.paintPalette.includes(color)) return { ok: false, reason: 'incompatible' }
  return { ok: true }
}

/** Registry validation (§9): unique ids, positive price, sane bounded effects. */
export function validateUpgradeRegistry(): string[] {
  const errors: string[] = []
  const seen = new Set<string>()
  for (const u of UPGRADE_DEFS) {
    if (seen.has(u.id)) errors.push(`${u.id}: duplicate upgrade id`)
    seen.add(u.id)
    if (!(u.price >= 0)) errors.push(`${u.id}: negative price`)
    if (u.wearFactor !== undefined && !(u.wearFactor > 0 && u.wearFactor <= 1)) errors.push(`${u.id}: wearFactor must be in (0,1]`)
    if (u.cargoSlots !== undefined && !(u.cargoSlots > 0)) errors.push(`${u.id}: cargoSlots must be positive`)
    if ((u.maxSpeedDelta ?? 0) > 2) errors.push(`${u.id}: performance top-speed delta exceeds the streaming-safe headroom (2)`)
  }
  return errors
}
