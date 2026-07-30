import { beforeEach, describe, expect, it } from 'vitest'
import { careerRuntime, resetCareers } from '../careers/careerRuntime'
import type { ShiftResultRecord } from '../careers/careerTypes'
import { resetHousing, tourProperty } from './housingRuntime'
import { highestCareerRank, housingEligibility, housingRecentCareerIncome } from './housingCareer'

function result(day: number, pay: number): ShiftResultRecord {
  return {
    careerId: 'delivery_driver',
    shiftId: `s${day}`,
    reason: 'completed',
    score: 80,
    breakdown: { attendance: 100, requiredObjectives: 100, optionalObjectives: 0, mistakes: 0, timeEfficiency: 80 },
    notes: [],
    onTime: true,
    base: 40,
    rankModifier: 1.3,
    performanceModifier: 1,
    pay,
    day,
  }
}

describe('housing career adapter', () => {
  beforeEach(() => {
    resetCareers()
    resetHousing(0)
  })

  it('reads the highest rank across current ranks and history', () => {
    expect(highestCareerRank()).toBeNull()
    careerRuntime.state.ranks = { delivery_driver: 'regular' }
    expect(highestCareerRank()).toBe('regular')
    careerRuntime.state.history = {
      gym_trainer: { careerId: 'gym_trainer', completedShifts: 0, missedShifts: 0, failedShifts: 0, highestRank: 'experienced', totalEarned: 0 },
    }
    expect(highestCareerRank()).toBe('experienced')
  })

  it('sums recent verified career income within the window', () => {
    careerRuntime.state.recentResults = [result(2, 100), result(6, 120)]
    expect(housingRecentCareerIncome(8, 7)).toBe(220) // both within 7 days of day 8
    expect(housingRecentCareerIncome(20, 7)).toBe(0) // both outside the window
  })

  it('gates the loft on rank then tour', () => {
    expect(housingEligibility('city_loft', 1).firstUnmetReason).toContain('Regular rank')
    careerRuntime.state.ranks = { delivery_driver: 'regular' }
    expect(housingEligibility('city_loft', 1).firstUnmetReason).toContain('Tour')
    tourProperty('city_loft')
    expect(housingEligibility('city_loft', 1).eligible).toBe(true)
  })

  it('gates the premium on experienced rank + recent income', () => {
    expect(housingEligibility('premium_apartment', 1).firstUnmetReason).toContain('Experienced')
    careerRuntime.state.ranks = { delivery_driver: 'experienced' }
    expect(housingEligibility('premium_apartment', 1).firstUnmetReason).toContain('verified career income')
    careerRuntime.state.recentResults = [result(1, 300)]
    tourProperty('premium_apartment')
    expect(housingEligibility('premium_apartment', 1).eligible).toBe(true)
  })

  it('always allows the starter regardless of career state', () => {
    expect(housingEligibility('starter_studio', 1).eligible).toBe(true)
  })
})
