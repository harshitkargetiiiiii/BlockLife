import { describe, expect, it } from 'vitest'
import { applySkillAward, applySkillAwards, clampXp, defaultSkills, pruneSkillLedger, sanitizeSkills, skillLevel, skillProgress, topSkillLevel } from './skills'
import { SKILL_XP_MAX } from './careerTypes'

describe('skill XP bounds + derived levels (§2)', () => {
  it('clamps XP to the integer range', () => {
    expect(clampXp(-5)).toBe(0)
    expect(clampXp(10.9)).toBe(10)
    expect(clampXp(99999)).toBe(SKILL_XP_MAX)
    expect(clampXp(NaN)).toBe(0)
  })

  it('derives a monotonic 0–10 level from the threshold table', () => {
    expect(skillLevel(0)).toBe(0)
    expect(skillLevel(19)).toBe(0)
    expect(skillLevel(20)).toBe(1)
    expect(skillLevel(200)).toBe(5)
    expect(skillLevel(SKILL_XP_MAX)).toBe(10)
    // Monotonic: more XP never lowers the level.
    let prev = 0
    for (let xp = 0; xp <= SKILL_XP_MAX; xp += 25) {
      const l = skillLevel(xp)
      expect(l).toBeGreaterThanOrEqual(prev)
      prev = l
    }
  })

  it('reports progress toward the next level, flat at max', () => {
    const p = skillProgress(20)
    expect(p.level).toBe(1)
    expect(p.into).toBe(0)
    expect(p.span).toBe(30) // 50 - 20
    expect(skillProgress(SKILL_XP_MAX).atMax).toBe(true)
  })
})

describe('applySkillAward — bounded, capped, idempotent-friendly (§2)', () => {
  it('adds XP up to the ceiling', () => {
    const r = applySkillAward(defaultSkills(), {}, { skill: 'driving', amount: 30, reason: 'delivery_completed' }, 1)
    expect(r.skills.driving).toBe(30)
    expect(r.grantedAmount).toBe(30)
  })

  it('never exceeds the XP ceiling', () => {
    const near = { ...defaultSkills(), fitness: SKILL_XP_MAX - 5 }
    const r = applySkillAward(near, {}, { skill: 'fitness', amount: 50, reason: 'training_milestone' }, 1)
    expect(r.skills.fitness).toBe(SKILL_XP_MAX)
    expect(r.grantedAmount).toBe(5)
  })

  it('enforces per-source daily caps (anti-farming)', () => {
    let skills = defaultSkills()
    let ledger = {}
    let total = 0
    for (let i = 0; i < 10; i++) {
      const r = applySkillAward(skills, ledger, { skill: 'street_smarts', amount: 5, reason: 'crime_escaped' }, 3)
      skills = r.skills
      ledger = r.ledger
      total += r.grantedAmount
    }
    // crime_escaped daily cap is 12 → only 12 XP granted no matter how many attempts.
    expect(total).toBe(12)
    expect(skills.street_smarts).toBe(12)
    // A NEW day resets the bucket.
    const nextDay = applySkillAward(skills, ledger, { skill: 'street_smarts', amount: 5, reason: 'crime_escaped' }, 4)
    expect(nextDay.grantedAmount).toBe(5)
  })

  it('uncapped reasons (shift work) are not throttled', () => {
    let skills = defaultSkills()
    let ledger = {}
    for (let i = 0; i < 5; i++) {
      const r = applySkillAward(skills, ledger, { skill: 'work_ethic', amount: 20, reason: 'shift_completed' }, 1)
      skills = r.skills
      ledger = r.ledger
    }
    expect(skills.work_ethic).toBe(100)
  })

  it('drops unknown skills + zero/negative amounts', () => {
    const r = applySkillAward(defaultSkills(), {}, { skill: 'driving', amount: 0, reason: 'shift_completed' }, 1)
    expect(r.grantedAmount).toBe(0)
    // @ts-expect-error — intentionally invalid skill id at runtime
    const bad = applySkillAward(defaultSkills(), {}, { skill: 'nope', amount: 10, reason: 'shift_completed' }, 1)
    expect(bad.grantedAmount).toBe(0)
  })

  it('applies a batch in order + prunes the stale ledger', () => {
    const r = applySkillAwards(defaultSkills(), {}, [
      { skill: 'driving', amount: 10, reason: 'delivery_completed' },
      { skill: 'work_ethic', amount: 15, reason: 'shift_on_time' },
    ], 2)
    expect(r.skills.driving).toBe(10)
    expect(r.skills.work_ethic).toBe(15)
    const pruned = pruneSkillLedger({ '1:crime_escaped': 12, '9:crime_escaped': 3 }, 10)
    expect(pruned['1:crime_escaped']).toBeUndefined() // day 1 dropped (older than keepDays)
    expect(pruned['9:crime_escaped']).toBe(3)
  })
})

describe('sanitizeSkills — field-by-field, drops junk', () => {
  it('clamps + drops unknown skills', () => {
    const s = sanitizeSkills({ fitness: 9999, driving: -3, bogus: 50, social: 'nope' })
    expect(s.fitness).toBe(SKILL_XP_MAX)
    expect(s.driving).toBe(0)
    expect(s.social).toBe(0)
    expect((s as Record<string, number>).bogus).toBeUndefined()
    expect(sanitizeSkills(null)).toEqual(defaultSkills())
  })

  it('topSkillLevel summarizes the highest level', () => {
    expect(topSkillLevel({ ...defaultSkills(), fitness: 200 })).toBe(5)
  })
})
