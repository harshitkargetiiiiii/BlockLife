import { beforeEach, describe, expect, it } from 'vitest'
import { notePlayerEscaped, notePlayerTrained, noteSocialActivityCompleted } from './careerLifeEvents'
import { careerRuntime, getSkillXp, resetCareers } from './careerRuntime'
import { SKILL_DAILY_CAP } from './careerTypes'

/**
 * Non-shift skill sources (issue #15 §2, F7) — the production adapters that turn gym
 * workouts, social activities and police evasions into capped, exact-once skill XP.
 */
describe('careerLifeEvents — capped, exact-once non-shift XP (F7)', () => {
  beforeEach(() => resetCareers())

  it('a gym workout builds Fitness and is capped per day', () => {
    const before = getSkillXp('fitness')
    notePlayerTrained(0, 9)
    expect(getSkillXp('fitness')).toBeGreaterThan(before)
    // Hammer many workouts in one day; total gained never exceeds the daily cap.
    for (let i = 0; i < 40; i++) notePlayerTrained(0, 9 + i * 0.01)
    expect(getSkillXp('fitness') - before).toBeLessThanOrEqual(SKILL_DAILY_CAP.gym_workout!)
    // A NEW day resets the bucket → more can be earned.
    const dayOne = getSkillXp('fitness')
    notePlayerTrained(1, 9)
    expect(getSkillXp('fitness')).toBeGreaterThan(dayOne)
  })

  it('a completed social activity builds Social, exact-once on the activity id', () => {
    const before = getSkillXp('social')
    noteSocialActivityCompleted('act_1', 0, 12)
    const after = getSkillXp('social')
    expect(after).toBeGreaterThan(before)
    noteSocialActivityCompleted('act_1', 0, 12) // same activity → no re-award
    expect(getSkillXp('social')).toBe(after)
  })

  it('shaking the police builds Street Smarts, exact-once per evasion + capped', () => {
    const before = getSkillXp('street_smarts')
    notePlayerEscaped(1, 0, 20)
    expect(getSkillXp('street_smarts')).toBeGreaterThan(before)
    notePlayerEscaped(1, 0, 20) // same evasion seq → no re-award
    const once = getSkillXp('street_smarts')
    notePlayerEscaped(1, 0, 20)
    expect(getSkillXp('street_smarts')).toBe(once)
    // Many escapes in one day are capped.
    for (let seq = 2; seq < 30; seq++) notePlayerEscaped(seq, 0, 20)
    expect(getSkillXp('street_smarts') - before).toBeLessThanOrEqual(SKILL_DAILY_CAP.crime_escaped!)
  })

  it('these adapters never touch employment/shifts — only the skill funnel', () => {
    notePlayerTrained(0, 9)
    noteSocialActivityCompleted('a', 0, 9)
    notePlayerEscaped(1, 0, 9)
    expect(careerRuntime.state.activeJob).toBeNull()
    expect(careerRuntime.state.scheduledShifts).toHaveLength(0)
  })
})
