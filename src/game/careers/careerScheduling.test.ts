import { describe, expect, it } from 'vitest'
import { buildScheduledShift, evaluateShiftStart, isShiftMissed, shiftsConflict, shiftTimeWindow } from './careerScheduling'
import { getCareer } from './careerRegistry'
import type { ScheduledShift } from './careerTypes'
import type { ShiftConflictContext as SCC } from './careerScheduling'

const career = getCareer('delivery_driver')!
const baseShift = (over: Partial<ScheduledShift> = {}): ScheduledShift => ({
  id: 'shift:1', careerId: 'delivery_driver', employerId: 'courier_dispatch', rank: 'trainee', templateId: 'delivery_route',
  scheduledDay: 5, startHour: 9, graceHours: 3, durationHours: 4, workplaceInteractableId: 'courier_depot',
  status: 'scheduled', attemptKey: 'att:1', ...over,
})
const okCtx = (over: Partial<SCC> = {}): SCC => ({ wanted: 0, incapacitated: false, hasActiveShift: false, missionBusy: false, socialActivityActive: false, atInteractableId: 'courier_depot', ...over })

describe('shiftTimeWindow — game-time start window (§4)', () => {
  it('opens 1h before and closes at the grace edge', () => {
    expect(shiftTimeWindow(baseShift(), 5, 7).kind).toBe('too_early') // 2h before
    expect(shiftTimeWindow(baseShift(), 5, 8).startable).toBe(true) // 1h before
    expect(shiftTimeWindow(baseShift(), 5, 9).startable).toBe(true) // on time
    expect(shiftTimeWindow(baseShift(), 5, 11).startable).toBe(true) // +2h, inside grace
    expect(shiftTimeWindow(baseShift(), 5, 12).kind).toBe('expired') // +3h == grace
  })
  it('a non-scheduled shift is never startable', () => {
    expect(shiftTimeWindow(baseShift({ status: 'completed' }), 5, 9).kind).toBe('not_scheduled')
  })
})

describe('evaluateShiftStart — full gate: time + crime + conflict + workplace (§4/§11/§12)', () => {
  it('starts cleanly at the venue in-window with no conflicts', () => {
    expect(evaluateShiftStart(career, baseShift(), okCtx(), 5, 9).canStart).toBe(true)
  })
  it('active wanted pursuit blocks start', () => {
    const g = evaluateShiftStart(career, baseShift(), okCtx({ wanted: 2 }), 5, 9)
    expect(g.canStart).toBe(false)
    expect(g.reason).toMatch(/police/i)
  })
  it('incapacitation, another shift, mission, or social activity each block start', () => {
    expect(evaluateShiftStart(career, baseShift(), okCtx({ incapacitated: true }), 5, 9).canStart).toBe(false)
    expect(evaluateShiftStart(career, baseShift(), okCtx({ hasActiveShift: true }), 5, 9).canStart).toBe(false)
    expect(evaluateShiftStart(career, baseShift(), okCtx({ missionBusy: true }), 5, 9).canStart).toBe(false)
    expect(evaluateShiftStart(career, baseShift(), okCtx({ socialActivityActive: true }), 5, 9).canStart).toBe(false)
  })
  it('requires being at the workplace', () => {
    const g = evaluateShiftStart(career, baseShift(), okCtx({ atInteractableId: 'gym' }), 5, 9)
    expect(g.canStart).toBe(false)
    expect(g.reason).toMatch(/Courier|clock in/i)
  })
  it('refuses outside the time window even when everything else is fine', () => {
    expect(evaluateShiftStart(career, baseShift(), okCtx(), 5, 7).canStart).toBe(false)
  })
})

describe('buildScheduledShift + missed detection', () => {
  it('schedules today when the window has not opened, else tomorrow; reload-safe id', () => {
    const today = buildScheduledShift(career, 'trainee', 4, 5, 6, 9) // 06:00 → 09:00 window not open yet
    expect(today.scheduledDay).toBe(5)
    expect(today.id).toBe('shift:4')
    const tomorrow = buildScheduledShift(career, 'trainee', 5, 5, 10, 9) // already 10:00 → tomorrow
    expect(tomorrow.scheduledDay).toBe(6)
  })
  it('a shift is missed once past start + grace', () => {
    expect(isShiftMissed(baseShift(), 5, 11)).toBe(false)
    expect(isShiftMissed(baseShift(), 5, 12)).toBe(true)
    expect(isShiftMissed(baseShift({ status: 'active' }), 6, 12)).toBe(false) // active never auto-misses
  })
  it('detects a conflict with an accepted plan overlapping the shift', () => {
    expect(shiftsConflict(baseShift(), 5, 10)).toBe(true) // during the shift
    expect(shiftsConflict(baseShift(), 5, 20)).toBe(false) // long after
  })
})
