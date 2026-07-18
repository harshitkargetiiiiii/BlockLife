import type {
  ActiveRobbery,
  ActivityEventType,
  LootReceipt,
  RobberyResult,
  SecureReceipt,
  StoreRuntimeState,
} from './activityTypes'
import { ROBBERY_DEFINITIONS, getRobberyDefinition } from './activityDefinitions'
import { freshContainment, resetContainment, type ContainmentState } from './containmentLogic'
import type { Vec2 } from '../world/worldTypes'

/**
 * Criminal-activity runtime — a module singleton (same pattern as the crime /
 * wanted / mission runtimes). It owns the DURABLE robbery state that must
 * survive interior/sector streaming and never trigger React re-renders: the one
 * active robbery, per-store cooldown/history, unsecured criminal proceeds, and
 * idempotent receipts. Ids, scalars and small records only — never a mesh, body
 * or React node. A bounded projection is mirrored into zustand by the director.
 */

function freshStore(storeId: string): StoreRuntimeState {
  return {
    storeId,
    cooldownReadyAtGameHours: -Infinity,
    robberyCount: 0,
    registerEmptied: false,
  }
}

function initialStores(): Record<string, StoreRuntimeState> {
  const out: Record<string, StoreRuntimeState> = {}
  for (const def of ROBBERY_DEFINITIONS) out[def.id] = freshStore(def.id)
  return out
}

export const activityRuntime = {
  /** The single in-flight robbery, or null. */
  active: null as ActiveRobbery | null,
  /** Per-store cooldown + history (persisted subset). */
  stores: initialStores() as Record<string, StoreRuntimeState>,
  /** Criminal cash taken but not yet secured — NOT spendable money. */
  unsecuredProceeds: 0,
  /** One receipt per attempt: the register pays exactly once. */
  lootReceipts: {} as Record<string, LootReceipt>,
  /** One receipt per secure op: proceeds convert exactly once. */
  secureReceipts: {} as Record<string, SecureReceipt>,
  /** Police containment phase machine around a robbed store (transient). */
  containment: freshContainment() as ContainmentState,
  /** Last terminal robbery result, for the HUD banner (transient). */
  result: null as RobberyResult | null,
  /** Monotonic sequences. */
  eventSeq: 0,
  attemptSeq: 0,
  secureSeq: 0,
  resultSeq: 0,
  /** Diagnostics. */
  lastEventType: null as ActivityEventType | null,
  debugEnabled: false,
}

/**
 * The position the police should CONTAIN while a robbery is under exterior
 * containment (the robbed store's entrance), or null when not containing. The
 * police director reads this to route/hold at the door instead of the off-grid
 * interior — reusing the whole dispatch/dismount stack, never a new one.
 */
export function getContainmentTarget(): Vec2 | null {
  const c = activityRuntime.containment
  if (c.phase === 'none' || c.storeId === null) return null
  const def = getRobberyDefinition(c.storeId)
  return def ? def.entrancePosition : null
}

export function getStoreState(storeId: string): StoreRuntimeState {
  let s = activityRuntime.stores[storeId]
  if (!s) {
    s = freshStore(storeId)
    activityRuntime.stores[storeId] = s
  }
  return s
}

export function nextRobberyAttemptId(activityId: string): string {
  activityRuntime.attemptSeq += 1
  return `${activityId}#${activityRuntime.attemptSeq}`
}

export function nextSecureId(): string {
  activityRuntime.secureSeq += 1
  return `secure#${activityRuntime.secureSeq}`
}

/** Full reset — resetGame + dev/test API. */
export function resetActivityRuntime(): void {
  activityRuntime.active = null
  activityRuntime.stores = initialStores()
  activityRuntime.unsecuredProceeds = 0
  activityRuntime.lootReceipts = {}
  activityRuntime.secureReceipts = {}
  resetContainment(activityRuntime.containment)
  activityRuntime.result = null
  activityRuntime.eventSeq = 0
  activityRuntime.attemptSeq = 0
  activityRuntime.secureSeq = 0
  activityRuntime.resultSeq = 0
  activityRuntime.lastEventType = null
  // debugEnabled intentionally preserved across resets (dev convenience).
}

/**
 * Clear only TRANSIENT robbery state (active attempt + banner). Keeps
 * per-store cooldowns/history, receipts and — deliberately — drops unsecured
 * proceeds (they never persist and never survive a load). Used on load.
 */
export function clearTransientActivity(): void {
  activityRuntime.active = null
  activityRuntime.result = null
  activityRuntime.unsecuredProceeds = 0
  resetContainment(activityRuntime.containment)
}
