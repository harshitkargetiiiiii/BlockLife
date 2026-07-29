import { describe, expect, it } from 'vitest'
import { evaluatePromotion, promoteIfEligible, recentPerformance } from './careerPromotion'
import { getCareer } from './careerRegistry'
import { defaultCareerState, type CareerState } from './careerEvents'

const delivery = getCareer('delivery_driver')! // regular: 3 shifts, driving 2, perf 55, missed ≤2

function stateWith(over: Partial<CareerState> = {}): CareerState {
  return { ...defaultCareerState(), ranks: { delivery_driver: 'trainee' }, ...over }
}

describe('promotion service — deterministic, requirement-gated (§8)', () => {
  it('reports each requirement and is not met when short', () => {
    const p = evaluatePromotion(stateWith(), delivery)
    expect(p.nextRank!.id).toBe('regular')
    expect(p.met).toBe(false)
    expect(p.rows.some((r) => r.label === 'Completed shifts' && !r.ok)).toBe(true)
  })

  it('recent performance averages the last few shifts of the career', () => {
    const s = stateWith({ performanceHistory: [
      { careerId: 'delivery_driver', shiftId: 'a', score: 60, onTime: true, day: 1 },
      { careerId: 'delivery_driver', shiftId: 'b', score: 80, onTime: true, day: 2 },
    ] })
    expect(recentPerformance(s, 'delivery_driver')).toBe(70)
  })

  it('promotes exactly when every requirement is met, granting the rank + unlock once', () => {
    const ready = stateWith({
      skills: { ...defaultCareerState().skills, driving: 60 }, // level 2
      history: { delivery_driver: { careerId: 'delivery_driver', completedShifts: 3, missedShifts: 0, failedShifts: 0, highestRank: 'trainee', totalEarned: 0 } },
      performanceHistory: [{ careerId: 'delivery_driver', shiftId: 'a', score: 70, onTime: true, day: 1 }],
    })
    expect(evaluatePromotion(ready, delivery).met).toBe(true)
    const res = promoteIfEligible(ready, delivery)
    expect(res.promotedTo!.id).toBe('regular')
    expect(res.unlocks.map((u) => u.id)).toContain('delivery_thermal_bag')
    expect(res.state.ranks.delivery_driver).toBe('regular')
    expect(res.state.history.delivery_driver!.highestRank).toBe('regular')
    // Idempotent: promoting again from the new rank needs the NEXT rank's (unmet) reqs.
    const again = promoteIfEligible(res.state, delivery)
    expect(again.promotedTo).toBeNull()
  })

  it('too many missed shifts blocks promotion even with the work + skills done', () => {
    const blocked = stateWith({
      skills: { ...defaultCareerState().skills, driving: 60 },
      history: { delivery_driver: { careerId: 'delivery_driver', completedShifts: 5, missedShifts: 9, failedShifts: 0, highestRank: 'trainee', totalEarned: 0 } },
      performanceHistory: [{ careerId: 'delivery_driver', shiftId: 'a', score: 90, onTime: true, day: 1 }],
    })
    expect(evaluatePromotion(blocked, delivery).met).toBe(false)
    expect(promoteIfEligible(blocked, delivery).promotedTo).toBeNull()
  })
})
