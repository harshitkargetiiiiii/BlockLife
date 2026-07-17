import type {
  MissionCooldownRecord,
  MissionHistoryRecord,
  MissionObjectiveRuntime,
  MissionVariableValue,
} from './missionTypes'
import { missionRuntime } from './missionRuntime'
import { getMissionDefinition } from './missionDefinitions'

/**
 * Mission save/load — a deliberate v1 policy (safety over persistence):
 *
 * PERSISTENT: completed mission records, completion counts, cooldown expiry,
 * discovered missions, and an active LAWFUL (safe) mission's progress.
 * NOT PERSISTED: an active criminal (Hot Cargo) attempt once a target is
 * assigned, any wanted/police/combat state (already transient), and rendered
 * markers (reconstructed from anchors on load).
 *
 * The whole payload is an ADDITIVE, optional, validated save field — old saves
 * simply lack it and load with empty history. An invalid saved attempt fails
 * safe (dropped, nothing compensated).
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
  active?: ActiveMissionSave
}

export function serializeMissions(): MissionSaveData {
  const data: MissionSaveData = {
    version: MISSION_SAVE_VERSION,
    history: Object.values(missionRuntime.history),
    cooldowns: Object.values(missionRuntime.cooldowns),
    discovered: [...missionRuntime.discovered],
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

export function isValidMissionSave(value: unknown): value is MissionSaveData {
  if (typeof value !== 'object' || value === null) return false
  const v = value as Record<string, unknown>
  if (v.version !== MISSION_SAVE_VERSION) return false
  if (!Array.isArray(v.history) || !Array.isArray(v.cooldowns) || !Array.isArray(v.discovered)) {
    return false
  }
  if (!v.discovered.every((d) => typeof d === 'string')) return false
  return true
}

/**
 * Restore persistent mission state. Clears any in-flight attempt first (a load
 * never carries a chase). An active lawful mission is reconstructed only when
 * its definition still exists at the saved version and every referenced id
 * resolves; otherwise it is dropped (fail safe). Never grants a reward.
 */
export function applyMissionSave(data: MissionSaveData | undefined): void {
  missionRuntime.active = null
  missionRuntime.result = null
  missionRuntime.lastFailureReason = null
  missionRuntime.history = {}
  missionRuntime.cooldowns = {}
  missionRuntime.discovered = new Set<string>()
  if (!data) return

  for (const h of data.history) {
    if (h && typeof h.missionId === 'string') missionRuntime.history[h.missionId] = h
  }
  for (const c of data.cooldowns) {
    if (c && typeof c.missionId === 'string' && Number.isFinite(c.readyAtGameHours)) {
      missionRuntime.cooldowns[c.missionId] = c
    }
  }
  for (const d of data.discovered) missionRuntime.discovered.add(d)
  // Keep attemptSeq ahead of any restored attempt so a new attempt id is unique.
  const restoredSeq = Math.max(
    0,
    ...data.discovered.map(() => 0),
    ...(data.active ? [attemptSeqOf(data.active.attemptId)] : [0]),
  )
  missionRuntime.attemptSeq = Math.max(missionRuntime.attemptSeq, restoredSeq)

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
    attemptId: a.attemptId,
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

/** Parse the trailing `#<n>` of an attempt id (best-effort). */
function attemptSeqOf(attemptId: string): number {
  const n = Number.parseInt(attemptId.split('#')[1] ?? '', 10)
  return Number.isFinite(n) ? n : 0
}
