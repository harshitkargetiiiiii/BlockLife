/**
 * The career runtime — a module singleton holding {@link CareerState} outside
 * zustand (two-tier state: event-driven, never per-frame). UI re-renders via the
 * store's version counter, exactly like the social runtime. This file is the ONLY
 * writer of career state; every mutation goes through the pure pipeline/reducers.
 *
 * Slice 1 scope: skill XP via the exact-once event pipeline, getters, reset, and
 * the DEV snapshot. Applications, scheduling, shift lifecycle, pay and promotions
 * are layered on in later slices — all through this same singleton.
 */
import { SKILL_IDS, type CareerId, type EmployerId, type RankId, type ScheduledShift, type SkillId } from './careerTypes'
import { applyCareerEvent, defaultCareerState, type CareerEvent, type CareerState } from './careerEvents'
import { skillLevel, skillProgress } from './skills'
import { getCareer, getRank, entryRank } from './careerRegistry'
import { applyForCareer, nextScheduledShift, recordHighestRank, reconcileMissedShifts as reconcileMissedShiftsPure, scheduleNextShift, quitActiveJob, withRecommendation } from './careerServices'
import { beginShift, cancelShift, completeOptional, completeStep, failShift, finalizeShift } from './careerShiftService'
import { allRequiredDone, currentStep } from './careerShifts'
import { evaluatePromotion, promoteIfEligible, type PromotionProgress } from './careerPromotion'
import type { CareerDefinition, CareerUnlock, PayResult, PerformanceResult, RankDefinition, ShiftCompletionReason, ShiftObjectiveState } from './careerTypes'
import type { EligibilityContext, EligibilityResult } from './careerApplications'

function activeCareerAndRank(): { career: CareerDefinition; rankDef: ReturnType<typeof getRank> } | null {
  const shift = careerRuntime.state.activeShift
  if (!shift) return null
  const career = getCareer(shift.careerId)
  if (!career) return null
  return { career, rankDef: getRank(shift.careerId, careerRuntime.state.ranks[shift.careerId] ?? entryRank(shift.careerId).id) }
}

export const careerRuntime: { state: CareerState } = { state: defaultCareerState() }

/** Reset to canonical defaults (new game / test isolation). */
export function resetCareers(): void {
  careerRuntime.state = defaultCareerState()
}

/** Ingest ONE progression event exactly once (skill XP funnel). Returns whether it
 *  applied (false for a duplicate) so callers/tests can assert idempotency. */
export function ingestCareerEvent(event: CareerEvent): { applied: boolean; grantedXp: number } {
  const res = applyCareerEvent(careerRuntime.state, event)
  careerRuntime.state = res.state
  return { applied: res.applied, grantedXp: res.grantedXp }
}

// ---- employment + scheduling orchestration (Slice 2) ----------------------

export interface ApplyOutcome {
  result: EligibilityResult
  shift?: ScheduledShift
  rank?: RankId
}

/** Apply for a career. On success sets the primary job + a first scheduled shift. */
export function applyToCareer(careerId: CareerId, ctx: EligibilityContext, gameDay: number, gameHour: number): ApplyOutcome {
  const career = getCareer(careerId)
  if (!career) return { result: { ok: false, reason: 'No such job.' } }
  const res = applyForCareer(careerRuntime.state, career, ctx, gameDay, gameHour)
  careerRuntime.state = res.state
  return { result: res.result, shift: res.shift, rank: res.rank }
}

/** Leave the active primary job (history + ranks preserved). */
export function quitJob(): void {
  careerRuntime.state = quitActiveJob(careerRuntime.state)
}

/** Record an employer recommendation (relaxes their entry gate). */
export function grantRecommendation(employerId: EmployerId): void {
  careerRuntime.state = withRecommendation(careerRuntime.state, employerId)
}

/** Schedule the next shift for a career (after one resolves). Returns it. */
export function scheduleNext(careerId: CareerId, gameDay: number, gameHour: number): ScheduledShift | undefined {
  const career = getCareer(careerId)
  if (!career) return undefined
  const res = scheduleNextShift(careerRuntime.state, career, gameDay, gameHour)
  careerRuntime.state = res.state
  return res.shift
}

/** Lazily mark shifts past their window as missed. Returns the newly-missed set. */
export function reconcileMissedShifts(gameDay: number, gameHour: number): ScheduledShift[] {
  const res = reconcileMissedShiftsPure(careerRuntime.state, gameDay, gameHour)
  careerRuntime.state = res.state
  return res.missed
}

export function getScheduledShifts(): readonly ScheduledShift[] {
  return careerRuntime.state.scheduledShifts
}

export function getActiveShift(): ScheduledShift | null {
  return careerRuntime.state.activeShift
}

export function getNextShift(): ScheduledShift | undefined {
  return nextScheduledShift(careerRuntime.state)
}

export function getShiftById(id: string): ScheduledShift | undefined {
  if (careerRuntime.state.activeShift?.id === id) return careerRuntime.state.activeShift
  return careerRuntime.state.scheduledShifts.find((s) => s.id === id)
}

// ---- shift lifecycle (Slice 3) --------------------------------------------

/** Begin a scheduled shift (the caller has already passed the start gate). */
export function startShift(shiftId: string, onTime: boolean, startedAtHour: number): boolean {
  const shift = careerRuntime.state.scheduledShifts.find((s) => s.id === shiftId)
  if (!shift) return false
  const career = getCareer(shift.careerId)
  if (!career) return false
  const res = beginShift(careerRuntime.state, career, shiftId, onTime, startedAtHour)
  careerRuntime.state = res.state
  return res.ok
}

/** Advance the active shift: mark its current required step done. Returns the next
 *  step (or null when all required steps are complete → ready to finalize). */
export function advanceShift(mistake = false): ShiftObjectiveState | null {
  const shift = careerRuntime.state.activeShift
  if (!shift || !shift.objectives) return null
  const step = currentStep(shift.objectives)
  if (!step) return null
  careerRuntime.state = completeStep(careerRuntime.state, step.id, mistake)
  const after = careerRuntime.state.activeShift
  return after?.objectives ? currentStep(after.objectives) ?? null : null
}

/** Mark the optional bonus objective done. */
export function completeShiftOptional(): void {
  careerRuntime.state = completeOptional(careerRuntime.state)
}

export function activeShiftReadyToFinalize(): boolean {
  const shift = careerRuntime.state.activeShift
  return !!shift?.objectives && allRequiredDone(shift.objectives)
}

export interface ShiftFinalizeOutcome {
  pay: PayResult
  performance: PerformanceResult
  careerId: CareerId
  employerId: EmployerId
  alreadyFinalized: boolean
  /** Set when the completed shift triggered a promotion (§8). */
  promotedTo?: RankDefinition
  unlocks?: CareerUnlock[]
}

/** Finalize a completed shift: score, pay (reported), XP (funneled once), history +
 *  standing, then schedule the next shift. The store applies the money. */
export function finalizeActiveShift(gameDay: number, gameHour: number): ShiftFinalizeOutcome | null {
  const ctx = activeCareerAndRank()
  const shift = careerRuntime.state.activeShift
  if (!ctx || !ctx.rankDef || !shift) return null
  const res = finalizeShift(careerRuntime.state, ctx.career, ctx.rankDef, gameDay)
  careerRuntime.state = res.state
  if (res.xpEvent) careerRuntime.state = applyCareerEvent(careerRuntime.state, res.xpEvent).state
  // Promotion check (one service): a completed shift may earn the next rank + unlocks.
  let promotedTo: RankDefinition | undefined
  let unlocks: CareerUnlock[] | undefined
  if (!res.alreadyFinalized) {
    const promo = promoteIfEligible(careerRuntime.state, ctx.career)
    careerRuntime.state = promo.state
    if (promo.promotedTo) {
      promotedTo = promo.promotedTo
      unlocks = promo.unlocks
    }
  }
  // Schedule the player's next shift for this career so the loop continues.
  if (careerRuntime.state.activeJob === ctx.career.id) scheduleNext(ctx.career.id, gameDay, gameHour)
  return { pay: res.pay, performance: res.performance, careerId: ctx.career.id, employerId: ctx.career.employerId, alreadyFinalized: res.alreadyFinalized, promotedTo, unlocks }
}

/** Promotion progress for the active or a given career (UI + DEV, §12). */
export function getPromotionProgress(careerId: CareerId): PromotionProgress | null {
  const career = getCareer(careerId)
  return career ? evaluatePromotion(careerRuntime.state, career) : null
}

/** Fail the active shift (arrest/incapacitation) — typed failure, reduced pay. */
export function failActiveShift(reason: ShiftCompletionReason, gameDay: number): ShiftFinalizeOutcome | null {
  const ctx = activeCareerAndRank()
  const shift = careerRuntime.state.activeShift
  if (!ctx || !ctx.rankDef || !shift) return null
  const res = failShift(careerRuntime.state, ctx.career, ctx.rankDef, reason, gameDay)
  careerRuntime.state = res.state
  return { pay: res.pay, performance: res.performance, careerId: ctx.career.id, employerId: ctx.career.employerId, alreadyFinalized: res.alreadyFinalized }
}

/** Cancel the active shift (player bailed): no pay, standing ding. */
export function cancelActiveShift(): void {
  careerRuntime.state = cancelShift(careerRuntime.state)
}

/** Record a promotion's highest-rank bump (used by the promotion service, Slice 4). */
export function noteHighestRank(careerId: CareerId, rank: RankId): void {
  careerRuntime.state = recordHighestRank(careerRuntime.state, careerId, rank)
}

// ---- getters (read-only views for the store bridge + DEV/UI) ---------------

export function getCareerState(): Readonly<CareerState> {
  return careerRuntime.state
}

export function getSkillXp(skill: SkillId): number {
  return careerRuntime.state.skills[skill]
}

export function getSkillLevel(skill: SkillId): number {
  return skillLevel(careerRuntime.state.skills[skill])
}

export function getActiveJob(): CareerId | null {
  return careerRuntime.state.activeJob
}

export function getCareerRank(careerId: CareerId): RankId | undefined {
  return careerRuntime.state.ranks[careerId]
}

export function getEmployerStanding(employerId: EmployerId): number | undefined {
  return careerRuntime.state.employerStanding[employerId]
}

export function getUnlocks(): readonly string[] {
  return careerRuntime.state.unlocks
}

export function hasUnlock(unlockId: string): boolean {
  return careerRuntime.state.unlocks.includes(unlockId)
}

export function hasRecommendation(employerId: EmployerId): boolean {
  return careerRuntime.state.recommendations.includes(employerId)
}

// ---- DEV observability snapshot (§14) --------------------------------------

export interface CareerSnapshot {
  skills: Record<SkillId, { xp: number; level: number; into: number; span: number; atMax: boolean }>
  activeJob: CareerId | null
  ranks: Partial<Record<CareerId, RankId>>
  employerStanding: Record<EmployerId, number>
  scheduledShiftCount: number
  activeShiftStatus: string | null
  performanceHistorySize: number
  unlockCount: number
  appliedEventCount: number
  paidAttemptCount: number
  recommendations: EmployerId[]
  shiftSeq: number
}

export function careerSnapshot(): CareerSnapshot {
  const s = careerRuntime.state
  const skills = {} as CareerSnapshot['skills']
  for (const id of SKILL_IDS) {
    const p = skillProgress(s.skills[id])
    skills[id] = { xp: p.xp, level: p.level, into: p.into, span: p.span, atMax: p.atMax }
  }
  return {
    skills,
    activeJob: s.activeJob,
    ranks: { ...s.ranks },
    employerStanding: { ...s.employerStanding },
    scheduledShiftCount: s.scheduledShifts.length,
    activeShiftStatus: s.activeShift ? s.activeShift.status : null,
    performanceHistorySize: s.performanceHistory.length,
    unlockCount: s.unlocks.length,
    appliedEventCount: s.appliedEventIds.length,
    paidAttemptCount: s.paidAttemptKeys.length,
    recommendations: [...s.recommendations],
    shiftSeq: s.shiftSeq,
  }
}
