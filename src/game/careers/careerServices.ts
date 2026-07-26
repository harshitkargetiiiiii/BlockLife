/**
 * Career orchestration services (issue #15 §3/§4) — PURE reducers over
 * {@link CareerState}: hiring, scheduling the next shift, and lazy missed-shift
 * reconciliation. State in → new state + a typed outcome; the runtime applies the
 * result to its singleton and the store fires the social/economy side effects.
 * Nothing here touches money, relationships, or the world — those stay with their
 * authorities.
 */
import {
  EMPLOYER_STANDING_DEFAULT,
  EMPLOYER_STANDING_MAX,
  EMPLOYER_STANDING_MIN,
  RANK_ORDER,
  SCHEDULED_SHIFTS_MAX,
  type CareerDefinition,
  type CareerHistory,
  type CareerId,
  type EmployerId,
  type RankId,
  type ScheduledShift,
} from './careerTypes'
import { entryRank } from './careerRegistry'
import { checkEligibility, type EligibilityContext, type EligibilityResult } from './careerApplications'
import { buildScheduledShift, isShiftMissed } from './careerScheduling'
import type { CareerState } from './careerEvents'

function emptyHistory(careerId: CareerId): CareerHistory {
  return { careerId, completedShifts: 0, missedShifts: 0, failedShifts: 0, highestRank: 'trainee', totalEarned: 0 }
}

function clampStanding(v: number): number {
  return Math.max(EMPLOYER_STANDING_MIN, Math.min(EMPLOYER_STANDING_MAX, Math.trunc(v)))
}

/** Nudge (and default-initialize) an employer's standing, bounded 0–100 (§9). */
export function adjustStanding(state: CareerState, employerId: EmployerId, delta: number): CareerState {
  const cur = state.employerStanding[employerId] ?? EMPLOYER_STANDING_DEFAULT
  return { ...state, employerStanding: { ...state.employerStanding, [employerId]: clampStanding(cur + delta) } }
}

/** Record that an employer has recommended the player (relaxes their entry gate). */
export function withRecommendation(state: CareerState, employerId: EmployerId): CareerState {
  if (state.recommendations.includes(employerId)) return state
  return { ...state, recommendations: [...state.recommendations, employerId].slice(-16) }
}

export interface HireResult {
  state: CareerState
  result: EligibilityResult
  /** The first scheduled shift on a successful hire. */
  shift?: ScheduledShift
  /** The rank the player holds after hiring (entry for a new career, else preserved). */
  rank?: RankId
}

/**
 * Apply for a career. Deterministic: checks eligibility, and on success sets the
 * single active PRIMARY job, resumes the player's highest held rank for that career
 * (or the entry rank when new), seeds a first scheduled shift, and initializes
 * history + employer standing. A refusal returns the readable reason and no change.
 */
export function applyForCareer(state: CareerState, career: CareerDefinition, ctx: EligibilityContext, gameDay: number, gameHour: number): HireResult {
  const result = checkEligibility(career, ctx)
  if (!result.ok) return { state, result }

  const heldRank: RankId = state.ranks[career.id] ?? entryRank(career.id).id
  const history = state.history[career.id] ?? emptyHistory(career.id)
  const seq = state.shiftSeq + 1
  const shift = buildScheduledShift(career, heldRank, seq, gameDay, gameHour)

  // Replace the primary job; keep every career's history + highest rank.
  const next: CareerState = {
    ...state,
    activeJob: career.id,
    ranks: { ...state.ranks, [career.id]: heldRank },
    history: { ...state.history, [career.id]: history },
    employerStanding: { ...state.employerStanding, [career.employerId]: state.employerStanding[career.employerId] ?? EMPLOYER_STANDING_DEFAULT },
    scheduledShifts: [...state.scheduledShifts.filter((s) => s.careerId !== career.id || s.status !== 'scheduled'), shift].slice(-SCHEDULED_SHIFTS_MAX),
    shiftSeq: seq,
  }
  return { state: next, result, shift, rank: heldRank }
}

/** Leave the current primary job (history + ranks preserved; upcoming shifts dropped). */
export function quitActiveJob(state: CareerState): CareerState {
  if (!state.activeJob) return state
  const quitting = state.activeJob
  return {
    ...state,
    activeJob: null,
    scheduledShifts: state.scheduledShifts.filter((s) => s.careerId !== quitting),
  }
}

/** Schedule the NEXT shift for the active job after one resolves (bounded queue). */
export function scheduleNextShift(state: CareerState, career: CareerDefinition, gameDay: number, gameHour: number): { state: CareerState; shift: ScheduledShift } {
  const rank = state.ranks[career.id] ?? entryRank(career.id).id
  const seq = state.shiftSeq + 1
  const shift = buildScheduledShift(career, rank, seq, gameDay, gameHour)
  return {
    state: { ...state, scheduledShifts: [...state.scheduledShifts, shift].slice(-SCHEDULED_SHIFTS_MAX), shiftSeq: seq },
    shift,
  }
}

export interface MissedReconcileResult {
  state: CareerState
  missed: ScheduledShift[]
}

/**
 * Lazily mark scheduled shifts the player ignored past their window as `missed`
 * (§4). Deterministic; called on time-advance / phone-job-board open, NEVER per
 * frame. A miss records no pay, bumps the career's missed count, and dings employer
 * standing. Returns the newly-missed shifts so the store can fire social follow-ups.
 */
export function reconcileMissedShifts(state: CareerState, gameDay: number, gameHour: number): MissedReconcileResult {
  const missed: ScheduledShift[] = []
  let next = state
  const updated = state.scheduledShifts.map((shift) => {
    if (isShiftMissed(shift, gameDay, gameHour) && shift.status !== 'active') {
      const done: ScheduledShift = { ...shift, status: 'missed', completionReason: 'missed_window' }
      missed.push(done)
      const h = next.history[shift.careerId] ?? emptyHistory(shift.careerId)
      next = {
        ...next,
        history: { ...next.history, [shift.careerId]: { ...h, missedShifts: h.missedShifts + 1 } },
      }
      const career = shift.employerId
      const cur = next.employerStanding[career] ?? EMPLOYER_STANDING_DEFAULT
      next = { ...next, employerStanding: { ...next.employerStanding, [career]: clampStanding(cur - 8) } }
      return done
    }
    return shift
  })
  next = { ...next, scheduledShifts: updated }
  return { state: next, missed }
}

/** The soonest still-attendable shift for the active job (for the phone "next shift"). */
export function nextScheduledShift(state: CareerState): ScheduledShift | undefined {
  return state.scheduledShifts
    .filter((s) => s.status === 'scheduled' || s.status === 'available')
    .sort((a, b) => a.scheduledDay * 24 + a.startHour - (b.scheduledDay * 24 + b.startHour))[0]
}

/** Update the highest-rank record when a promotion lands (never lowers it). */
export function recordHighestRank(state: CareerState, careerId: CareerId, rank: RankId): CareerState {
  const h = state.history[careerId] ?? emptyHistory(careerId)
  const better = RANK_ORDER.indexOf(rank) > RANK_ORDER.indexOf(h.highestRank) ? rank : h.highestRank
  return { ...state, history: { ...state.history, [careerId]: { ...h, highestRank: better } } }
}
