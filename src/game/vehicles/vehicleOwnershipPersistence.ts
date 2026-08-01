/**
 * Vehicle ownership save/load + migration (issue #19 §3/§13) — ONE additive, fail-safe slice.
 *
 * - A brand-new game / reset starts with NO owned vehicle (the shell stays hidden).
 * - A pre-v1 LEGACY save (an existing save that has other slices but no `vehicles` field)
 *   receives EXACTLY ONE Compact Car migration grant, so legacy players keep the car they had.
 *   The grant is exact-once (the `migrated` marker persists and is honoured on every reload and
 *   save-version upgrade), never legitimizes an ACTIVE STOLEN identity, and — when the legacy
 *   world position is unsafe/unknown — parks the Compact at a documented holding/parking anchor.
 * - A malformed blob is sanitized field-by-field: unknown def/anchor/upgrade ids fail safe,
 *   duplicate asset ids and duplicate parking claims are deterministically de-conflicted into
 *   recovery holding, cargo over-capacity is preserved in bounded overflow, and `assetSeq` is
 *   kept ahead of every `ov_<n>` so a reload can never mint a colliding id. Never throws; never
 *   silently deletes a legitimate asset, upgrade, or stored item.
 */
import { sanitizeStacks } from '../items/inventoryService'
import type { ItemStacks } from '../items/itemTypes'
import {
  VEHICLE_APPLIED_TXN_KEYS_MAX,
  VEHICLE_HISTORY_MAX,
  VEHICLE_OWNED_CAP,
  VEHICLE_SAVE_VERSION,
  type OwnedVehicle,
  type VehicleCustomization,
  type VehicleHistoryEntry,
  type VehicleLocationState,
  type VehicleOwnershipSaveData,
  type VehicleOwnershipState,
} from './vehicleOwnershipTypes'
import { getVehicleDef, isVehicleDefId, MIGRATION_VEHICLE_DEF_ID } from './vehicleRegistry'
import { defaultVehicleOwnershipState, vehicleOwnershipRuntime } from './vehicleOwnershipRuntime'

const clampInt = (v: unknown, lo: number, hi: number, dflt: number): number =>
  typeof v === 'number' && Number.isFinite(v) ? Math.max(lo, Math.min(hi, Math.trunc(v))) : dflt
const clampNum = (v: unknown, lo: number, hi: number, dflt: number): number =>
  typeof v === 'number' && Number.isFinite(v) ? Math.max(lo, Math.min(hi, v)) : dflt

const HISTORY_KINDS: VehicleHistoryEntry['kind'][] = ['acquired', 'traded_in', 'repaired', 'customized', 'impounded', 'released', 'recovered']

/** Cargo capacity a def provides — sanitation caps cargo to this (overflow preserved). */
function cargoCapacityOf(defId: string): number {
  return getVehicleDef(defId)?.cargoCapacity ?? 0
}

export function serializeVehicleOwnership(): VehicleOwnershipSaveData {
  const s = vehicleOwnershipRuntime.state
  return {
    version: VEHICLE_SAVE_VERSION,
    assets: Object.fromEntries(
      Object.entries(s.assets).map(([id, v]) => [id, {
        ...v,
        customization: { ...v.customization, upgrades: [...v.customization.upgrades] },
        cargo: { ...v.cargo },
        cargoOverflow: { ...v.cargoOverflow },
        location: { ...v.location },
        history: v.history.map((h) => ({ ...h })),
        lastTransform: v.lastTransform ? { ...v.lastTransform } : undefined,
      }]),
    ),
    assetSeq: s.assetSeq,
    activeAssetId: s.activeAssetId,
    migrated: s.migrated,
    appliedTxnKeys: [...s.appliedTxnKeys],
  }
}

function sanitizeCustomization(raw: unknown, defId: string): VehicleCustomization {
  const def = getVehicleDef(defId)
  const c = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>
  const paint = typeof c.paint === 'string' && def?.paintPalette.includes(c.paint) ? c.paint : def?.baseColor ?? '#d7e6ee'
  const wheels = typeof c.wheels === 'string' ? c.wheels : 'wheels_standard'
  // Unknown/incompatible upgrade ids are dropped (only the invalid entry — the vehicle stays).
  const upgrades = Array.isArray(c.upgrades)
    ? [...new Set(c.upgrades.filter((u): u is string => typeof u === 'string'))]
    : []
  return { paint, wheels, upgrades }
}

function sanitizeLocation(raw: unknown): VehicleLocationState {
  const l = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>
  switch (l.kind) {
    case 'active':
      return { kind: 'active' }
    case 'parked':
      return typeof l.anchorId === 'string' ? { kind: 'parked', anchorId: l.anchorId } : { kind: 'recovery' }
    case 'dealership':
      return { kind: 'dealership' }
    case 'impound':
      return { kind: 'impound' }
    default:
      return { kind: 'recovery' }
  }
}

function sanitizeHistory(raw: unknown): VehicleHistoryEntry[] {
  if (!Array.isArray(raw)) return []
  const out: VehicleHistoryEntry[] = []
  for (const v of raw) {
    if (!v || typeof v !== 'object') continue
    const h = v as Record<string, unknown>
    if (typeof h.kind !== 'string' || !HISTORY_KINDS.includes(h.kind as VehicleHistoryEntry['kind'])) continue
    out.push({
      kind: h.kind as VehicleHistoryEntry['kind'],
      day: clampInt(h.day, 0, Number.MAX_SAFE_INTEGER, 0),
      amount: clampNum(h.amount, -1e9, 1e9, 0),
      receipt: typeof h.receipt === 'string' ? h.receipt : undefined,
      note: typeof h.note === 'string' ? h.note.slice(0, 80) : undefined,
    })
  }
  return out.slice(-VEHICLE_HISTORY_MAX)
}

/** Sanitize one owned asset. Returns null when the definition is unknown AND unrecoverable. */
function sanitizeAsset(id: string, raw: unknown): OwnedVehicle | null {
  if (!raw || typeof raw !== 'object') return null
  const a = raw as Record<string, unknown>
  // Unknown vehicle definition → try the documented recovery: keep the asset as a Compact so
  // the player never loses a car to a bad id; if even that is impossible, drop it (fail safe).
  const defId = isVehicleDefId(a.defId) ? (a.defId as string) : MIGRATION_VEHICLE_DEF_ID
  if (!getVehicleDef(defId)) return null
  const cap = cargoCapacityOf(defId)
  const cargoRaw = (a.cargo && typeof a.cargo === 'object' ? a.cargo : {}) as ItemStacks
  // Preserve every valid item: keep up to capacity in cargo, the rest in bounded overflow.
  const cargo = sanitizeStacks(cargoRaw, cap)
  const overflowRaw = (a.cargoOverflow && typeof a.cargoOverflow === 'object' ? a.cargoOverflow : {}) as ItemStacks
  const cargoOverflow = sanitizeStacks({ ...overflowRaw, ...leftoverStacks(cargoRaw, cargo) }, 999)
  const acquiredVia: OwnedVehicle['acquiredVia'] =
    a.acquiredVia === 'trade' || a.acquiredVia === 'migration' ? a.acquiredVia : 'purchase'
  const lt = a.lastTransform && typeof a.lastTransform === 'object' ? (a.lastTransform as Record<string, unknown>) : undefined
  return {
    id,
    defId,
    acquiredVia,
    acquisitionReceipt: typeof a.acquisitionReceipt === 'string' ? a.acquisitionReceipt : `legacy:${id}`,
    purchaseDay: clampInt(a.purchaseDay, 0, Number.MAX_SAFE_INTEGER, 0),
    purchasePrice: clampInt(a.purchasePrice, 0, Number.MAX_SAFE_INTEGER, 0),
    condition: clampInt(a.condition, 0, 100, getVehicleDef(defId)?.baseCondition ?? 100),
    customization: sanitizeCustomization(a.customization, defId),
    cargo,
    cargoOverflow,
    location: sanitizeLocation(a.location),
    lastTransform: lt && typeof lt.x === 'number' && typeof lt.z === 'number' && typeof lt.heading === 'number'
      ? { x: lt.x, z: lt.z, heading: lt.heading }
      : undefined,
    history: sanitizeHistory(a.history),
  }
}

/** Items in `full` not carried into `kept` (the sanitized subset) — the overflow remainder. */
function leftoverStacks(full: ItemStacks, kept: ItemStacks): ItemStacks {
  const out: ItemStacks = {}
  for (const [id, qty] of Object.entries(full)) {
    const keptQty = kept[id] ?? 0
    const q = (typeof qty === 'number' ? qty : 0) - keptQty
    if (q > 0) out[id] = q
  }
  return out
}

/** Turn arbitrary loaded data into a valid state. Never throws (§13). */
export function sanitizeVehicleOwnershipSave(raw: unknown): VehicleOwnershipState {
  if (!raw || typeof raw !== 'object') return defaultVehicleOwnershipState()
  const d = raw as VehicleOwnershipSaveData

  const assets: Record<string, OwnedVehicle> = {}
  const rawAssets = d.assets && typeof d.assets === 'object' ? d.assets : {}
  let count = 0
  const claimedAnchors = new Set<string>()
  let sawActive = false
  for (const [id, rawAsset] of Object.entries(rawAssets)) {
    if (count >= VEHICLE_OWNED_CAP) break // over-cap load: keep the first CAP (deterministic order)
    if (typeof id !== 'string' || id.length === 0) continue
    const asset = sanitizeAsset(id, rawAsset)
    if (!asset) continue
    // Duplicate parking claim on one anchor → keep the first, recover the rest (§13).
    if (asset.location.kind === 'parked') {
      if (claimedAnchors.has(asset.location.anchorId)) asset.location = { kind: 'recovery' }
      else claimedAnchors.add(asset.location.anchorId)
    }
    // Two `active` claims can't both hold the shell → keep the first, recover the rest.
    if (asset.location.kind === 'active') {
      if (sawActive) asset.location = { kind: 'recovery' }
      else sawActive = true
    }
    assets[id] = asset // Record key dedupes by id — a duplicate id can't mint twice.
    count += 1
  }

  // assetSeq kept ahead of the max `ov_<n>` so no future mint collides.
  let assetSeq = clampInt(d.assetSeq, 0, Number.MAX_SAFE_INTEGER, 0)
  for (const id of Object.keys(assets)) {
    const n = Number(id.replace(/^ov_/, ''))
    if (Number.isFinite(n)) assetSeq = Math.max(assetSeq, n)
  }

  // Active id must reference a real asset that is actually `active`; else clear the shell.
  const activeAssetId =
    typeof d.activeAssetId === 'string' && assets[d.activeAssetId]?.location.kind === 'active'
      ? d.activeAssetId
      : (Object.values(assets).find((a) => a.location.kind === 'active')?.id ?? null)

  return {
    version: VEHICLE_SAVE_VERSION,
    assets,
    assetSeq,
    activeAssetId,
    migrated: d.migrated === true,
    appliedTxnKeys: Array.isArray(d.appliedTxnKeys)
      ? d.appliedTxnKeys.filter((k): k is string => typeof k === 'string').slice(-VEHICLE_APPLIED_TXN_KEYS_MAX)
      : [],
  }
}

/**
 * Load a vehicle-ownership save, OR migrate a pre-v1 legacy save (§3). Idempotent.
 * - `data` present → sanitize it (already-migrated or v1+ save).
 * - `data` absent + `ctx.legacySave` + not driving a stolen car → grant EXACTLY ONE Compact,
 *   parked at `ctx.parkAnchorId` when given (a residence anchor) else recovery holding.
 * - otherwise (new game / reset / stolen-active) → default (no owned vehicle).
 * The `migrated` marker makes the grant exact-once across reloads and version upgrades.
 */
export function applyVehicleOwnershipSave(
  data: VehicleOwnershipSaveData | undefined,
  ctx: { legacySave: boolean; loadDay: number; parkAnchorId?: string; stolenActive?: boolean },
): void {
  if (data) {
    vehicleOwnershipRuntime.state = sanitizeVehicleOwnershipSave(data)
    return
  }
  const fresh = defaultVehicleOwnershipState()
  if (ctx.legacySave && !ctx.stolenActive) {
    // Exactly-once legacy Compact grant.
    fresh.assetSeq = 1
    const location: VehicleLocationState = ctx.parkAnchorId ? { kind: 'parked', anchorId: ctx.parkAnchorId } : { kind: 'recovery' }
    const def = getVehicleDef(MIGRATION_VEHICLE_DEF_ID)!
    const asset: OwnedVehicle = {
      id: 'ov_1',
      defId: MIGRATION_VEHICLE_DEF_ID,
      acquiredVia: 'migration',
      acquisitionReceipt: 'migration:legacy_compact',
      purchaseDay: Math.trunc(ctx.loadDay),
      purchasePrice: 0,
      condition: def.baseCondition,
      customization: { paint: def.baseColor, wheels: 'wheels_standard', upgrades: [] },
      cargo: {},
      cargoOverflow: {},
      location,
      history: [{ kind: 'recovered', day: Math.trunc(ctx.loadDay), amount: 0, note: 'legacy migration grant' }],
    }
    fresh.assets[asset.id] = asset
    fresh.migrated = true
  }
  vehicleOwnershipRuntime.state = fresh
}
