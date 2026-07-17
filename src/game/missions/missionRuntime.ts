import type {
  ActiveMissionRuntime,
  MissionCompletionReceipt,
  MissionCooldownRecord,
  MissionEventType,
  MissionHistoryRecord,
  MissionResult,
} from './missionTypes'

/**
 * Global mission runtime — a module singleton (same pattern as the traffic /
 * crime / police runtimes). It owns the DURABLE mission state that must survive
 * sector streaming and never trigger React re-renders: the one active attempt,
 * completion history, cooldowns, reward receipts, and event bookkeeping. It
 * holds ids, scalars and small records only — never a mesh, body, or React
 * node. UI-reactive projections (title, objective text, banners, phone lists)
 * are mirrored into the zustand store by the live driver at a bounded cadence.
 */
export const missionRuntime = {
  /** The single in-flight attempt, or null. v1 allows one active mission. */
  active: null as ActiveMissionRuntime | null,
  /** Per-mission completion history (persisted). */
  history: {} as Record<string, MissionHistoryRecord>,
  /** Per-mission cooldown records (persisted). */
  cooldowns: {} as Record<string, MissionCooldownRecord>,
  /** One receipt per completed attempt — reward can never be granted twice. */
  receipts: {} as Record<string, MissionCompletionReceipt>,
  /** Discovered mission ids (e.g. the fixer's Hot Cargo, unlocked by visiting). */
  discovered: new Set<string>(),
  /** Last terminal result, for the HUD banner (transient). */
  result: null as MissionResult | null,
  /** Monotonic event sequence for dedup + ordering. */
  eventSeq: 0,
  /** Monotonic attempt counter (feeds attempt ids + deterministic selection). */
  attemptSeq: 0,
  /** Monotonic result banner sequence (UI keying). */
  resultSeq: 0,
  /** Debug overlays. */
  debugEnabled: false,
  /** Diagnostics: last event type seen + last failure reason. */
  lastEventType: null as MissionEventType | null,
  lastFailureReason: null as string | null,
}

export function nextAttemptId(missionId: string): string {
  missionRuntime.attemptSeq += 1
  return `${missionId}#${missionRuntime.attemptSeq}`
}

export function getMissionHistory(missionId: string): MissionHistoryRecord {
  return (
    missionRuntime.history[missionId] ?? {
      missionId,
      completions: 0,
      lastCompletedGameHours: -Infinity,
      totalEarned: 0,
    }
  )
}

/** Full reset — used by resetGame and the dev/test API. */
export function resetMissionRuntime(): void {
  missionRuntime.active = null
  missionRuntime.history = {}
  missionRuntime.cooldowns = {}
  missionRuntime.receipts = {}
  missionRuntime.discovered = new Set<string>()
  missionRuntime.result = null
  missionRuntime.eventSeq = 0
  missionRuntime.attemptSeq = 0
  missionRuntime.resultSeq = 0
  missionRuntime.lastEventType = null
  missionRuntime.lastFailureReason = null
  // debugEnabled intentionally preserved across resets (dev convenience).
}

/**
 * Reset only the TRANSIENT run state (an in-flight attempt + banner), keeping
 * persistent history/cooldowns. Used on load, where a chase/attempt must not
 * carry over but earned progress must.
 */
export function clearActiveMission(): void {
  missionRuntime.active = null
  missionRuntime.result = null
  missionRuntime.lastFailureReason = null
}

