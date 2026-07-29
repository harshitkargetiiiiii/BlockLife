import { beforeEach, describe, expect, it } from 'vitest'
import { notifyHired, notifyPromoted, notifyShiftOutcome, reconcileEarnedRecommendations } from './careerSocial'
import { hasRecommendation, resetCareers } from './careerRuntime'
import { getMessages, getMemories, getDerivedRelationship, ingestSocialEvent, resetSocial } from '../social/socialRuntime'

describe('career → social adapter — typed, exact-once, reuses the social authority (§10)', () => {
  beforeEach(() => {
    resetSocial()
    resetCareers()
  })

  it('a hire posts an employer welcome message (named-actor employer only)', () => {
    notifyHired('cafe_retail', 1, 9) // Maya
    expect(getMessages('npc_maya_01').some((m) => m.token === 'job_hired')).toBe(true)
    // A no-named-actor employer (delivery dispatch) posts nothing.
    notifyHired('delivery_driver', 1, 9)
    expect(getMessages('npc_maya_01').length).toBe(1)
  })

  it('a promotion posts a message + a positive employer memory', () => {
    notifyPromoted('gym_trainer', 'regular', 2, 10) // Coach Bruno
    expect(getMessages('npc_bruno_01').some((m) => m.token === 'job_promoted')).toBe(true)
    expect(getMemories('npc_bruno_01').length).toBeGreaterThan(0)
  })

  it('a strong shift praises + remembers; a missed shift nudges + a no_show memory', () => {
    notifyShiftOutcome('cafe_retail', 'completed', 90, 'shift:1', 3, 11)
    expect(getMessages('npc_maya_01').some((m) => m.token === 'job_good_shift')).toBe(true)
    notifyShiftOutcome('cafe_retail', 'missed', 0, 'shift:2', 4, 12)
    expect(getMessages('npc_maya_01').some((m) => m.token === 'job_missed_shift')).toBe(true)
    expect(getMemories('npc_maya_01').some((m) => m.kind === 'no_show')).toBe(true)
    // Exact-once: replaying the same shift outcome never double-posts.
    const before = getMessages('npc_maya_01').length
    notifyShiftOutcome('cafe_retail', 'completed', 90, 'shift:1', 3, 11)
    expect(getMessages('npc_maya_01').length).toBe(before)
  })

  it('a warm employer relationship earns a recommendation that relaxes entry (§3/§10)', () => {
    // Build a friendly relationship with Coach Bruno.
    ingestSocialEvent({ id: 'm', kind: 'met', actorId: 'npc_bruno_01', gameDay: 1, gameHour: 9 })
    for (let i = 0; i < 4; i++) ingestSocialEvent({ id: `f${i}`, kind: 'favor_completed', actorId: 'npc_bruno_01', gameDay: 1, gameHour: 9 })
    expect(['friendly', 'trusted', 'close']).toContain(getDerivedRelationship('npc_bruno_01').tier)

    const earned = reconcileEarnedRecommendations(1, 10)
    expect(earned).toContain('gym_trainer')
    expect(hasRecommendation('bruno_gym')).toBe(true)
    expect(getMessages('npc_bruno_01').some((m) => m.token === 'job_recommendation')).toBe(true)
    // Idempotent — a second pass earns nothing new.
    expect(reconcileEarnedRecommendations(1, 11)).toHaveLength(0)
  })
})
