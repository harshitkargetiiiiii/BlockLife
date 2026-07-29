/**
 * The ONE career progression event pipeline (issue #15 §1). Gameplay adapters
 * (shift completion, training, favors, crime escapes) translate existing events
 * into typed {@link CareerEvent}s, then:
 *
 *   event → exact-once dedupe → bounded skill XP awards (with daily caps)
 *
 * Pure + deterministic: `applyCareerEvent` returns a NEW state, so reset/load
 * never re-applies old events and a repeated event id is a no-op. This is the
 * CENTRALIZED award funnel — no career/mission/social adapter writes XP directly,
 * so overlapping adapters can never double-award (§2). Money/pay, promotions and
 * shift lifecycle are orchestrated by the runtime with their own exact-once keys;
 * this file owns skill XP + its dedupe ledger and nothing else.
 */
import {
  APPLIED_CAREER_EVENT_ID_MAX,
  EMPLOYER_STANDING_DEFAULT,
  type CareerHistory,
  type CareerId,
  type EmployerId,
  type PerformanceRecord,
  type RankId,
  type ScheduledShift,
  type ShiftResultRecord,
  type SkillAward,
  type SkillMap,
} from './careerTypes'
import { applySkillAwards, defaultSkills, pruneSkillLedger, type SkillDailyLedger } from './skills'

/** The mutable career gameplay state (lives in the runtime; mutated only via this
 *  pipeline + the runtime's scheduling/pay/promotion reducers). */
export interface CareerState {
  skills: SkillMap
  /** Per-day, per-reason spent ledger for anti-farming (pruned to a few days). */
  skillLedger: SkillDailyLedger
  /** The single active PRIMARY job, or null. */
  activeJob: CareerId | null
  /** Current rank per career the player holds / has held. */
  ranks: Partial<Record<CareerId, RankId>>
  /** Per-career completed/missed/failed counts + highest rank + earnings. */
  history: Partial<Record<CareerId, CareerHistory>>
  /** Career-specific employer standing (NOT the global reputation authority, §9). */
  employerStanding: Record<EmployerId, number>
  /** Bounded upcoming shift queue. */
  scheduledShifts: ScheduledShift[]
  /** The single in-progress shift, or null. */
  activeShift: ScheduledShift | null
  /** Bounded rolling performance history for promotion math. */
  performanceHistory: PerformanceRecord[]
  /** Bounded rich results of the most recent resolved shifts (the results UI). */
  recentResults: ShiftResultRecord[]
  /** Unlock ids the player has earned (bounded). */
  unlocks: string[]
  /** Bounded FIFO of applied career-event ids (exact-once XP guard). */
  appliedEventIds: string[]
  /** Bounded FIFO of paid shift attempt keys (exact-once pay guard). */
  paidAttemptKeys: string[]
  /** Employers who have recommended the player (relaxes their entry gate, §3/§10). */
  recommendations: EmployerId[]
  /** Monotonic shift-id counter — PERSISTED so a reload can't reset it and mint
   *  duplicate shift ids against already-loaded shifts (mission attemptSeq pattern). */
  shiftSeq: number
}

export function defaultCareerState(): CareerState {
  return {
    skills: defaultSkills(),
    skillLedger: {},
    activeJob: null,
    ranks: {},
    history: {},
    employerStanding: {},
    scheduledShifts: [],
    activeShift: null,
    performanceHistory: [],
    recentResults: [],
    unlocks: [],
    appliedEventIds: [],
    paidAttemptKeys: [],
    recommendations: [],
    shiftSeq: 0,
  }
}

/** Kinds a progression adapter can emit. The XP is DATA carried on the event
 *  (computed by the emitting adapter from career affinities + performance), so the
 *  pipeline stays a pure funnel. */
export type CareerEventKind =
  | 'shift_completed'
  | 'training_milestone'
  | 'favor_completed'
  | 'social_activity'
  | 'customer_served'
  | 'delivery_completed'
  | 'crime_escaped'
  | 'crime_witnessed'

/** A typed progression event with a STABLE id for exact-once application. */
export interface CareerEvent {
  /** Stable, unique — the exact-once key. */
  id: string
  kind: CareerEventKind
  gameDay: number
  gameHour?: number
  /** Bounded skill XP awards to apply (subject to per-source daily caps). */
  skillAwards: SkillAward[]
}

export interface ApplyCareerEventResult {
  state: CareerState
  applied: boolean
  grantedXp: number
}

function pushCapped(list: string[], id: string, max: number): string[] {
  const next = [...list, id]
  return next.length > max ? next.slice(next.length - max) : next
}

/**
 * Apply ONE career event exactly once. A duplicate id (reload, repeated delivery,
 * double adapter) is a no-op. Skill XP flows through the bounded, daily-capped
 * reducer; the ledger is pruned so it can't grow across many game days.
 */
export function applyCareerEvent(prev: CareerState, event: CareerEvent): ApplyCareerEventResult {
  if (prev.appliedEventIds.includes(event.id)) return { state: prev, applied: false, grantedXp: 0 }

  const pruned = pruneSkillLedger(prev.skillLedger, event.gameDay)
  const awardRes = applySkillAwards(prev.skills, pruned, event.skillAwards, event.gameDay)
  const state: CareerState = {
    ...prev,
    skills: awardRes.skills,
    skillLedger: awardRes.ledger,
    appliedEventIds: pushCapped(prev.appliedEventIds, event.id, APPLIED_CAREER_EVENT_ID_MAX),
  }
  return { state, applied: true, grantedXp: awardRes.grantedAmount }
}

/** Ensure an employer-standing entry exists (defaulted) — the runtime uses this
 *  before nudging standing on a work outcome. */
export function ensureStanding(state: CareerState, employerId: EmployerId): number {
  return state.employerStanding[employerId] ?? EMPLOYER_STANDING_DEFAULT
}
