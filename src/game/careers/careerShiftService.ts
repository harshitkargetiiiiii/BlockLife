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
  SHIFT_RESULTS_MAX,
  type CareerDefinition,
  type CareerHistory,
  type PayResult,
  type PerformanceResult,
  type RankDefinition,
  type ScheduledShift,
  type ShiftCompletionReason,
  type ShiftResultRecord,
} from './careerTypes'
import type { CareerState } from './careerEvents'
import type { CareerEvent } from './careerEvents'
import { buildResultRecord, computeFailedPay, computePay, instantiateShiftObjectives, scorePerformance, shiftSkillAwards } from './careerShifts'

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
function recordResult(state: CareerState, result: ShiftResultRecord): ShiftResultRecord[] {
  return pushCapped(state.recentResults, result, SHIFT_RESULTS_MAX)
}

/**
 * Move a scheduled shift into `activeShift`, instantiate its world objectives, and
 * stamp the on-time flag. The started shift is REMOVED from `scheduledShifts` so the
 * active run has exactly ONE home ({@link CareerState.activeShift}) — a save can never
 * strand an `active`-status twin in the scheduled queue (issue #15 §13). Refuses when
 * a shift is already active or the shift isn't owned by the current PRIMARY job (§4).
 */
export function beginShift(state: CareerState, career: CareerDefinition, shiftId: string, onTime: boolean, startedAtHour: number): { state: CareerState; ok: boolean } {
  if (state.activeShift) return { state, ok: false }
  const shift = state.scheduledShifts.find((s) => s.id === shiftId)
  if (!shift || (shift.status !== 'scheduled' && shift.status !== 'available')) return { state, ok: false }
  // Active-job ownership: only a shift of the current primary job can start (§4) — a
  // leftover shift from a previously-held career can never be played.
  if (state.activeJob !== null && state.activeJob !== shift.careerId) return { state, ok: false }
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
      scheduledShifts: state.scheduledShifts.filter((s) => s.id !== shiftId),
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
    recentResults: recordResult(state, buildResultRecord(career.id, shift.id, 'completed', performance, pay, gameDay)),
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
  const failedPerf: PerformanceResult = { ...performance, notes: [`Shift failed (${reason})`, ...performance.notes] }
  const next: CareerState = {
    ...state,
    activeShift: null,
    scheduledShifts: state.scheduledShifts.filter((s) => s.id !== shift.id),
    paidAttemptKeys: pushCapped(state.paidAttemptKeys, shift.attemptKey, PAID_ATTEMPT_KEY_MAX),
    history: { ...state.history, [career.id]: { ...h, failedShifts: h.failedShifts + 1, totalEarned: h.totalEarned + pay.total } },
    performanceHistory: pushCapped(state.performanceHistory, { careerId: career.id, shiftId: shift.id, score: performance.score, onTime: false, day: Math.trunc(gameDay) }, PERFORMANCE_HISTORY_MAX),
    recentResults: recordResult(state, buildResultRecord(career.id, shift.id, reason, failedPerf, pay, gameDay)),
    employerStanding: { ...state.employerStanding, [career.employerId]: clampStanding((state.employerStanding[career.employerId] ?? EMPLOYER_STANDING_DEFAULT) - 10) },
  }
  return { state: next, pay, performance: failedPerf, alreadyFinalized: false }
}

/** Cancel the active shift with no pay + a standing ding (player bailed). Records a
 *  bounded cancelled result so the history surface shows the walk-off (§12). */
export function cancelShift(state: CareerState, gameDay = 0): CareerState {
  const shift = state.activeShift
  if (!shift) return state
  const h = historyFor(state, shift.careerId)
  const perf: PerformanceResult = { ...emptyPerf(), notes: ['You walked off the shift'] }
  const result = buildResultRecord(shift.careerId, shift.id, 'cancelled_by_player', perf, zeroPay(0, 1), gameDay)
  return {
    ...state,
    activeShift: null,
    scheduledShifts: state.scheduledShifts.filter((s) => s.id !== shift.id),
    history: { ...state.history, [shift.careerId]: { ...h, missedShifts: h.missedShifts + 1 } },
    recentResults: recordResult(state, result),
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
