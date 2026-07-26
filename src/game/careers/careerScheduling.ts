/**
 * Shift scheduling + lifecycle (issue #15 §4). PURE + deterministic: a bounded
 * start window keyed on GAME time (never wall-clock), conflict checks against the
 * player's other commitments, and lazy missed-shift detection. No mutation here —
 * the runtime owns state; this file decides windows/conflicts and builds shift
 * records. The start-window shape mirrors the social invitation window (the same
 * "1h before → grace after" idea, reused not duplicated in spirit).
 */
import {
  SHIFT_GRACE_HOURS,
  SHIFT_START_EARLY_HOURS,
  type CareerDefinition,
  type RankId,
  type ScheduledShift,
} from './careerTypes'

/** Absolute game-hour helper (matches reconcileMissedInvitations' basis). */
export function absHour(gameDay: number, gameHour: number): number {
  return Math.trunc(gameDay) * 24 + gameHour
}

const pad2 = (n: number): string => String(Math.trunc(n)).padStart(2, '0')

export type ShiftStartKind = 'ok' | 'too_early' | 'expired' | 'not_scheduled'
export interface ShiftWindowResult {
  startable: boolean
  kind: ShiftStartKind
  reason?: string
}

/**
 * Can this shift be STARTED at the current game time? Startable from
 * {@link SHIFT_START_EARLY_HOURS} before the start hour through {@link SHIFT_GRACE_HOURS}
 * after (past which it is a missed no-show). Time gate only — location + conflicts
 * are separate (so the UI can show a precise reason).
 */
export function shiftTimeWindow(shift: Pick<ScheduledShift, 'status' | 'scheduledDay' | 'startHour' | 'graceHours'>, gameDay: number, gameHour: number): ShiftWindowResult {
  if (shift.status !== 'scheduled' && shift.status !== 'available') return { startable: false, kind: 'not_scheduled' }
  const startAbs = shift.scheduledDay * 24 + shift.startHour
  const nowAbs = absHour(gameDay, gameHour)
  if (nowAbs < startAbs - SHIFT_START_EARLY_HOURS) {
    return { startable: false, kind: 'too_early', reason: `Starts day ${shift.scheduledDay} at ${pad2(shift.startHour)}:00` }
  }
  if (nowAbs >= startAbs + shift.graceHours) {
    return { startable: false, kind: 'expired', reason: 'You missed this shift.' }
  }
  return { startable: true, kind: 'ok' }
}

/** Live world facts the start gate consults (supplied by the store, which owns them). */
export interface ShiftConflictContext {
  wanted: number
  incapacitated: boolean
  hasActiveShift: boolean
  missionBusy: boolean
  socialActivityActive: boolean
  /** The interactable the player is currently at (proximity scanner), or null. */
  atInteractableId: string | null
}

export interface ShiftStartGate {
  canStart: boolean
  reason?: string
}

/**
 * The full start gate: time window + wanted/incapacitation/conflict + workplace
 * proximity. Deterministic, returns the FIRST blocking reason so the UI can show
 * exactly why Start is disabled (§12). Wanted pursuit blocks start (§11).
 */
export function evaluateShiftStart(
  career: CareerDefinition,
  shift: ScheduledShift,
  ctx: ShiftConflictContext,
  gameDay: number,
  gameHour: number,
): ShiftStartGate {
  const win = shiftTimeWindow(shift, gameDay, gameHour)
  if (!win.startable) return { canStart: false, reason: win.reason ?? 'This shift is not startable.' }
  if (ctx.wanted > career.maxWantedToStart) return { canStart: false, reason: 'Shake the police before you clock in.' }
  if (ctx.incapacitated) return { canStart: false, reason: 'You are in no state to work.' }
  if (ctx.hasActiveShift) return { canStart: false, reason: 'You are already on a shift.' }
  if (ctx.missionBusy) return { canStart: false, reason: 'Finish your current job first.' }
  if (ctx.socialActivityActive) return { canStart: false, reason: 'You have plans right now — wrap them up first.' }
  if (ctx.atInteractableId !== shift.workplaceInteractableId) return { canStart: false, reason: `Get to ${career.employerDisplayName} to clock in.` }
  return { canStart: true }
}

/**
 * Build the next scheduled shift for a career at a rank. Deterministic id from the
 * PERSISTED counter (reload-safe — the id can never collide with a loaded shift).
 * Schedules the NEXT day at a fixed morning start so a fresh hire always has a real
 * upcoming shift to attend.
 */
export function buildScheduledShift(career: CareerDefinition, rank: RankId, nextSeq: number, fromDay: number, fromHour: number, atHour = 9): ScheduledShift {
  // Schedule for TODAY at `atHour` when that window hasn't opened yet; otherwise the
  // next day. Always a real future window (never "hired after the shift already started").
  const nowAbs = absHour(fromDay, fromHour)
  let scheduledDay = Math.trunc(fromDay)
  if (nowAbs >= scheduledDay * 24 + atHour - SHIFT_START_EARLY_HOURS) scheduledDay += 1
  const id = `shift:${nextSeq}`
  return {
    id,
    careerId: career.id,
    employerId: career.employerId,
    rank,
    templateId: career.shiftTemplateId,
    scheduledDay,
    startHour: atHour,
    graceHours: SHIFT_GRACE_HOURS,
    durationHours: career.shiftDurationHours,
    workplaceInteractableId: career.workplaceInteractableId,
    status: 'scheduled',
    attemptKey: `att:${nextSeq}`,
  }
}

/** A shift is "missed" once the current time is past its start + grace and it never
 *  went active. Deterministic; the runtime reconciles these lazily. */
export function isShiftMissed(shift: ScheduledShift, gameDay: number, gameHour: number): boolean {
  if (shift.status !== 'scheduled' && shift.status !== 'available') return false
  const startAbs = shift.scheduledDay * 24 + shift.startHour
  return absHour(gameDay, gameHour) >= startAbs + shift.graceHours
}

/** Does a scheduled shift clash (same start hour/day) with an already-accepted
 *  social plan or another shift? Surfaced to the UI, never silently resolved (§4). */
export function shiftsConflict(a: Pick<ScheduledShift, 'scheduledDay' | 'startHour' | 'durationHours'>, otherDay: number, otherHour: number): boolean {
  const aStart = a.scheduledDay * 24 + a.startHour
  const aEnd = aStart + a.durationHours
  const b = otherDay * 24 + otherHour
  return b >= aStart - SHIFT_START_EARLY_HOURS && b < aEnd
}
