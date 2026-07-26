import { beforeEach, describe, expect, it } from 'vitest'
import { applyCareerEvent, defaultCareerState, type CareerEvent } from './careerEvents'
import { ingestCareerEvent, getSkillLevel, getSkillXp, resetCareers, careerSnapshot } from './careerRuntime'
import { APPLIED_CAREER_EVENT_ID_MAX } from './careerTypes'

const ev = (over: Partial<CareerEvent> & Pick<CareerEvent, 'id'>): CareerEvent => ({
  kind: 'shift_completed',
  gameDay: 1,
  skillAwards: [{ skill: 'work_ethic', amount: 20, reason: 'shift_completed' }],
  ...over,
})

describe('career event pipeline — exact-once XP funnel (§1/§2)', () => {
  beforeEach(() => resetCareers())

  it('applies an event once and awards the skill XP', () => {
    const r = ingestCareerEvent(ev({ id: 'e1' }))
    expect(r.applied).toBe(true)
    expect(r.grantedXp).toBe(20)
    expect(getSkillXp('work_ethic')).toBe(20)
    expect(getSkillLevel('work_ethic')).toBe(1)
  })

  it('a duplicate id is a no-op (reload / repeated adapter never double-awards)', () => {
    ingestCareerEvent(ev({ id: 'dup' }))
    const again = ingestCareerEvent(ev({ id: 'dup' }))
    expect(again.applied).toBe(false)
    expect(again.grantedXp).toBe(0)
    expect(getSkillXp('work_ethic')).toBe(20) // not 40
  })

  it('multi-skill awards on one event all apply', () => {
    ingestCareerEvent(ev({ id: 'multi', skillAwards: [
      { skill: 'driving', amount: 15, reason: 'delivery_completed' },
      { skill: 'work_ethic', amount: 10, reason: 'shift_on_time' },
    ] }))
    expect(getSkillXp('driving')).toBe(15)
    expect(getSkillXp('work_ethic')).toBe(10)
  })

  it('bounds the applied-id ledger (no unbounded growth)', () => {
    for (let i = 0; i < APPLIED_CAREER_EVENT_ID_MAX + 40; i++) {
      ingestCareerEvent(ev({ id: `bulk_${i}`, skillAwards: [] }))
    }
    expect(careerSnapshot().appliedEventCount).toBeLessThanOrEqual(APPLIED_CAREER_EVENT_ID_MAX)
  })

  it('pure applyCareerEvent does not mutate the previous state', () => {
    const s0 = defaultCareerState()
    const r = applyCareerEvent(s0, ev({ id: 'pure' }))
    expect(s0.skills.work_ethic).toBe(0) // untouched
    expect(r.state.skills.work_ethic).toBe(20)
  })

  it('snapshot reports skills, ledgers, and reload-safe counter', () => {
    ingestCareerEvent(ev({ id: 'snap' }))
    const snap = careerSnapshot()
    expect(snap.skills.work_ethic.level).toBe(1)
    expect(snap.appliedEventCount).toBe(1)
    expect(snap.activeJob).toBeNull()
    expect(snap.shiftSeq).toBe(0)
  })
})
