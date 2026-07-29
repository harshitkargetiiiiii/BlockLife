/**
 * Housing save/load + migration (issue #17 §14) — ONE additive, fail-safe slice.
 * Old saves lack `housing` and migrate into a valid Starter Studio lease with a
 * FULL rent period of grace (never charged/penalized on first load). A malformed
 * blob is sanitized field-by-field: unknown property/furniture/slot/asset ids fail
 * safe, duplicate asset ids are deduped without minting extras, invalid placements
 * return the asset to storage (never deleted), and `assetSeq` is kept ahead of any
 * loaded asset id so a reload can never re-mint a colliding id (gotcha #24). No
 * runtime handles are persisted. Load is idempotent (reset semantics via replace).
 */
import { isPlayerAppearance } from '../interiors/interiorTypes'
import {
  HOUSING_APPLIED_TXN_KEYS_MAX,
  HOUSING_HISTORY_MAX,
  HOUSING_OWNED_ASSETS_MAX,
  HOUSING_PAYMENTS_MAX,
  HOUSING_SAVE_VERSION,
  OUTFIT_PRESET_IDS,
  isPropertyId,
  type FurnitureAsset,
  type HousingPayment,
  type HousingSaveData,
  type HousingState,
  type HousingTxnKind,
  type LeaseState,
  type LeaseStatus,
  type OutfitPreset,
  type PropertyHistoryEntry,
  type PropertyId,
} from './housingTypes'
import { getFurnitureDef, isFurnitureDefId } from './furnitureCatalog'
import { getProperty, getSlot, slotAccepts } from './propertyRegistry'
import { defaultHousingState, housingRuntime } from './housingRuntime'

const TXN_KINDS: HousingTxnKind[] = [
  'furniture_purchase',
  'deposit_charge',
  'deposit_refund',
  'initial_rent',
  'recurring_rent',
  'late_fee',
  'debt_settlement',
  'furniture_resale',
]
const LEASE_STATUSES: LeaseStatus[] = ['active', 'rent_due', 'overdue', 'delinquent', 'ended']

const clampInt = (v: unknown, lo: number, hi: number, dflt: number): number =>
  typeof v === 'number' && Number.isFinite(v) ? Math.max(lo, Math.min(hi, Math.trunc(v))) : dflt
const num = (v: unknown, dflt: number): number => (typeof v === 'number' && Number.isFinite(v) ? v : dflt)

/** Serialize the live runtime into the save slice (plain data only). */
export function serializeHousing(): HousingSaveData {
  const s = housingRuntime.state
  return {
    version: HOUSING_SAVE_VERSION,
    lease: { ...s.lease },
    currentPropertyId: s.currentPropertyId,
    discovered: [...s.discovered],
    toured: [...s.toured],
    history: s.history.map((h) => ({ ...h })),
    assets: Object.fromEntries(Object.entries(s.assets).map(([k, v]) => [k, { ...v }])),
    placements: { ...s.placements },
    assetSeq: s.assetSeq,
    moveSeq: s.moveSeq,
    settleSeq: s.settleSeq,
    payments: s.payments.map((p) => ({ ...p })),
    appliedTxnKeys: [...s.appliedTxnKeys],
    outfitPresets: s.outfitPresets.map((o) => ({ ...o, appearance: o.appearance ? { ...o.appearance } : null })),
  }
}

function sanitizeLease(raw: unknown, fallbackProperty: PropertyId, period: number): LeaseState {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>
  const propertyId = isPropertyId(r.propertyId) ? r.propertyId : fallbackProperty
  const startDay = clampInt(r.startDay, 0, 100000000, 0)
  const status = typeof r.status === 'string' && LEASE_STATUSES.includes(r.status as LeaseStatus) ? (r.status as LeaseStatus) : 'active'
  return {
    propertyId,
    startDay,
    nextDueDay: clampInt(r.nextDueDay, 0, 100000000, startDay + period),
    periodSeq: clampInt(r.periodSeq, 0, 100000000, 0),
    depositHeld: clampInt(r.depositHeld, 0, 100000000, 0),
    debt: clampInt(r.debt, 0, 100000000, 0),
    status,
    lateFeePeriod: r.lateFeePeriod === null || r.lateFeePeriod === undefined ? null : clampInt(r.lateFeePeriod, 0, 100000000, 0),
  }
}

function sanitizeAssets(raw: unknown): Record<string, FurnitureAsset> {
  const out: Record<string, FurnitureAsset> = {}
  if (!raw || typeof raw !== 'object') return out
  let count = 0
  for (const [assetId, v] of Object.entries(raw as Record<string, unknown>)) {
    if (count >= HOUSING_OWNED_ASSETS_MAX) break
    if (typeof assetId !== 'string' || assetId.length === 0) continue
    if (!v || typeof v !== 'object') continue
    const a = v as Record<string, unknown>
    // Unknown furniture def id fails safe (the piece is unusable) — dropped, not kept.
    if (!isFurnitureDefId(a.defId)) continue
    // Record keys already dedupe by assetId — a duplicate id can't mint an extra asset.
    out[assetId] = { assetId, defId: a.defId as string, rotationY: num(a.rotationY, 0) }
    count += 1
  }
  return out
}

function sanitizePlacements(raw: unknown, propertyId: PropertyId, assets: Record<string, FurnitureAsset>): Record<string, string> {
  const out: Record<string, string> = {}
  if (!raw || typeof raw !== 'object') return out
  const placedAssets = new Set<string>()
  for (const [slotId, assetId] of Object.entries(raw as Record<string, unknown>)) {
    if (typeof slotId !== 'string' || typeof assetId !== 'string') continue
    // Unknown slot for THIS property, or unknown/unowned asset → drop the placement
    // (the asset stays owned → becomes stored; never deleted).
    const slot = getSlot(propertyId, slotId)
    if (!slot) continue
    const asset = assets[assetId]
    if (!asset) continue
    // An incompatible category/size placement is invalid — recover the asset to storage.
    const def = getFurnitureDef(asset.defId)
    if (!def || !slotAccepts(slot, def.category, def.size)) continue
    // An asset referenced by more than one slot is kept once (issue §14).
    if (placedAssets.has(assetId)) continue
    out[slotId] = assetId
    placedAssets.add(assetId)
  }
  return out
}

function sanitizeHistory(raw: unknown): PropertyHistoryEntry[] {
  if (!Array.isArray(raw)) return []
  const out: PropertyHistoryEntry[] = []
  for (const v of raw) {
    if (!v || typeof v !== 'object') continue
    const h = v as Record<string, unknown>
    if (!isPropertyId(h.propertyId)) continue
    out.push({
      propertyId: h.propertyId,
      movedInDay: clampInt(h.movedInDay, 0, 100000000, 0),
      movedOutDay: h.movedOutDay === null || h.movedOutDay === undefined ? null : clampInt(h.movedOutDay, 0, 100000000, 0),
    })
  }
  return out.slice(-HOUSING_HISTORY_MAX)
}

function sanitizePayments(raw: unknown): HousingPayment[] {
  if (!Array.isArray(raw)) return []
  const out: HousingPayment[] = []
  for (const v of raw) {
    if (!v || typeof v !== 'object') continue
    const p = v as Record<string, unknown>
    if (typeof p.key !== 'string') continue
    if (typeof p.kind !== 'string' || !TXN_KINDS.includes(p.kind as HousingTxnKind)) continue
    out.push({ key: p.key, kind: p.kind as HousingTxnKind, amount: num(p.amount, 0), day: clampInt(p.day, 0, 100000000, 0) })
  }
  return out.slice(-HOUSING_PAYMENTS_MAX)
}

function strList(v: unknown, max: number): string[] {
  if (!Array.isArray(v)) return []
  const out: string[] = []
  for (const x of v) if (typeof x === 'string' && !out.includes(x)) out.push(x)
  return out.slice(-max)
}

function propList(v: unknown): PropertyId[] {
  if (!Array.isArray(v)) return []
  const out: PropertyId[] = []
  for (const x of v) if (isPropertyId(x) && !out.includes(x)) out.push(x)
  return out
}

function sanitizePresets(raw: unknown): OutfitPreset[] {
  const byId: Record<string, OutfitPreset> = {}
  if (Array.isArray(raw)) {
    for (const v of raw) {
      if (!v || typeof v !== 'object') continue
      const o = v as Record<string, unknown>
      if (typeof o.id !== 'string' || !OUTFIT_PRESET_IDS.includes(o.id)) continue
      byId[o.id] = {
        id: o.id,
        name: typeof o.name === 'string' ? o.name.slice(0, 40) : o.id,
        appearance: isPlayerAppearance(o.appearance) ? { ...o.appearance } : null,
      }
    }
  }
  return OUTFIT_PRESET_IDS.map((id, i) => byId[id] ?? { id, name: `Outfit ${i + 1}`, appearance: null })
}

/** Turn arbitrary loaded data into a valid {@link HousingState}. Never throws. */
export function sanitizeHousingSave(raw: unknown, loadDay: number): HousingState {
  if (!raw || typeof raw !== 'object') return defaultHousingState(loadDay)
  const d = raw as HousingSaveData

  // The current residence drives everything else; a malformed id falls back to starter.
  const currentPropertyId: PropertyId = isPropertyId(d.currentPropertyId) ? d.currentPropertyId : 'starter_studio'
  const property = getProperty(currentPropertyId)!
  const lease = sanitizeLease(d.lease, currentPropertyId, property.rentPeriodDays)
  // Keep the lease's property consistent with the current residence (single source).
  lease.propertyId = currentPropertyId

  const assets = sanitizeAssets(d.assets)
  const placements = sanitizePlacements(d.placements, currentPropertyId, assets)

  const discovered = propList(d.discovered)
  if (!discovered.includes('starter_studio')) discovered.push('starter_studio')
  if (!discovered.includes(currentPropertyId)) discovered.push(currentPropertyId)
  const toured = propList(d.toured)
  if (!toured.includes(currentPropertyId)) toured.push(currentPropertyId)

  const history = sanitizeHistory(d.history)
  if (!history.some((h) => h.propertyId === currentPropertyId && h.movedOutDay === null)) {
    history.push({ propertyId: currentPropertyId, movedInDay: lease.startDay, movedOutDay: null })
  }

  // assetSeq kept ahead of the max `fa_<n>` suffix so no future asset id collides.
  let assetSeq = clampInt(d.assetSeq, 0, Number.MAX_SAFE_INTEGER, 0)
  for (const id of Object.keys(assets)) {
    const n = Number(id.replace(/^fa_/, ''))
    if (Number.isFinite(n)) assetSeq = Math.max(assetSeq, n)
  }

  return {
    version: HOUSING_SAVE_VERSION,
    lease,
    currentPropertyId,
    discovered,
    toured,
    history: history.slice(-HOUSING_HISTORY_MAX),
    assets,
    placements,
    assetSeq,
    // Monotonic move/settlement counters carry forward so post-reload transaction ids
    // never collide with pre-reload ones (review #8).
    moveSeq: clampInt(d.moveSeq, 0, Number.MAX_SAFE_INTEGER, 0),
    settleSeq: clampInt(d.settleSeq, 0, Number.MAX_SAFE_INTEGER, 0),
    payments: sanitizePayments(d.payments),
    appliedTxnKeys: strList(d.appliedTxnKeys, HOUSING_APPLIED_TXN_KEYS_MAX),
    outfitPresets: sanitizePresets(d.outfitPresets),
  }
}

/**
 * Load a housing save, or MIGRATE an old apartment save (no `housing` field) into a
 * Starter Studio lease with one full grace period (issue §14). Idempotent. `loadDay`
 * is the save's game day — used so a migrated lease's first rent is a full period out.
 */
export function applyHousingSave(data: HousingSaveData | undefined, loadDay: number): void {
  housingRuntime.state = data ? sanitizeHousingSave(data, loadDay) : defaultHousingState(loadDay)
}
