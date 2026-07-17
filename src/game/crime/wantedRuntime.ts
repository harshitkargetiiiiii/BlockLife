import type { Vec3 } from '../world/worldTypes'

/**
 * The central wanted runtime — global (survives streaming), driven by
 * internal HEAT rather than direct star assignment. Only REPORTED crimes
 * (or police directly witnessing) raise heat, so an unseen crime never
 * produces wanted. Decay is explicit and only runs when no officer has line
 * of sight and no fresh report exists. Transient (resets on load).
 */

export type WantedLevel = 0 | 1 | 2 | 3
export type WantedStatus = 'clear' | 'reported' | 'pursuit' | 'searching' | 'cooling'

export interface WantedSnapshot {
  heat: number
  level: WantedLevel
  status: WantedStatus
  lastKnownPosition: Vec3 | null
  lastSeenTime: number | null
  activeIncidentIds: string[]
}

// Heat → level thresholds. Architected for L4/L5 (not implemented).
const LEVEL_THRESHOLDS: { level: WantedLevel; heat: number }[] = [
  { level: 3, heat: 12 },
  { level: 2, heat: 5 },
  { level: 1, heat: 1 },
]
/** Repeated reports of the SAME crime type stack with diminishing returns. */
const REPEAT_FALLOFF = 0.5
/** Global heat ceiling so repeated minor crime cannot ratchet forever. */
const HEAT_CAP = 20
/** Search window (seconds) before cooling — longer at higher levels. */
const SEARCH_SECONDS: Record<WantedLevel, number> = { 0: 0, 1: 18, 2: 30, 3: 45 }
const DECAY_PER_SECOND = 0.6
/** A report within this window counts as "fresh" and blocks decay. */
const FRESH_REPORT_SECONDS = 6

export const wantedRuntime = {
  heat: 0,
  status: 'clear' as WantedStatus,
  lastKnownPosition: null as Vec3 | null,
  lastSeenTime: null as number | null,
  lastReportTime: null as number | null,
  searchUntil: 0,
  activeIncidentIds: [] as string[],
  /** Per-type report counts for diminishing-returns stacking. */
  typeCounts: new Map<string, number>(),
  /** Set true by attacking_police / police_injury — forces + holds L3. */
  policeAttacked: false,
}

export function wantedLevelFor(heat: number, policeAttacked: boolean): WantedLevel {
  if (policeAttacked) return 3
  for (const t of LEVEL_THRESHOLDS) if (heat >= t.heat) return t.level
  return 0
}

export function getWantedLevel(): WantedLevel {
  return wantedLevelFor(wantedRuntime.heat, wantedRuntime.policeAttacked)
}

/**
 * A reported crime raises heat. Repeated reports of the same type give
 * diminishing heat; attacking police forces level 3. `incidentId` groups
 * reports so multiple witnesses of one act don't multiply dispatch.
 */
export function applyReport(input: {
  crimeType: string
  severity: number
  incidentId: string
  position: Vec3
  gameTime: number
  isPoliceAttack?: boolean
}): void {
  const prior = wantedRuntime.typeCounts.get(input.crimeType) ?? 0
  const gain = input.severity / (1 + prior * REPEAT_FALLOFF)
  wantedRuntime.typeCounts.set(input.crimeType, prior + 1)
  wantedRuntime.heat = Math.min(HEAT_CAP, wantedRuntime.heat + gain)
  wantedRuntime.lastReportTime = input.gameTime
  if (input.isPoliceAttack) wantedRuntime.policeAttacked = true
  if (!wantedRuntime.activeIncidentIds.includes(input.incidentId)) {
    wantedRuntime.activeIncidentIds.push(input.incidentId)
  }
  // A report while clear/cooling (re)opens the case; an active pursuit stays.
  if (wantedRuntime.status === 'clear' || wantedRuntime.status === 'cooling') {
    wantedRuntime.status = 'reported'
  } else if (wantedRuntime.status === 'searching') {
    // A fresh report during a search resumes pursuit toward it.
    wantedRuntime.status = 'pursuit'
  }
  wantedRuntime.lastKnownPosition = [...input.position] as Vec3
}

/** A police unit currently sees the suspect: pursuit + fresh last-known. */
export function policeSighting(position: Vec3, gameTime: number): void {
  if (wantedRuntime.status === 'clear') return
  wantedRuntime.status = 'pursuit'
  wantedRuntime.lastKnownPosition = [...position] as Vec3
  wantedRuntime.lastSeenTime = gameTime
}

/** Last officer lost visual: begin a bounded search from last-known. */
export function policeLostSight(gameTime: number): void {
  if (wantedRuntime.status !== 'pursuit') return
  wantedRuntime.status = 'searching'
  wantedRuntime.searchUntil = gameTime + SEARCH_SECONDS[getWantedLevel()]
}

/**
 * Per-tick decay + status advance. `hasActiveLOS` = any officer sees the
 * suspect right now (blocks all decay/clearing — wanted can't melt while
 * seen). Deterministic on `dt`.
 */
export function tickWanted(gameTime: number, dt: number, hasActiveLOS: boolean): void {
  if (wantedRuntime.status === 'clear' || hasActiveLOS) return
  const freshReport =
    wantedRuntime.lastReportTime !== null &&
    gameTime - wantedRuntime.lastReportTime < FRESH_REPORT_SECONDS
  if (freshReport) return

  if (wantedRuntime.status === 'searching' && gameTime >= wantedRuntime.searchUntil) {
    wantedRuntime.status = 'cooling'
  }
  // 'reported' with no responder engaging also cools toward clear.
  if (wantedRuntime.status === 'cooling' || wantedRuntime.status === 'reported') {
    wantedRuntime.heat = Math.max(0, wantedRuntime.heat - DECAY_PER_SECOND * dt)
    if (wantedRuntime.status === 'reported') wantedRuntime.status = 'cooling'
    // Clear once heat drains to zero, or drops below the level-1 threshold
    // (a forced police-attack level holds until heat itself reaches zero).
    if (wantedRuntime.heat <= 0 || getWantedLevel() === 0) clearWanted()
  }
}

export function clearWanted(): void {
  wantedRuntime.heat = 0
  wantedRuntime.status = 'clear'
  wantedRuntime.lastKnownPosition = null
  wantedRuntime.lastSeenTime = null
  wantedRuntime.lastReportTime = null
  wantedRuntime.searchUntil = 0
  wantedRuntime.activeIncidentIds.length = 0
  wantedRuntime.typeCounts.clear()
  wantedRuntime.policeAttacked = false
}

/** Dev/test: jump straight to a wanted level (seeds heat at its threshold). */
export function setWantedLevel(level: WantedLevel, position: Vec3, gameTime: number): void {
  if (level === 0) {
    clearWanted()
    return
  }
  const threshold = LEVEL_THRESHOLDS.find((t) => t.level === level)!.heat
  wantedRuntime.heat = threshold
  wantedRuntime.policeAttacked = level === 3
  wantedRuntime.status = 'reported'
  wantedRuntime.lastKnownPosition = [...position] as Vec3
  wantedRuntime.lastReportTime = gameTime
}

export function getWantedSnapshot(): WantedSnapshot {
  return {
    heat: Math.round(wantedRuntime.heat * 100) / 100,
    level: getWantedLevel(),
    status: wantedRuntime.status,
    lastKnownPosition: wantedRuntime.lastKnownPosition
      ? ([...wantedRuntime.lastKnownPosition] as Vec3)
      : null,
    lastSeenTime: wantedRuntime.lastSeenTime,
    activeIncidentIds: [...wantedRuntime.activeIncidentIds],
  }
}

export function resetWantedRuntime(): void {
  clearWanted()
}
