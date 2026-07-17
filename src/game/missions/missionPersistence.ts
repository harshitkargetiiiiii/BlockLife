import type {
  MissionCompletionReceipt,
  MissionCooldownRecord,
  MissionHistoryRecord,
  MissionObjectiveRuntime,
  MissionVariableValue,
} from './missionTypes'
import { missionRuntime, nextAttemptId } from './missionRuntime'
import { getMissionDefinition } from './missionDefinitions'

/**
 * Mission save/load — a deliberate v1 policy (safety over persistence):
 *
 * PERSISTENT: completed mission records, completion counts, cooldown expiry,
 * discovered missions, REWARD RECEIPTS, the monotonic attempt counter, and an
 * active LAWFUL (safe) mission's progress.
 * NOT PERSISTED: an active criminal (Hot Cargo) attempt once a target is
 * assigned, any wanted/police/combat state (already transient), and rendered
 * markers (reconstructed from anchors on load).
 *
 * The whole payload is an ADDITIVE, optional, validated save field — old saves
 * simply lack it and load with empty history. Every nested field is validated;
 * a malformed record is dropped (fail safe, never compensated).
 *
 * Reward integrity across reloads rests on two persisted facts:
 *   1. `receipts` — a completed attempt's receipt survives the reload, so the
 *      SAME attempt can never be paid twice.
 *   2. `attemptSeq` — the attempt counter is monotonic across sessions, and a
 *      restored active mission is RE-MINTED a fresh attempt id. So reloading a
 *      pre-completion save and finishing again is a DISTINCT attempt (new id),
 *      and every completion is still paid exactly once — save-scumming a reward
 *      is impossible.
 */

export const MISSION_SAVE_VERSION = 1

export interface ActiveMissionSave {
  missionId: string
  missionVersion: number
  attemptId: string
  objectiveIndex: number
  objectiveStates: MissionObjectiveRuntime[]
  variables: Record<string, MissionVariableValue>
  ownedEntityIds: string[]
  startedAtGameTime: number
}

export interface MissionSaveData {
  version: number
  history: MissionHistoryRecord[]
  cooldowns: MissionCooldownRecord[]
  discovered: string[]
  /** One receipt per paid attempt — persisted so a reload can't re-pay. */
  receipts: MissionCompletionReceipt[]
  /** Monotonic attempt counter — persisted so attempt ids never repeat. */
  attemptSeq: number
  active?: ActiveMissionSave
}

export function serializeMissions(): MissionSaveData {
  const data: MissionSaveData = {
    version: MISSION_SAVE_VERSION,
    history: Object.values(missionRuntime.history),
    cooldowns: Object.values(missionRuntime.cooldowns),
    discovered: [...missionRuntime.discovered],
    receipts: Object.values(missionRuntime.receipts),
    attemptSeq: missionRuntime.attemptSeq,
  }
  const active = missionRuntime.active
  if (active) {
    const def = getMissionDefinition(active.missionId)
    // Only persist an active mission that is SAFE to resume (lawful; not a
    // save-blocking criminal job). Criminal attempts are dropped on save.
    if (def && !def.blockSaveWhenActive) {
      data.active = {
        missionId: active.missionId,
        missionVersion: active.missionVersion,
        attemptId: active.attemptId,
        objectiveIndex: active.objectiveIndex,
        objectiveStates: Object.values(active.objectiveStates),
        variables: { ...active.variables },
        ownedEntityIds: [...active.ownedEntityIds],
        startedAtGameTime: active.startedAtGameTime,
      }
    }
  }
  return data
}

// ---- Rigorous nested validation ------------------------------------------

function isStr(v: unknown): v is string {
  return typeof v === 'string'
}
function isFiniteNum(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v)
}

function isValidHistory(v: unknown): v is MissionHistoryRecord {
  if (typeof v !== 'object' || v === null) return false
  const h = v as Record<string, unknown>
  return (
    isStr(h.missionId) &&
    isFiniteNum(h.completions) &&
    h.completions >= 0 &&
    isFiniteNum(h.totalEarned) &&
    (h.lastCompletedGameHours === undefined ||
      typeof h.lastCompletedGameHours === 'number') && // -Infinity allowed
    (h.bestObjectiveSeconds === undefined || isFiniteNum(h.bestObjectiveSeconds))
  )
}

function isValidCooldown(v: unknown): v is MissionCooldownRecord {
  if (typeof v !== 'object' || v === null) return false
  const c = v as Record<string, unknown>
  return isStr(c.missionId) && isFiniteNum(c.readyAtGameHours)
}

function isValidReceipt(v: unknown): v is MissionCompletionReceipt {
  if (typeof v !== 'object' || v === null) return false
  const r = v as Record<string, unknown>
  return isStr(r.attemptId) && isStr(r.missionId) && isFiniteNum(r.grantedAtGameHours)
}

function isValidVariableValue(v: unknown): v is MissionVariableValue {
  return typeof v === 'string' || typeof v === 'boolean' || isFiniteNum(v)
}

function isValidObjectiveState(v: unknown): v is MissionObjectiveRuntime {
  if (typeof v !== 'object' || v === null) return false
  const o = v as Record<string, unknown>
  return (
    isStr(o.id) &&
    (o.phase === 'pending' || o.phase === 'active' || o.phase === 'complete') &&
    isFiniteNum(o.progress)
  )
}

function isValidActiveSave(v: unknown): v is ActiveMissionSave {
  if (typeof v !== 'object' || v === null) return false
  const a = v as Record<string, unknown>
  if (!isStr(a.missionId) || !isFiniteNum(a.missionVersion) || !isStr(a.attemptId)) return false
  if (!isFiniteNum(a.objectiveIndex) || !isFiniteNum(a.startedAtGameTime)) return false
  if (!Array.isArray(a.objectiveStates) || !a.objectiveStates.every(isValidObjectiveState)) {
    return false
  }
  if (!Array.isArray(a.ownedEntityIds) || !a.ownedEntityIds.every(isStr)) return false
  if (typeof a.variables !== 'object' || a.variables === null) return false
  return Object.values(a.variables as Record<string, unknown>).every(isValidVariableValue)
}

export function isValidMissionSave(value: unknown): value is MissionSaveData {
  if (typeof value !== 'object' || value === null) return false
  const v = value as Record<string, unknown>
  if (v.version !== MISSION_SAVE_VERSION) return false
  if (!Array.isArray(v.history) || !v.history.every(isValidHistory)) return false
  if (!Array.isArray(v.cooldowns) || !v.cooldowns.every(isValidCooldown)) return false
  if (!Array.isArray(v.discovered) || !v.discovered.every(isStr)) return false
  // Optional (old-save compatible): receipts + attemptSeq were added later.
  if (v.receipts !== undefined && (!Array.isArray(v.receipts) || !v.receipts.every(isValidReceipt))) {
    return false
  }
  if (v.attemptSeq !== undefined && !(isFiniteNum(v.attemptSeq) && v.attemptSeq >= 0)) return false
  if (v.active !== undefined && !isValidActiveSave(v.active)) return false
  return true
}

/** Parse the trailing `#<n>` of an attempt id (best-effort). */
function attemptSeqOf(attemptId: string): number {
  const n = Number.parseInt(attemptId.split('#')[1] ?? '', 10)
  return Number.isFinite(n) ? n : 0
}

/**
 * Restore persistent mission state. Clears any in-flight attempt first (a load
 * never carries a chase). Receipts and the attempt counter are restored so a
 * reload can neither duplicate a reward nor reuse an attempt id. An active
 * lawful mission is reconstructed only when its definition still exists at the
 * saved version and every referenced id resolves; otherwise it is dropped (fail
 * safe). The restored attempt is RE-MINTED a fresh id. Never grants a reward.
 */
export function applyMissionSave(data: MissionSaveData | undefined): void {
  missionRuntime.active = null
  missionRuntime.result = null
  missionRuntime.lastFailureReason = null
  missionRuntime.history = {}
  missionRuntime.cooldowns = {}
  missionRuntime.receipts = {}
  missionRuntime.discovered = new Set<string>()
  if (!data) return

  for (const h of data.history) {
    if (isValidHistory(h)) missionRuntime.history[h.missionId] = h
  }
  for (const c of data.cooldowns) {
    if (isValidCooldown(c)) missionRuntime.cooldowns[c.missionId] = c
  }
  for (const d of data.discovered) if (isStr(d)) missionRuntime.discovered.add(d)
  for (const r of data.receipts ?? []) {
    if (isValidReceipt(r)) missionRuntime.receipts[r.attemptId] = r
  }

  // Keep attemptSeq monotonic and AHEAD of everything ever issued: the saved
  // counter, any receipt's attempt number, and any restored active attempt.
  const receiptSeqMax = Object.keys(missionRuntime.receipts).reduce(
    (m, id) => Math.max(m, attemptSeqOf(id)),
    0,
  )
  missionRuntime.attemptSeq = Math.max(
    missionRuntime.attemptSeq,
    Number.isFinite(data.attemptSeq) ? data.attemptSeq : 0,
    receiptSeqMax,
    data.active ? attemptSeqOf(data.active.attemptId) : 0,
  )

  const a = data.active
  if (!a) return
  const def = getMissionDefinition(a.missionId)
  if (!def || def.version !== a.missionVersion || def.blockSaveWhenActive) return // fail safe
  // Every objective id must still exist in the definition.
  const objIds = new Set(def.objectives.map((o) => o.id))
  if (!a.objectiveStates.every((s) => objIds.has(s.id))) return
  if (a.objectiveIndex < 0 || a.objectiveIndex >= def.objectives.length) return

  missionRuntime.active = {
    missionId: a.missionId,
    missionVersion: a.missionVersion,
    // RE-MINT: a reloaded attempt is a fresh, never-before-used id, so its
    // eventual completion cannot collide with a prior completion's receipt.
    attemptId: nextAttemptId(a.missionId),
    status: 'active',
    objectiveIndex: a.objectiveIndex,
    objectiveStates: Object.fromEntries(a.objectiveStates.map((s) => [s.id, s])),
    variables: { ...a.variables },
    ownedEntityIds: new Set(a.ownedEntityIds),
    activeMarkerIds: new Set<string>(), // markers rebuilt by the live driver
    startedAtGameTime: a.startedAtGameTime,
    lastEventSeq: missionRuntime.eventSeq,
  }
}
