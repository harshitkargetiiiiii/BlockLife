import { beforeEach, describe, expect, it } from 'vitest'
import { applyCareerSave, sanitizeCareerSave, serializeCareers } from './careerPersistence'
import { careerRuntime, ingestCareerEvent, resetCareers } from './careerRuntime'
import { defaultCareerState } from './careerEvents'
import type { ScheduledShift } from './careerTypes'

const shift = (over: Partial<ScheduledShift> = {}): ScheduledShift => ({
  id: 'shift:3',
  careerId: 'delivery_driver',
  employerId: 'courier_dispatch',
  rank: 'trainee',
  templateId: 'delivery_route',
  scheduledDay: 2,
  startHour: 9,
  graceHours: 3,
  durationHours: 4,
  workplaceInteractableId: 'courier_depot',
  status: 'scheduled',
  attemptKey: 'att:3',
  ...over,
})

describe('career persistence — additive, fail-safe, round-trip (§13)', () => {
  beforeEach(() => resetCareers())

  it('round-trips skills, ranks, standing, unlocks, and applied ids', () => {
    ingestCareerEvent({ id: 'x', kind: 'shift_completed', gameDay: 1, skillAwards: [{ skill: 'driving', amount: 60, reason: 'delivery_completed' }] })
    careerRuntime.state = { ...careerRuntime.state, activeJob: 'delivery_driver', ranks: { delivery_driver: 'regular' }, employerStanding: { courier_dispatch: 55 }, unlocks: ['delivery_thermal_bag'], scheduledShifts: [shift()] }
    const saved = serializeCareers()

    resetCareers()
    expect(careerRuntime.state.activeJob).toBeNull()
    applyCareerSave(saved)
    expect(careerRuntime.state.skills.driving).toBe(60)
    expect(careerRuntime.state.activeJob).toBe('delivery_driver')
    expect(careerRuntime.state.ranks.delivery_driver).toBe('regular')
    expect(careerRuntime.state.employerStanding.courier_dispatch).toBe(55)
    expect(careerRuntime.state.unlocks).toContain('delivery_thermal_bag')
    expect(careerRuntime.state.scheduledShifts).toHaveLength(1)
    expect(careerRuntime.state.appliedEventIds).toContain('x')
  })

  it('an old save (no career field) resets to canonical defaults', () => {
    ingestCareerEvent({ id: 'y', kind: 'shift_completed', gameDay: 1, skillAwards: [{ skill: 'fitness', amount: 40, reason: 'training_milestone' }] })
    applyCareerSave(undefined)
    expect(careerRuntime.state).toEqual(defaultCareerState())
  })

  it('an active shift never restores mid-flight (no duplicate pay, §13)', () => {
    const saved = serializeCareers()
    saved.activeShift = shift({ id: 'shift:9', status: 'active', attemptKey: 'att:9' })
    applyCareerSave(saved)
    expect(careerRuntime.state.activeShift).toBeNull()
  })

  it('keeps the shift-id counter ahead of any loaded shift id (reload-safe, §13)', () => {
    const saved = serializeCareers()
    saved.shiftSeq = 2
    saved.scheduledShifts = [shift({ id: 'shift:7', attemptKey: 'att:7' })]
    applyCareerSave(saved)
    // Counter advanced past the loaded shift 7 so the next minted id can't collide.
    expect(careerRuntime.state.shiftSeq).toBeGreaterThanOrEqual(7)
  })

  it('sanitizes malformed data field-by-field without corrupting the save', () => {
    const clean = sanitizeCareerSave({
      version: 1,
      skills: { driving: 99999, social: 'nope', bogus: 5 },
      activeJob: 'astronaut',
      ranks: { delivery_driver: 'wizard', gym_trainer: 'senior' },
      employerStanding: { bruno_gym: 999 },
      unlocks: ['a', 'a', 42, 'b'],
      appliedEventIds: ['e1', 7, 'e2'],
      scheduledShifts: [shift(), { id: 'broken' }, null],
      shiftSeq: -4,
    })
    expect(clean.skills.driving).toBe(1000) // clamped
    expect(clean.skills.social).toBe(0)
    expect(clean.activeJob).toBeNull() // unknown career dropped
    expect(clean.ranks.delivery_driver).toBeUndefined() // invalid rank dropped
    expect(clean.ranks.gym_trainer).toBe('senior')
    expect(clean.employerStanding.bruno_gym).toBe(100) // clamped
    expect(clean.unlocks).toEqual(['a', 'b']) // deduped, non-strings dropped
    expect(clean.appliedEventIds).toEqual(['e1', 'e2'])
    expect(clean.scheduledShifts).toHaveLength(1) // broken/null shifts dropped
    expect(clean.shiftSeq).toBe(3) // the valid shift:3 keeps the counter ahead of 0
  })

  it('garbage save data yields a valid default state (never throws)', () => {
    expect(sanitizeCareerSave(null)).toEqual(defaultCareerState())
    expect(sanitizeCareerSave('nope')).toEqual(defaultCareerState())
  })
})
