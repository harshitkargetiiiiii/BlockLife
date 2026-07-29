import { describe, expect, it } from 'vitest'
import { allCareers, entryRank, getCareer, getRank, isCareerId, nextRank, validateCareerRegistry } from './careerRegistry'
import { CAREER_IDS, RANK_ORDER } from './careerTypes'
import { isSocialActor } from '../social/socialActors'

describe('career registry — canonical, validated, stable ids (§1)', () => {
  it('validates with zero problems', () => {
    expect(validateCareerRegistry()).toEqual([])
  })

  it('ships the four required careers', () => {
    const ids = allCareers().map((c) => c.id).sort()
    expect(ids).toEqual(['cafe_retail', 'delivery_driver', 'gym_trainer', 'trade_worker'])
    expect(CAREER_IDS.length).toBe(4)
  })

  it('every career has the four ranks in order with rising pay', () => {
    for (const c of allCareers()) {
      expect(c.ranks.map((r) => r.id)).toEqual([...RANK_ORDER])
      for (let i = 1; i < c.ranks.length; i++) {
        expect(c.ranks[i].payModifier).toBeGreaterThan(c.ranks[i - 1].payModifier)
        expect(c.ranks[i].promotion).toBeDefined()
      }
      expect(c.ranks[0].promotion).toBeUndefined() // entry rank
    }
  })

  it('every career ships at least one immediate visible unlock', () => {
    for (const c of allCareers()) {
      const unlocks = c.ranks.flatMap((r) => r.unlocks)
      expect(unlocks.length).toBeGreaterThan(0)
      // The first promotion (regular) grants a visible benefit right away.
      expect(getRank(c.id, 'regular')!.unlocks.length).toBeGreaterThan(0)
    }
  })

  it('employer NPCs are real social actors (no duplicate identities, §10)', () => {
    const withActors = allCareers().filter((c) => c.employerActorId)
    expect(withActors.length).toBeGreaterThanOrEqual(2) // ≥2 existing named NPCs as employers
    for (const c of withActors) expect(isSocialActor(c.employerActorId!)).toBe(true)
  })

  it('exactly one career is the lenient (comparatively accessible) path, ≥1 is strict', () => {
    expect(allCareers().filter((c) => c.lenientCrime).length).toBe(1)
    expect(allCareers().some((c) => c.maxWantedToStart === 0)).toBe(true) // stricter career
  })

  it('at least one career relaxes entry via a social recommendation (§3)', () => {
    expect(allCareers().some((c) => c.entry.recommendationRelaxesFrom)).toBe(true)
  })

  it('rank navigation helpers are consistent', () => {
    expect(entryRank('delivery_driver').id).toBe('trainee')
    expect(nextRank('delivery_driver', 'trainee')!.id).toBe('regular')
    expect(nextRank('delivery_driver', 'senior')).toBeUndefined()
    expect(isCareerId('gym_trainer')).toBe(true)
    expect(isCareerId('astronaut')).toBe(false)
    expect(getCareer('cafe_retail')!.employerActorId).toBe('npc_maya_01')
  })
})
