import { beforeEach, describe, expect, it } from 'vitest'
import { checkEligibility, type EligibilityContext } from './careerApplications'
import { getCareer } from './careerRegistry'
import { defaultSkills } from './skills'
import { applyToCareer, careerRuntime, getNextShift, getScheduledShifts, grantRecommendation, ingestCareerEvent, quitJob, reconcileMissedShifts, resetCareers } from './careerRuntime'
import type { SkillMap } from './careerTypes'

const gym = getCareer('gym_trainer')! // entry: Fitness 3, relaxed by a Bruno recommendation
const delivery = getCareer('delivery_driver')! // accessible

function ctx(over: Partial<EligibilityContext> = {}): EligibilityContext {
  return { skills: defaultSkills(), reputation: 0, wanted: 0, activeJob: null, hasActiveShift: false, hasRecommendation: () => false, ...over }
}
function skillsWith(over: Partial<SkillMap>): SkillMap {
  return { ...defaultSkills(), ...over }
}

describe('checkEligibility — deterministic, readable refusals (§3)', () => {
  it('accepts an accessible career with no requirements', () => {
    expect(checkEligibility(delivery, ctx()).ok).toBe(true)
  })
  it('refuses a skill gate with a readable reason', () => {
    const r = checkEligibility(gym, ctx())
    expect(r.ok).toBe(false)
    expect(r.reason).toMatch(/Fitness level 3/)
  })
  it('refuses while wanted', () => {
    expect(checkEligibility(delivery, ctx({ wanted: 3 })).reason).toMatch(/wanted/i)
  })
  it('refuses re-applying to the current job', () => {
    expect(checkEligibility(delivery, ctx({ activeJob: 'delivery_driver' })).reason).toMatch(/already work/i)
  })
  it('refuses switching jobs while a shift is in progress (§4, R3)', () => {
    const r = checkEligibility(gym, ctx({ hasActiveShift: true, skills: skillsWith({ fitness: 90 }) }))
    expect(r.ok).toBe(false)
    expect(r.reason).toMatch(/active shift/i)
  })
  it('a social recommendation relaxes the skill gate (§3/§10)', () => {
    const r = checkEligibility(gym, ctx({ hasRecommendation: (id) => id === 'bruno_gym' }))
    expect(r.ok).toBe(true)
    expect(r.viaRecommendation).toBe(true)
  })
  it('meeting the skill gate the hard way also works', () => {
    expect(checkEligibility(gym, ctx({ skills: skillsWith({ fitness: 90 }) })).ok).toBe(true) // level 3 == 90xp
  })
})

describe('applyToCareer + scheduling (runtime, §3/§4)', () => {
  beforeEach(() => resetCareers())

  it('hires into an accessible career and seeds a first scheduled shift', () => {
    const out = applyToCareer('delivery_driver', ctx(), 2, 8)
    expect(out.result.ok).toBe(true)
    expect(out.shift).toBeDefined()
    expect(careerRuntime.state.activeJob).toBe('delivery_driver')
    expect(careerRuntime.state.ranks.delivery_driver).toBe('trainee')
    expect(getScheduledShifts()).toHaveLength(1)
    expect(getNextShift()!.id).toBe(out.shift!.id)
    expect(careerRuntime.state.history.delivery_driver!.completedShifts).toBe(0)
  })

  it('refuses an ineligible application without changing state', () => {
    const out = applyToCareer('gym_trainer', ctx(), 2, 8)
    expect(out.result.ok).toBe(false)
    expect(careerRuntime.state.activeJob).toBeNull()
    expect(getScheduledShifts()).toHaveLength(0)
  })

  it('a recommendation lets you into the gated career', () => {
    grantRecommendation('bruno_gym')
    const out = applyToCareer('gym_trainer', ctx({ hasRecommendation: (id) => careerRuntime.state.recommendations.includes(id) }), 2, 8)
    expect(out.result.ok).toBe(true)
    expect(careerRuntime.state.activeJob).toBe('gym_trainer')
  })

  it('switching jobs preserves the prior career rank + history', () => {
    applyToCareer('delivery_driver', ctx(), 2, 8)
    careerRuntime.state = { ...careerRuntime.state, ranks: { ...careerRuntime.state.ranks, delivery_driver: 'regular' } }
    applyToCareer('trade_worker', ctx({ activeJob: 'delivery_driver', skills: skillsWith({ work_ethic: 30 }) }), 2, 8)
    expect(careerRuntime.state.activeJob).toBe('trade_worker')
    expect(careerRuntime.state.ranks.delivery_driver).toBe('regular') // preserved
    // Re-applying to delivery resumes at the held rank, not trainee.
    const back = applyToCareer('delivery_driver', ctx({ activeJob: 'trade_worker' }), 2, 8)
    expect(back.rank).toBe('regular')
  })

  it('quitting clears the active job but keeps history/ranks', () => {
    applyToCareer('delivery_driver', ctx(), 2, 8)
    quitJob()
    expect(careerRuntime.state.activeJob).toBeNull()
    expect(careerRuntime.state.history.delivery_driver).toBeDefined()
    expect(getScheduledShifts()).toHaveLength(0)
  })
})

describe('reconcileMissedShifts — lazy, real-clock, employer consequence (§4)', () => {
  beforeEach(() => resetCareers())

  it('marks a shift missed past its window, dings standing, no pay', () => {
    applyToCareer('delivery_driver', ctx(), 2, 8)
    const shift = getNextShift()!
    const standingBefore = careerRuntime.state.employerStanding.courier_dispatch
    // Roll the clock two days past the appointment.
    const missed = reconcileMissedShifts(shift.scheduledDay + 2, 12)
    expect(missed).toHaveLength(1)
    expect(careerRuntime.state.history.delivery_driver!.missedShifts).toBe(1)
    expect(careerRuntime.state.employerStanding.courier_dispatch).toBeLessThan(standingBefore!)
    // A miss never dead-ends the loop (F2): a fresh next shift is scheduled for the
    // still-employed player, dated after the reconcile clock (not yet missed).
    const replacement = getNextShift()
    expect(replacement).toBeDefined()
    expect(replacement!.id).not.toBe(shift.id)
    // Idempotent at the SAME clock: the replacement isn't missed yet → nothing new.
    expect(reconcileMissedShifts(shift.scheduledDay + 2, 12)).toHaveLength(0)
  })

  it('does not miss a shift still inside its window', () => {
    applyToCareer('delivery_driver', ctx(), 2, 8)
    const shift = getNextShift()!
    expect(reconcileMissedShifts(shift.scheduledDay, shift.startHour)).toHaveLength(0)
  })

  it('a duplicate progression event never double-awards XP through the funnel', () => {
    ingestCareerEvent({ id: 'z', kind: 'shift_completed', gameDay: 1, skillAwards: [{ skill: 'driving', amount: 10, reason: 'delivery_completed' }] })
    ingestCareerEvent({ id: 'z', kind: 'shift_completed', gameDay: 1, skillAwards: [{ skill: 'driving', amount: 10, reason: 'delivery_completed' }] })
    expect(careerRuntime.state.skills.driving).toBe(10)
  })
})

describe('atomic job switching + active-job ownership (§4, F1)', () => {
  beforeEach(() => resetCareers())

  it('switching to a new career drops the old career’s attendable shifts', () => {
    applyToCareer('delivery_driver', ctx(), 2, 8)
    const deliveryId = getNextShift()!.id
    ingestCareerEvent({ id: 's', kind: 'training_milestone', gameDay: 2, skillAwards: [{ skill: 'social', amount: 60, reason: 'training_milestone' }] })
    // Switch to café (eligible via the seeded Social).
    applyToCareer('cafe_retail', ctx({ activeJob: careerRuntime.state.activeJob, skills: careerRuntime.state.skills }), 2, 8)
    expect(careerRuntime.state.activeJob).toBe('cafe_retail')
    // The old delivery shift is gone; the next shift belongs to the current job only.
    const deliveryLeft = getScheduledShifts().filter((s) => s.careerId === 'delivery_driver' && (s.status === 'scheduled' || s.status === 'available'))
    expect(deliveryLeft).toHaveLength(0)
    expect(getNextShift()!.careerId).toBe('cafe_retail')
    expect(getNextShift()!.id).not.toBe(deliveryId)
    // Switching preserves the old career's rank + history.
    expect(careerRuntime.state.ranks.delivery_driver).toBe('trainee')
    expect(careerRuntime.state.history.delivery_driver).toBeDefined()
  })

  it('getNextShift only ever returns the ACTIVE job’s shifts', () => {
    applyToCareer('delivery_driver', ctx(), 2, 8)
    // A stray shift from another career left in the queue is never selected.
    careerRuntime.state = {
      ...careerRuntime.state,
      scheduledShifts: [
        ...careerRuntime.state.scheduledShifts,
        { id: 'stray:9', careerId: 'trade_worker', employerId: 'trade_crew', rank: 'trainee', templateId: 'trade_work', scheduledDay: 2, startHour: 9, graceHours: 3, durationHours: 4, workplaceInteractableId: 'shelf_depot', status: 'scheduled', attemptKey: 'att:9' },
      ],
    }
    expect(getNextShift()!.careerId).toBe('delivery_driver')
  })
})
