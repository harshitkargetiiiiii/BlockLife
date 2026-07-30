/**
 * Housing runtime (issue #17) — the module singleton that owns {@link HousingState}
 * (like careerRuntime / commerceRuntime, OUTSIDE zustand; UI re-renders via the
 * store's `housingVersion` counter — gotcha #22). It is event-driven, never
 * per-frame. All money/asset actions funnel through here exact-once; the monotonic
 * `assetSeq` / period keys live in the serialized state, so a reload can never mint
 * a duplicate asset id or re-charge a period (gotcha #24).
 *
 * This file owns lease/rent, discovery/tour, the owned-asset ledger, and the atomic
 * move. Placement (placement.ts), metrics (homeMetrics.ts) and hosting
 * (housingSocial.ts) are pure/adjacent modules that read this state.
 */
import {
  HOUSING_APPLIED_TXN_KEYS_MAX,
  HOUSING_HISTORY_MAX,
  HOUSING_OWNED_ASSETS_MAX,
  HOUSING_PAYMENTS_MAX,
  HOUSING_SAVE_VERSION,
  OUTFIT_PRESET_IDS,
  type FurnitureAsset,
  type FurnitureDefId,
  type HousingPayment,
  type HousingState,
  type LeaseState,
  type MoveRefusalReason,
  type OutfitPreset,
  type PropertyId,
} from './housingTypes'
import { DEFAULT_PROPERTY_ID, getProperty, getSlot } from './propertyRegistry'
import { getFurnitureDef } from './furnitureCatalog'
import { canMoveAsset, canPlaceAsset, canReplaceAsset, nextRotation, type PlacementCheck } from './placement'
import { computeHomeMetrics } from './homeMetrics'
import { createLease, reconcileRent, settleDebt } from './leaseModel'
import type { FurnitureDef, HomeMetrics } from './housingTypes'
import type { PlayerAppearance } from '../interiors/interiorTypes'

function emptyPresets(): OutfitPreset[] {
  return OUTFIT_PRESET_IDS.map((id, i) => ({ id, name: `Outfit ${i + 1}`, appearance: null }))
}

/** The canonical Starter Studio state a new/reset game lives in (issue §2/§13). */
export function defaultHousingState(startDay = 0): HousingState {
  const starter = getProperty(DEFAULT_PROPERTY_ID)!
  return {
    version: HOUSING_SAVE_VERSION,
    lease: createLease(DEFAULT_PROPERTY_ID, startDay, starter.rentPeriodDays, 0),
    currentPropertyId: DEFAULT_PROPERTY_ID,
    discovered: [DEFAULT_PROPERTY_ID],
    toured: [DEFAULT_PROPERTY_ID],
    history: [{ propertyId: DEFAULT_PROPERTY_ID, movedInDay: Math.trunc(startDay), movedOutDay: null }],
    assets: {},
    placements: {},
    assetSeq: 0,
    moveSeq: 0,
    settleSeq: 0,
    payments: [],
    appliedTxnKeys: [],
    outfitPresets: emptyPresets(),
  }
}

export const housingRuntime: { state: HousingState } = { state: defaultHousingState() }

export function resetHousing(startDay = 0): void {
  housingRuntime.state = defaultHousingState(startDay)
}

// ---- reads ----------------------------------------------------------------

export function getHousingState(): Readonly<HousingState> {
  return housingRuntime.state
}
export function getCurrentPropertyId(): PropertyId {
  return housingRuntime.state.currentPropertyId
}
export function getLease(): LeaseState {
  return housingRuntime.state.lease
}
export function isDiscovered(id: PropertyId): boolean {
  return housingRuntime.state.discovered.includes(id)
}
export function isToured(id: PropertyId): boolean {
  return housingRuntime.state.toured.includes(id)
}
export function getOwnedAssets(): FurnitureAsset[] {
  return Object.values(housingRuntime.state.assets)
}
export function getAsset(assetId: string): FurnitureAsset | undefined {
  return housingRuntime.state.assets[assetId]
}
export function getPlacements(): Readonly<Record<string, string>> {
  return housingRuntime.state.placements
}
export function getPlacedAssetId(slotId: string): string | undefined {
  return housingRuntime.state.placements[slotId]
}
/** The slot an asset is placed in (current home), or undefined if stored. */
export function slotOfAsset(assetId: string): string | undefined {
  const { placements } = housingRuntime.state
  for (const [slotId, aid] of Object.entries(placements)) if (aid === assetId) return slotId
  return undefined
}
/** Owned assets not currently placed in the home (issue §5 "stored"). */
export function getStoredAssetIds(): string[] {
  const placed = new Set(Object.values(housingRuntime.state.placements))
  return Object.keys(housingRuntime.state.assets).filter((id) => !placed.has(id))
}
export function getOutfitPresets(): OutfitPreset[] {
  return housingRuntime.state.outfitPresets
}

/** Save the given look into an outfit preset slot (wardrobe benefit, §8). */
export function saveOutfitPreset(id: string, appearance: PlayerAppearance): boolean {
  const preset = housingRuntime.state.outfitPresets.find((p) => p.id === id)
  if (!preset) return false
  preset.appearance = { ...appearance }
  return true
}

/** Clear an outfit preset slot (never touches owned clothing / saved looks elsewhere). */
export function clearOutfitPreset(id: string): boolean {
  const preset = housingRuntime.state.outfitPresets.find((p) => p.id === id)
  if (!preset) return false
  preset.appearance = null
  return true
}

/** The saved look in a preset slot, if any. */
export function getOutfitPreset(id: string): OutfitPreset | undefined {
  return housingRuntime.state.outfitPresets.find((p) => p.id === id)
}

// ---- exact-once transaction ledger ---------------------------------------

export function hasTxnKey(key: string): boolean {
  return housingRuntime.state.appliedTxnKeys.includes(key)
}

/** Record an applied transaction (bounded payment history + FIFO key ledger). */
function recordTxn(txn: HousingPayment): void {
  const s = housingRuntime.state
  // A duplicate key is a TRUE no-op — it records neither the key AGAIN nor a second
  // payments/history entry (PR#18 review #8). Distinct legitimate actions must supply
  // distinct keys (monotonic assetSeq/moveSeq/settleSeq) to record at all.
  if (s.appliedTxnKeys.includes(txn.key)) return
  s.appliedTxnKeys.push(txn.key)
  if (s.appliedTxnKeys.length > HOUSING_APPLIED_TXN_KEYS_MAX) s.appliedTxnKeys.splice(0, s.appliedTxnKeys.length - HOUSING_APPLIED_TXN_KEYS_MAX)
  s.payments.push(txn)
  if (s.payments.length > HOUSING_PAYMENTS_MAX) s.payments.splice(0, s.payments.length - HOUSING_PAYMENTS_MAX)
}

// ---- rent ----------------------------------------------------------------

/** The applied result of a rent reconcile/settlement: money + messages for the store. */
export interface RentApplyResult {
  moneyDelta: number
  messages: string[]
}

/** Lazily reconcile rent up to `day` and record any charges (issue §3). */
export function reconcileHousingRent(day: number, balance: number): RentApplyResult {
  const s = housingRuntime.state
  const property = getProperty(s.lease.propertyId)
  if (!property) return { moneyDelta: 0, messages: [] }
  const out = reconcileRent(s.lease, property, day, balance, hasTxnKey)
  s.lease = out.lease
  for (const t of out.txns) recordTxn(t)
  return { moneyDelta: out.moneyDelta, messages: out.messages }
}

/** Manually settle rent debt from the current balance (issue §3). */
export function settleHousingDebt(day: number, balance: number): RentApplyResult {
  const s = housingRuntime.state
  const property = getProperty(s.lease.propertyId)
  if (!property) return { moneyDelta: 0, messages: [] }
  s.settleSeq += 1 // each manual settlement is a distinct transaction (review #8)
  const out = settleDebt(s.lease, property, day, balance, s.settleSeq, hasTxnKey)
  s.lease = out.lease
  for (const t of out.txns) recordTxn(t)
  return { moneyDelta: out.moneyDelta, messages: out.messages }
}

// ---- discovery / tour -----------------------------------------------------

export function discoverProperty(id: PropertyId): void {
  const s = housingRuntime.state
  if (getProperty(id) && !s.discovered.includes(id)) s.discovered.push(id)
}

/** Mark a property as toured (discovers it too). Tours never mutate money/assets. */
export function tourProperty(id: PropertyId): void {
  const s = housingRuntime.state
  if (!getProperty(id)) return
  if (!s.discovered.includes(id)) s.discovered.push(id)
  if (!s.toured.includes(id)) s.toured.push(id)
}

// ---- owned furniture assets ----------------------------------------------

/** Mint a unique owned asset for a bought furniture def (starts STORED). */
export function mintFurnitureAsset(defId: FurnitureDefId): FurnitureAsset {
  const s = housingRuntime.state
  s.assetSeq += 1
  const asset: FurnitureAsset = { assetId: `fa_${s.assetSeq}`, defId, rotationY: 0 }
  s.assets[asset.assetId] = asset
  return asset
}

/** Record a furniture purchase transaction, keyed by the COMMERCE purchase receipt so a
 *  replay is exact-once (review #2/#8). Money is charged by the store action after this. */
export function recordFurniturePurchase(receipt: string, price: number, day: number): void {
  recordTxn({ key: `furniture_purchase:${receipt}`, kind: 'furniture_purchase', amount: -price, day: Math.trunc(day) })
}

/** Mark a non-money housing event key as applied (exact-once), e.g. a surfaced
 *  trusted-NPC recommendation (PR#18 review #1). No payment/ledger row is recorded. */
export function recordRecommendation(key: string): void {
  const s = housingRuntime.state
  if (s.appliedTxnKeys.includes(key)) return
  s.appliedTxnKeys.push(key)
  if (s.appliedTxnKeys.length > HOUSING_APPLIED_TXN_KEYS_MAX) s.appliedTxnKeys.splice(0, s.appliedTxnKeys.length - HOUSING_APPLIED_TXN_KEYS_MAX)
}

export function ownedAssetCount(): number {
  return Object.keys(housingRuntime.state.assets).length
}
export function atOwnedAssetCap(): boolean {
  return ownedAssetCount() >= HOUSING_OWNED_ASSETS_MAX
}

// ---- atomic move (issue §2) ----------------------------------------------

export interface MovePlan {
  ok: boolean
  reason?: MoveRefusalReason
  /** Net balance change if the move commits (refund − new deposit − initial rent). */
  moneyDelta: number
  refund: number
  deposit: number
  initialRent: number
}

/**
 * Plan a move to `propertyId` from the current balance (issue §2). PURE — computes
 * the atomic money settlement and refuses unsafe transitions. The store checks
 * eligibility/tour/activity/storage separately and passes the verdicts in.
 */
export function planMove(
  propertyId: PropertyId,
  balance: number,
  gates: { eligible: boolean; toured: boolean; tourRequired: boolean; storageOk: boolean; activityOk: boolean },
): MovePlan {
  const target = getProperty(propertyId)
  const s = housingRuntime.state
  const refund = s.lease.depositHeld
  if (!target) return { ok: false, reason: 'unknown_property', moneyDelta: 0, refund, deposit: 0, initialRent: 0 }
  const deposit = target.deposit
  const initialRent = target.rent
  const moneyDelta = refund - deposit - initialRent
  if (propertyId === s.currentPropertyId) return { ok: false, reason: 'already_here', moneyDelta, refund, deposit, initialRent }
  if (s.lease.debt > 0) return { ok: false, reason: 'rent_debt', moneyDelta, refund, deposit, initialRent }
  if (!gates.eligible) return { ok: false, reason: 'ineligible', moneyDelta, refund, deposit, initialRent }
  if (gates.tourRequired && !gates.toured) return { ok: false, reason: 'not_toured', moneyDelta, refund, deposit, initialRent }
  if (!gates.activityOk) return { ok: false, reason: 'incompatible_activity', moneyDelta, refund, deposit, initialRent }
  if (!gates.storageOk) return { ok: false, reason: 'storage_overflow', moneyDelta, refund, deposit, initialRent }
  if (balance + moneyDelta < 0) return { ok: false, reason: 'insufficient_funds', moneyDelta, refund, deposit, initialRent }
  return { ok: true, moneyDelta, refund, deposit, initialRent }
}

/**
 * Commit a planned move (issue §2). Atomically: refund old deposit, store ALL
 * placed furniture (furniture ownership is preserved — placements clear, assets
 * stay), end the old lease into history, create the new lease with the new deposit
 * held, discover/tour the destination, and switch current residence. Records the
 * exact-once deposit-refund / deposit-charge / initial-rent transactions. Returns
 * the net moneyDelta the store applies to the balance in ONE calc.
 */
export function commitMove(propertyId: PropertyId, day: number): { moneyDelta: number } {
  const s = housingRuntime.state
  const target = getProperty(propertyId)
  if (!target) return { moneyDelta: 0 }
  const today = Math.trunc(day)
  const from = s.currentPropertyId
  const refund = s.lease.depositHeld
  // A legitimate repeated same-day move (e.g. Studio→Loft→Studio→Loft) is a distinct
  // transaction each time — key the money on a monotonic move id, not the day, so ids
  // never collide and recordTxn never merges two real moves (PR#18 review #8).
  s.moveSeq += 1
  const mv = s.moveSeq

  // 1. Pack all placed furniture back into storage (no furniture is ever lost).
  s.placements = {}

  // 2. Close the old lease in history; open the new one.
  const prev = s.history.find((h) => h.propertyId === from && h.movedOutDay === null)
  if (prev) prev.movedOutDay = today
  s.history.push({ propertyId, movedInDay: today, movedOutDay: null })
  if (s.history.length > HOUSING_HISTORY_MAX) s.history.splice(0, s.history.length - HOUSING_HISTORY_MAX)

  // 3. Money: refund old deposit, charge new deposit + initial rent (exact-once).
  if (refund > 0) recordTxn({ key: `deposit_refund:${from}:${mv}`, kind: 'deposit_refund', amount: refund, day: today })
  if (target.deposit > 0) recordTxn({ key: `deposit_charge:${propertyId}:${mv}`, kind: 'deposit_charge', amount: -target.deposit, day: today })
  recordTxn({ key: `initial_rent:${propertyId}:${mv}`, kind: 'initial_rent', amount: -target.rent, day: today })

  // 4. New lease + residence. First period is prepaid, so nextDueDay = today + period.
  s.lease = createLease(propertyId, today, target.rentPeriodDays, target.deposit)
  s.currentPropertyId = propertyId
  if (!s.discovered.includes(propertyId)) s.discovered.push(propertyId)
  if (!s.toured.includes(propertyId)) s.toured.push(propertyId)

  return { moneyDelta: refund - target.deposit - target.rent }
}

// ---- furniture placement mutators (issue §6) ------------------------------

/** Place a stored owned asset into an empty compatible slot of the current home. */
export function placeAsset(slotId: string, assetId: string): PlacementCheck {
  const s = housingRuntime.state
  const check = canPlaceAsset(s.currentPropertyId, slotId, assetId, s.placements, s.assets)
  if (!check.ok) return check
  const slot = getSlot(s.currentPropertyId, slotId)
  s.placements = { ...s.placements, [slotId]: assetId }
  const asset = s.assets[assetId]
  if (asset && slot) asset.rotationY = slot.baseRotationY
  return check
}

/** Cycle the rotation of the asset placed in `slotId` (allowed rotations only). */
export function rotateAsset(slotId: string): boolean {
  const s = housingRuntime.state
  const assetId = s.placements[slotId]
  if (!assetId) return false
  const asset = s.assets[assetId]
  const slot = getSlot(s.currentPropertyId, slotId)
  const def = asset ? getFurnitureDef(asset.defId) : undefined
  if (!asset || !slot || !def) return false
  asset.rotationY = nextRotation(asset.rotationY, slot, def)
  return true
}

/** Move the asset in `fromSlot` to an empty compatible `toSlot`. */
export function moveAsset(fromSlot: string, toSlot: string): PlacementCheck {
  const s = housingRuntime.state
  const check = canMoveAsset(s.currentPropertyId, fromSlot, toSlot, s.placements, s.assets)
  if (!check.ok) return check
  const assetId = s.placements[fromSlot]
  const p: Record<string, string> = { ...s.placements }
  delete p[fromSlot]
  p[toSlot] = assetId
  s.placements = p
  const slot = getSlot(s.currentPropertyId, toSlot)
  const asset = s.assets[assetId]
  if (asset && slot) asset.rotationY = slot.baseRotationY
  return check
}

/** Replace the asset in `slotId` with `newAssetId`; the old one returns to storage. */
export function replaceAsset(slotId: string, newAssetId: string): PlacementCheck {
  const s = housingRuntime.state
  if (!s.placements[slotId]) return placeAsset(slotId, newAssetId)
  const check = canReplaceAsset(s.currentPropertyId, slotId, newAssetId, s.placements, s.assets)
  if (!check.ok) return check
  s.placements = { ...s.placements, [slotId]: newAssetId }
  const slot = getSlot(s.currentPropertyId, slotId)
  const asset = s.assets[newAssetId]
  if (asset && slot) asset.rotationY = slot.baseRotationY
  return check
}

/** Remove the asset from `slotId` back into home storage (never deletes it). */
export function storeAsset(slotId: string): boolean {
  const s = housingRuntime.state
  if (!s.placements[slotId]) return false
  const p: Record<string, string> = { ...s.placements }
  delete p[slotId]
  s.placements = p
  return true
}

// ---- derived metrics + benefits (issue §7/§8) -----------------------------

/** The defs of every piece currently PLACED in the home (for metric derivation). */
export function placedFurnitureDefs(): FurnitureDef[] {
  const s = housingRuntime.state
  const out: FurnitureDef[] = []
  for (const assetId of Object.values(s.placements)) {
    const def = getFurnitureDef(s.assets[assetId]?.defId ?? '')
    if (def) out.push(def)
  }
  return out
}

/** The current home's derived Comfort/Style/Storage/Sleep/Hosting (§7). */
export function getHomeMetrics(): HomeMetrics {
  const property = getProperty(housingRuntime.state.currentPropertyId)
  if (!property) return computeHomeMetrics(getProperty(DEFAULT_PROPERTY_ID)!, [])
  return computeHomeMetrics(property, placedFurnitureDefs())
}

export interface HomeSleepBenefit {
  energyTo: number
  healthRestore: number
  quality: number
}

/**
 * The sleep benefit of the CURRENT home (issue §8, ONE display/execution resolver).
 * Energy always fully restores (the starter stays safe + useful); a better bed's
 * higher sleep quality adds a BOUNDED health top-up (quality 50 → 0, quality 100 →
 * +30), so beds change gameplay without an infinite rest/heal loop.
 */
export function homeSleepBenefit(): HomeSleepBenefit {
  const quality = getHomeMetrics().sleepQuality
  const healthRestore = Math.max(0, Math.round(((quality - 50) / 50) * 30))
  return { energyTo: 100, healthRestore, quality }
}

/** Effective home storage capacity (base + placed storage furniture) — §8. */
export function effectiveStorageCapacity(): number {
  return getHomeMetrics().storageCapacity
}

/** Whether the home currently has a placed wardrobe (gates outfit presets, §8). */
export function hasPlacedWardrobe(): boolean {
  return placedFurnitureDefs().some((d) => d.enablesWardrobe)
}

/** The interior id the current residence uses (current-residence adapter, issue §4). */
export function currentResidenceInteriorId(): string {
  return getProperty(housingRuntime.state.currentPropertyId)?.interiorId ?? 'apartment'
}
