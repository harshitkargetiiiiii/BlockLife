import { describe, expect, it } from 'vitest'
import type { ShiftResultRecord } from '../careers/careerTypes'
import { propertyEligibility, rankAtLeast, recentCareerIncome } from './eligibility'
import { getProperty } from './propertyRegistry'

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

const LOFT = getProperty('city_loft')!
const PREMIUM = getProperty('premium_apartment')!
const STARTER = getProperty('starter_studio')!

describe('housing eligibility', () => {
  it('ranks ordinally', () => {
    expect(rankAtLeast('regular', 'regular')).toBe(true)
    expect(rankAtLeast('experienced', 'regular')).toBe(true)
    expect(rankAtLeast('trainee', 'regular')).toBe(false)
    expect(rankAtLeast(null, 'regular')).toBe(false)
  })

  it('sums verified career income only within the window', () => {
    const results = [result(1, 100), result(5, 120), result(9, 90)]
    // Window of 7 days from day 10 → cutoff day 3 → days 5 and 9 count (210).
    expect(recentCareerIncome(results, 10, 7)).toBe(210)
    // Everything within range.
    expect(recentCareerIncome(results, 9, 30)).toBe(310)
  })

  it('always allows the starter (no requirements)', () => {
    const r = propertyEligibility(STARTER, { highestRankAny: null, recentCareerIncome: 0, toured: false })
    expect(r.eligible).toBe(true)
  })

  it('reports the rank requirement first for the loft', () => {
    const r = propertyEligibility(LOFT, { highestRankAny: 'trainee', recentCareerIncome: 999, toured: true })
    expect(r.eligible).toBe(false)
    expect(r.firstUnmetReason).toContain('Regular rank')
  })

  it('asks for a tour once the loft rank is met', () => {
    const notToured = propertyEligibility(LOFT, { highestRankAny: 'regular', recentCareerIncome: 0, toured: false })
    expect(notToured.firstUnmetReason).toContain('Tour this property')
    const toured = propertyEligibility(LOFT, { highestRankAny: 'regular', recentCareerIncome: 0, toured: true })
    expect(toured.eligible).toBe(true)
  })

  it('checks premium rank → income → tour in order', () => {
    const badRank = propertyEligibility(PREMIUM, { highestRankAny: 'regular', recentCareerIncome: 9999, toured: true })
    expect(badRank.firstUnmetReason).toContain('Experienced rank')
    const badIncome = propertyEligibility(PREMIUM, { highestRankAny: 'experienced', recentCareerIncome: 100, toured: true })
    expect(badIncome.firstUnmetReason).toContain('verified career income')
    const needsTour = propertyEligibility(PREMIUM, { highestRankAny: 'experienced', recentCareerIncome: 400, toured: false })
    expect(needsTour.firstUnmetReason).toContain('Tour this property')
    const ok = propertyEligibility(PREMIUM, { highestRankAny: 'experienced', recentCareerIncome: 400, toured: true })
    expect(ok.eligible).toBe(true)
  })

  it('lets a trusted recommendation relax the tour requirement but not money/rank', () => {
    const relaxed = propertyEligibility(PREMIUM, {
      highestRankAny: 'experienced',
      recentCareerIncome: 400,
      toured: false,
      recommendationRelaxesTour: true,
    })
    expect(relaxed.eligible).toBe(true)
    // A recommendation never satisfies the income gate.
    const stillPoor = propertyEligibility(PREMIUM, {
      highestRankAny: 'experienced',
      recentCareerIncome: 10,
      toured: false,
      recommendationRelaxesTour: true,
    })
    expect(stillPoor.eligible).toBe(false)
    expect(stillPoor.firstUnmetReason).toContain('verified career income')
  })
})
