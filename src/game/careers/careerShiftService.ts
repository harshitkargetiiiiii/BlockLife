/**
 * Shift lifecycle reducers (issue #15 §4/§6/§7) — PURE state transitions for an
 * active shift: begin → step through the world objectives → finalize (or fail /
 * cancel). Performance + pay are computed deterministically and finalized EXACTLY
 * ONCE (guarded by the shift's attemptKey), so a reload / repeated finalize can
 * never duplicate pay or XP. Money is not touched here — the reducer REPORTS the
 * pay; the store applies it through the economy authority.
 */
import {
  EMPLOYER_STANDING_DEFAULT,
  EMPLOYER_STANDING_MAX,
  EMPLOYER_STANDING_MIN,
  PAID_ATTEMPT_KEY_MAX,
  PERFORMANCE_HISTORY_MAX,
  type CareerDefinition,
  type CareerHistory,
  type PayResult,
  type PerformanceResult,
  type RankDefinition,
  type ScheduledShift,
  type ShiftCompletionReason,
} from './careerTypes'
import type { CareerState } from './careerEvents'
import type { CareerEvent } from './careerEvents'
import { computeFailedPay, computePay, instantiateShiftObjectives, scorePerformance, shiftSkillAwards } from './careerShifts'

function clampStanding(v: number): number {
  return Math.max(EMPLOYER_STANDING_MIN, Math.min(EMPLOYER_STANDING_MAX, Math.trunc(v)))
}
function historyFor(state: CareerState, careerId: CareerDefinition['id']): CareerHistory {
  return state.history[careerId] ?? { careerId, completedShifts: 0, missedShifts: 0, failedShifts: 0, highestRank: 'trainee', totalEarned: 0 }
}
function pushCapped<T>(list: T[], item: T, max: number): T[] {
  const next = [...list, item]
  return next.length > max ? next.slice(next.length - max) : next
}

/** Move a scheduled shift to `active`, instantiate its world objectives, stamp the
 *  on-time flag from the start window. Refuses if a shift is already active. */
export function beginShift(state: CareerState, career: CareerDefinition, shiftId: string, onTime: boolean, startedAtHour: number): { state: CareerState; ok: boolean } {
  if (state.activeShift) return { state, ok: false }
  const shift = state.scheduledShifts.find((s) => s.id === shiftId)
  if (!shift || (shift.status !== 'scheduled' && shift.status !== 'available')) return { state, ok: false }
  const active: ScheduledShift = {
    ...shift,
    status: 'active',
    objectives: instantiateShiftObjectives(career),
    stepIndex: 0,
    startedAtHour,
    onTime,
    completionReason: undefined,
    performance: undefined,
  }
  return {
    state: {
      ...state,
      activeShift: active,
      scheduledShifts: state.scheduledShifts.map((s) => (s.id === shiftId ? { ...s, status: 'active' } : s)),
    },
    ok: true,
  }
}

/** Mark the current (or a specific) required step done; optionally record a mistake. */
export function completeStep(state: CareerState, stepId: string, mistake = false): CareerState {
  const shift = state.activeShift
  if (!shift || !shift.objectives) return state
  const objectives = shift.objectives.map((o) => (o.id === stepId ? { ...o, done: true, mistake: mistake || o.mistake } : o))
  return { ...state, activeShift: { ...shift, objectives } }
}

/** Mark the OPTIONAL bonus objective done (a quality/safety beat). */
export function completeOptional(state: CareerState): CareerState {
  const shift = state.activeShift
  if (!shift || !shift.objectives) return state
  const objectives = shift.objectives.map((o) => (o.optional ? { ...o, done: true } : o))
  return { ...state, activeShift: { ...shift, objectives } }
}

export interface FinalizeResult {
  state: CareerState
  pay: PayResult
  performance: PerformanceResult
  /** The exact-once XP event to funnel through the pipeline (or undefined if already paid). */
  xpEvent?: CareerEvent
  alreadyFinalized: boolean
}

/**
 * Finalize a COMPLETED shift: score performance, compute pay, award skill XP, update
 * history + standing + performance ledger, and clear the active shift. EXACTLY ONCE —
 * a repeat (reload) returns the same result with zero new pay/XP.
 */
export function finalizeShift(state: CareerState, career: CareerDefinition, rank: RankDefinition, gameDay: number): FinalizeResult {
  const shift = state.activeShift
  if (!shift || !shift.objectives || shift.status !== 'active') {
    return { state, pay: { base: 0, rankModifier: 1, performanceModifier: 0, total: 0 }, performance: emptyPerf(), alreadyFinalized: true }
  }
  const onTime = shift.onTime ?? false
  const performance = scorePerformance(career, shift.objectives, onTime)
  if (state.paidAttemptKeys.includes(shift.attemptKey)) {
    // Already paid (idempotent finalize) — clear the active shift, grant nothing.
    return { state: { ...state, activeShift: null }, pay: zeroPay(career.basePay, rank.payModifier), performance, alreadyFinalized: true }
  }
  const pay = computePay(career, rank, performance)
  const h = historyFor(state, career.id)

  const next: CareerState = {
    ...state,
    activeShift: null,
    scheduledShifts: state.scheduledShifts.filter((s) => s.id !== shift.id),
    paidAttemptKeys: pushCapped(state.paidAttemptKeys, shift.attemptKey, PAID_ATTEMPT_KEY_MAX),
    history: { ...state.history, [career.id]: { ...h, completedShifts: h.completedShifts + 1, totalEarned: h.totalEarned + pay.total } },
    performanceHistory: pushCapped(state.performanceHistory, { careerId: career.id, shiftId: shift.id, score: performance.score, onTime, day: Math.trunc(gameDay) }, PERFORMANCE_HISTORY_MAX),
    employerStanding: { ...state.employerStanding, [career.employerId]: clampStanding((state.employerStanding[career.employerId] ?? EMPLOYER_STANDING_DEFAULT) + performanceStandingDelta(performance.score)) },
  }
  const xpEvent: CareerEvent = {
    id: `shift_xp:${shift.attemptKey}`,
    kind: 'shift_completed',
    gameDay,
    skillAwards: shiftSkillAwards(career, performance, onTime).map((a) => ({ skill: a.skill as CareerEvent['skillAwards'][number]['skill'], amount: a.amount, reason: a.reason as CareerEvent['skillAwards'][number]['reason'] })),
  }
  return { state: next, pay, performance, xpEvent, alreadyFinalized: false }
}

/** Fail an active shift (arrest / incapacitation): reduced pay, standing ding, no
 *  criminal record — a typed failure. Exact-once via the attemptKey. */
export function failShift(state: CareerState, career: CareerDefinition, rank: RankDefinition, reason: ShiftCompletionReason, gameDay: number): FinalizeResult {
  const shift = state.activeShift
  if (!shift || !shift.objectives) return { state, pay: zeroPay(career.basePay, rank.payModifier), performance: emptyPerf(), alreadyFinalized: true }
  const performance = scorePerformance(career, shift.objectives, false)
  if (state.paidAttemptKeys.includes(shift.attemptKey)) return { state: { ...state, activeShift: null }, pay: zeroPay(career.basePay, rank.payModifier), performance, alreadyFinalized: true }
  const pay = computeFailedPay(career, rank, shift.objectives)
  const h = historyFor(state, career.id)
  const next: CareerState = {
    ...state,
    activeShift: null,
    scheduledShifts: state.scheduledShifts.filter((s) => s.id !== shift.id),
    paidAttemptKeys: pushCapped(state.paidAttemptKeys, shift.attemptKey, PAID_ATTEMPT_KEY_MAX),
    history: { ...state.history, [career.id]: { ...h, failedShifts: h.failedShifts + 1, totalEarned: h.totalEarned + pay.total } },
    performanceHistory: pushCapped(state.performanceHistory, { careerId: career.id, shiftId: shift.id, score: performance.score, onTime: false, day: Math.trunc(gameDay) }, PERFORMANCE_HISTORY_MAX),
    employerStanding: { ...state.employerStanding, [career.employerId]: clampStanding((state.employerStanding[career.employerId] ?? EMPLOYER_STANDING_DEFAULT) - 10) },
  }
  return { state: next, pay, performance: { ...performance, notes: [`Shift failed (${reason})`, ...performance.notes] }, alreadyFinalized: false }
}

/** Cancel the active shift with no pay + a standing ding (player bailed). */
export function cancelShift(state: CareerState): CareerState {
  const shift = state.activeShift
  if (!shift) return state
  const h = historyFor(state, shift.careerId)
  return {
    ...state,
    activeShift: null,
    scheduledShifts: state.scheduledShifts.filter((s) => s.id !== shift.id),
    history: { ...state.history, [shift.careerId]: { ...h, missedShifts: h.missedShifts + 1 } },
    employerStanding: { ...state.employerStanding, [shift.employerId]: clampStanding((state.employerStanding[shift.employerId] ?? EMPLOYER_STANDING_DEFAULT) - 6) },
  }
}

function performanceStandingDelta(score: number): number {
  if (score >= 85) return 5
  if (score >= 65) return 2
  if (score >= 45) return 0
  return -3
}
function zeroPay(base: number, mod: number): PayResult {
  return { base, rankModifier: mod, performanceModifier: 0, total: 0 }
}
function emptyPerf(): PerformanceResult {
  return { score: 0, breakdown: { attendance: 0, requiredObjectives: 0, optionalObjectives: 0, mistakes: 0, timeEfficiency: 0 }, notes: [], onTime: false, requiredDone: 0, requiredTotal: 0, optionalDone: 0, optionalTotal: 0, mistakes: 0 }
}
