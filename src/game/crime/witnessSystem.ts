import type { Vec2 } from '../world/worldTypes'
import { createRng, hashString } from '../traffic/routing/routeRng'
import type { CrimeEvent } from './crimeTypes'
import { recordWitness } from './crimeRuntime'
import { hasLineOfSight } from './lineOfSight'
import {
  AUDIBLE_REPORTABLE,
  type WitnessCandidate,
  type WitnessContext,
  type WitnessPersonality,
  type WitnessState,
  type WitnessVerdict,
} from './witnessTypes'

/**
 * Witness evaluation — EVENT-DRIVEN and BUDGETED (never all-NPCs × all-
 * frames). A crime is witnessed by distance + building line-of-sight (or by
 * hearing, for loud crimes), gated by seeded, stable personality. Reports
 * follow a reaction delay and only from capable, surviving witnesses; the
 * reporting/merge into an incident lives in reportingSystem.
 */

const RAIN_SIGHT = 0.7
const NIGHT_SIGHT = 0.72
/** Citizens evaluated per frame across all open crimes (round-robin). */
export const WITNESS_EVAL_BUDGET = 24

interface WitnessRecord {
  citizenId: string
  eventId: string
  state: WitnessState
  verdict: WitnessVerdict
  noticedAt: number
  /** Game time this witness will file a report (Infinity = never). */
  reportAt: number
  reported: boolean
}

export const witnessRuntime = {
  records: new Map<string, WitnessRecord>(), // key: `${citizenId}:${eventId}`
  personalities: new Map<string, WitnessPersonality>(),
  debugEnabled: false,
}

/** Stable seeded personality for a citizen (cached). */
export function getWitnessPersonality(citizenId: string): WitnessPersonality {
  const cached = witnessRuntime.personalities.get(citizenId)
  if (cached) return cached
  const rng = createRng(hashString(`${citizenId}:witness`))
  const p: WitnessPersonality = {
    courage: rng(),
    reportProbability: 0.45 + rng() * 0.5,
    panicThreshold: 3 + rng() * 4,
    fleeDistance: 8 + rng() * 10,
    curiosity: rng() * 0.4,
  }
  witnessRuntime.personalities.set(citizenId, p)
  return p
}

function eventXZ(e: CrimeEvent): Vec2 {
  return [e.position[0], e.position[2]]
}

/** Pure: can this candidate see or hear this event right now? */
export function witnessVerdict(
  candidate: WitnessCandidate,
  event: CrimeEvent,
  ctx: WitnessContext,
): WitnessVerdict {
  if (!candidate.capable) return 'none'
  const src = eventXZ(event)
  const dist = Math.hypot(candidate.position[0] - src[0], candidate.position[1] - src[1])
  const effVisible = event.visibleRadius * (ctx.raining ? RAIN_SIGHT : 1) * (ctx.isNight ? NIGHT_SIGHT : 1)
  if (dist <= effVisible && hasLineOfSight(candidate.position, src)) return 'saw'
  // Loud crimes are heard without line of sight.
  if (dist <= event.noiseRadius && AUDIBLE_REPORTABLE.has(event.type)) return 'heard'
  return 'none'
}

/** Pure seeded: will this witness report this specific event? */
export function willReport(citizenId: string, event: CrimeEvent): boolean {
  const p = getWitnessPersonality(citizenId)
  // Louder/severer crimes push more witnesses to report.
  const severityBoost = Math.min(0.4, event.severity * 0.05)
  const roll = createRng(hashString(`${citizenId}:report:${event.id}`))()
  return roll < p.reportProbability + severityBoost
}

/** Pure seeded reaction delay (seconds) before a report is filed. */
export function reactionDelayFor(citizenId: string, event: CrimeEvent): number {
  const roll = createRng(hashString(`${citizenId}:delay:${event.id}`))()
  return 1 + roll * 2.5
}

/**
 * Observe one candidate against one open event. On a fresh witnessing this
 * records the witness on the crime, seeds the record's report timer, and
 * sets the initial reaction state (flee for high-severity crimes past the
 * citizen's panic threshold, else notice/startle).
 */
export function observeEvent(
  candidate: WitnessCandidate,
  event: CrimeEvent,
  ctx: WitnessContext,
  gameTime: number,
): void {
  const key = `${candidate.id}:${event.id}`
  if (witnessRuntime.records.has(key)) return
  const verdict = witnessVerdict(candidate, event, ctx)
  if (verdict === 'none') return
  recordWitness(event.id, candidate.id)

  const p = getWitnessPersonality(candidate.id)
  const willFlee = event.severity >= p.panicThreshold
  const reports = willReport(candidate.id, event)
  const state: WitnessState = willFlee ? 'fleeing' : verdict === 'heard' ? 'startled' : 'noticed'
  witnessRuntime.records.set(key, {
    citizenId: candidate.id,
    eventId: event.id,
    state,
    verdict,
    noticedAt: gameTime,
    reportAt: reports ? gameTime + reactionDelayFor(candidate.id, event) : Infinity,
    reported: false,
  })
}

export interface PendingReport {
  eventId: string
  reporterId: string
}

/**
 * Advance report timers and return the reports that fire this tick. A
 * witness only reports if still capable (`capableOf` returns true) — a
 * fleeing/incapacitated witness that hasn't reached its timer never does.
 */
export function collectDueReports(
  gameTime: number,
  capableOf: (citizenId: string) => boolean,
): PendingReport[] {
  const due: PendingReport[] = []
  for (const rec of witnessRuntime.records.values()) {
    if (rec.reported || rec.reportAt === Infinity) continue
    if (gameTime < rec.reportAt) continue
    if (!capableOf(rec.citizenId)) continue // died/despawned before reporting
    rec.reported = true
    rec.state = 'reported'
    due.push({ eventId: rec.eventId, reporterId: rec.citizenId })
  }
  return due
}

export function getWitnessRecordFor(citizenId: string): WitnessRecord | null {
  for (const rec of witnessRuntime.records.values()) {
    if (rec.citizenId === citizenId && !rec.reported) return rec
  }
  // Fall back to any record (e.g. already reported) for debug/tests.
  for (const rec of witnessRuntime.records.values()) {
    if (rec.citizenId === citizenId) return rec
  }
  return null
}

/** Dev/test: force a citizen to report an event immediately. */
export function forceWitnessReport(citizenId: string, event: CrimeEvent, gameTime: number): void {
  const key = `${citizenId}:${event.id}`
  recordWitness(event.id, citizenId)
  witnessRuntime.records.set(key, {
    citizenId,
    eventId: event.id,
    state: 'reporting',
    verdict: 'saw',
    noticedAt: gameTime,
    reportAt: gameTime,
    reported: false,
  })
}

export function resetWitnessRuntime(): void {
  witnessRuntime.records.clear()
  witnessRuntime.personalities.clear()
}
