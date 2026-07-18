import type { SecureReceipt, StoreRuntimeState } from './activityTypes'
import { activityRuntime, getStoreState } from './activityRuntime'

/**
 * Criminal-activity save/load — v1 policy (safety over persistence):
 *
 * PERSISTENT: per-store cooldown expiry, robbery counts, register-emptied
 * (recovery) flags, and secure-op receipts (so history/analytics survive).
 * NOT PERSISTED: any active robbery, cashier panic, alarm timer, or UNSECURED
 * proceeds — those never survive a load (you can't bank a heist by saving).
 *
 * Additive + optional + validated: old saves lack the field and load with fresh
 * stores. A malformed record is dropped, fail-safe.
 */

export const ACTIVITY_SAVE_VERSION = 1

export interface StoreSave {
  storeId: string
  cooldownReadyAtGameHours: number
  robberyCount: number
  registerEmptied: boolean
}

export interface ActivitySaveData {
  version: number
  stores: StoreSave[]
  secureReceipts: SecureReceipt[]
  secureSeq: number
  attemptSeq: number
}

export function serializeActivities(): ActivitySaveData {
  return {
    version: ACTIVITY_SAVE_VERSION,
    stores: Object.values(activityRuntime.stores).map((s) => ({
      storeId: s.storeId,
      // -Infinity is not JSON-representable — persist "no cooldown" as a finite
      // sentinel well in the past.
      cooldownReadyAtGameHours: Number.isFinite(s.cooldownReadyAtGameHours)
        ? s.cooldownReadyAtGameHours
        : -1,
      robberyCount: s.robberyCount,
      registerEmptied: s.registerEmptied,
    })),
    secureReceipts: Object.values(activityRuntime.secureReceipts),
    secureSeq: activityRuntime.secureSeq,
    attemptSeq: activityRuntime.attemptSeq,
  }
}

function isFiniteNum(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v)
}

function isValidStore(v: unknown): v is StoreSave {
  if (typeof v !== 'object' || v === null) return false
  const s = v as Record<string, unknown>
  return (
    typeof s.storeId === 'string' &&
    isFiniteNum(s.cooldownReadyAtGameHours) &&
    isFiniteNum(s.robberyCount) &&
    s.robberyCount >= 0 &&
    typeof s.registerEmptied === 'boolean'
  )
}

function isValidSecureReceipt(v: unknown): v is SecureReceipt {
  if (typeof v !== 'object' || v === null) return false
  const r = v as Record<string, unknown>
  return typeof r.secureId === 'string' && isFiniteNum(r.amount) && isFiniteNum(r.atGameHours)
}

export function isValidActivitySave(value: unknown): value is ActivitySaveData {
  if (typeof value !== 'object' || value === null) return false
  const v = value as Record<string, unknown>
  if (v.version !== ACTIVITY_SAVE_VERSION) return false
  if (!Array.isArray(v.stores) || !v.stores.every(isValidStore)) return false
  if (v.secureReceipts !== undefined) {
    if (!Array.isArray(v.secureReceipts) || !v.secureReceipts.every(isValidSecureReceipt)) return false
  }
  if (v.secureSeq !== undefined && !(isFiniteNum(v.secureSeq) && v.secureSeq >= 0)) return false
  if (v.attemptSeq !== undefined && !(isFiniteNum(v.attemptSeq) && v.attemptSeq >= 0)) return false
  return true
}

function secureSeqOf(secureId: string): number {
  const n = Number.parseInt(secureId.split('#')[1] ?? '', 10)
  return Number.isFinite(n) ? n : 0
}

/**
 * Restore persistent store state. Clears transient robbery + unsecured proceeds
 * first (a load never carries a heist). Never grants money.
 */
export function applyActivitySave(data: ActivitySaveData | undefined): void {
  // Reset transient + per-store to fresh, then layer the save on top.
  activityRuntime.active = null
  activityRuntime.result = null
  activityRuntime.unsecuredProceeds = 0
  activityRuntime.secureReceipts = {}
  for (const s of Object.values(activityRuntime.stores)) {
    s.cooldownReadyAtGameHours = -Infinity
    s.robberyCount = 0
    s.registerEmptied = false
  }
  if (!data) return

  for (const s of data.stores) {
    if (!isValidStore(s)) continue
    const store: StoreRuntimeState = getStoreState(s.storeId)
    store.cooldownReadyAtGameHours = s.cooldownReadyAtGameHours
    store.robberyCount = s.robberyCount
    store.registerEmptied = s.registerEmptied
  }
  let maxSecureSeq = 0
  for (const r of data.secureReceipts ?? []) {
    if (!isValidSecureReceipt(r)) continue
    activityRuntime.secureReceipts[r.secureId] = r
    maxSecureSeq = Math.max(maxSecureSeq, secureSeqOf(r.secureId))
  }
  // Keep monotonic counters ahead of anything ever issued.
  activityRuntime.secureSeq = Math.max(
    activityRuntime.secureSeq,
    isFiniteNum(data.secureSeq) ? data.secureSeq : 0,
    maxSecureSeq,
  )
  activityRuntime.attemptSeq = Math.max(
    activityRuntime.attemptSeq,
    isFiniteNum(data.attemptSeq) ? data.attemptSeq : 0,
  )
}
