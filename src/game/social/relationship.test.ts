import { describe, expect, it } from 'vitest'
import { applyRelationshipDelta, clampRelationship, defaultRelationship, deriveRelationship, relationshipTier } from './relationship'
import type { Relationship } from './socialTypes'

const rel = (over: Partial<Relationship> = {}): Relationship => ({ ...defaultRelationship(), ...over })

describe('relationship model — clamping + centralized mutation', () => {
  it('defaults to a never-met stranger', () => {
    expect(defaultRelationship()).toEqual({ familiarity: 0, affinity: 0, trust: 0, fear: 0, lastMeaningfulInteractionDay: -1 })
    expect(relationshipTier(defaultRelationship())).toBe('stranger')
  })

  it('clamps every dimension into its bounded integer range', () => {
    const c = clampRelationship({ familiarity: 999, affinity: -999, trust: 999, fear: -5, lastMeaningfulInteractionDay: 3.9 })
    expect(c).toEqual({ familiarity: 100, affinity: -100, trust: 100, fear: 0, lastMeaningfulInteractionDay: 3 })
  })

  it('applyRelationshipDelta clamps, stamps last-interaction day, and never mutates the input', () => {
    const base = rel({ affinity: 95 })
    const next = applyRelationshipDelta(base, { affinity: 20, trust: 10 }, 'favor_completed', 7)
    expect(next.affinity).toBe(100) // clamped
    expect(next.trust).toBe(10)
    expect(next.lastMeaningfulInteractionDay).toBe(7)
    expect(base.affinity).toBe(95) // input untouched
    expect(base.lastMeaningfulInteractionDay).toBe(-1)
  })

  it('decay does NOT stamp last-meaningful-interaction (it is not a moment together)', () => {
    const base = rel({ affinity: 40, lastMeaningfulInteractionDay: 2 })
    const next = applyRelationshipDelta(base, { affinity: -3 }, 'decay', 9)
    expect(next.affinity).toBe(37)
    expect(next.lastMeaningfulInteractionDay).toBe(2)
  })
})

describe('relationship tiers — derived purely from dimensions', () => {
  it('escalates stranger → acquaintance → friendly → trusted → close', () => {
    expect(relationshipTier(rel({ familiarity: 5 }))).toBe('stranger')
    expect(relationshipTier(rel({ familiarity: 20 }))).toBe('acquaintance')
    expect(relationshipTier(rel({ familiarity: 20, affinity: 30 }))).toBe('friendly')
    expect(relationshipTier(rel({ familiarity: 40, affinity: 30, trust: 50 }))).toBe('trusted')
    expect(relationshipTier(rel({ familiarity: 60, affinity: 70, trust: 50 }))).toBe('close')
  })

  it('represents "likes but does not trust" (friendly, not trusted)', () => {
    const d = deriveRelationship(rel({ familiarity: 40, affinity: 55, trust: 5 }))
    expect(d.tier).toBe('friendly')
  })

  it('hostile and afraid are orthogonal to warmth', () => {
    // Trusts the player but is upset/afraid (fear high, affinity still positive) → afraid, not hostile.
    const upset = deriveRelationship(rel({ familiarity: 50, affinity: 30, trust: 50, fear: 70 }))
    expect(upset.afraid).toBe(true)
    expect(upset.hostile).toBe(false)
    // Fears AND dislikes → actively hostile.
    const harmed = deriveRelationship(rel({ familiarity: 50, affinity: -40, fear: 80 }))
    expect(harmed.hostile).toBe(true)
    expect(harmed.afraid).toBe(false)
    // Neutral acquaintance: neither.
    const neutral = deriveRelationship(rel({ familiarity: 30 }))
    expect(neutral.hostile).toBe(false)
    expect(neutral.afraid).toBe(false)
  })
})
