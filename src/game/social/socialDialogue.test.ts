import { describe, expect, it } from 'vitest'
import { memorySummary, socialActionResponse, socialGreeting } from './socialDialogue'
import { getSocialActor } from './socialActors'
import type { DerivedRelationship, MemoryEntry, SocialActor } from './socialTypes'

const ravi = getSocialActor('npc_ravi_01') as SocialActor
const derived = (over: Partial<DerivedRelationship> = {}): DerivedRelationship => ({ tier: 'stranger', hostile: false, afraid: false, ...over })

describe('socialGreeting — expresses state, deterministic, no logic (§2)', () => {
  it('is deterministic for the same inputs (never random)', () => {
    const a = socialGreeting(ravi, derived({ tier: 'friendly' }), undefined, 3)
    const b = socialGreeting(ravi, derived({ tier: 'friendly' }), undefined, 3)
    expect(a).toBe(b)
  })

  it('reflects hostility and fear before warmth', () => {
    expect(socialGreeting(ravi, derived({ hostile: true }), undefined, 1)).toMatch(/glares|won't even/i)
    expect(socialGreeting(ravi, derived({ afraid: true }), undefined, 1)).toMatch(/nervous|wary/i)
  })

  it('warms with the tier', () => {
    expect(socialGreeting(ravi, derived({ tier: 'stranger' }), undefined, 1)).toMatch(/nod|unsure/i)
    expect(socialGreeting(ravi, derived({ tier: 'close' }), undefined, 1)).toMatch(/favorite|better when you're around/i)
  })

  it('nods to the most salient memory when present', () => {
    const mem: MemoryEntry = {
      id: 'm', npcId: ravi.id, kind: 'gift_given', gameDay: 1, salience: 40, valence: 1,
      sourceEventId: 'e', pinned: false, summaryToken: 'gift_liked',
    }
    expect(socialGreeting(ravi, derived({ tier: 'friendly' }), mem, 1)).toMatch(/thanks again for that gift/i)
  })
})

describe('socialActionResponse — one line per response token', () => {
  it('covers every response token deterministically', () => {
    for (const token of ['talk', 'check_in', 'gift_liked', 'gift_neutral', 'gift_disliked', 'favor_accepted', 'favor_refused', 'apology_accepted', 'apology_rejected', 'threatened', 'unavailable'] as const) {
      const line = socialActionResponse(ravi, token, 2)
      expect(line.length).toBeGreaterThan(0)
      expect(socialActionResponse(ravi, token, 2)).toBe(line) // deterministic
    }
  })

  it('a disliked gift reads negative, a liked gift reads positive', () => {
    expect(socialActionResponse(ravi, 'gift_disliked', 1)).toMatch(/isn't my thing|why would you/i)
    expect(socialActionResponse(ravi, 'gift_liked', 1)).toMatch(/best|love|perfect/i)
  })
})

describe('memorySummary — human phrase per summary token', () => {
  it('maps known tokens and falls back to the raw token', () => {
    expect(memorySummary('first_meeting')).toMatch(/first met/i)
    expect(memorySummary('threatened')).toMatch(/threatened/i)
    expect(memorySummary('totally_unknown_token')).toBe('totally_unknown_token')
  })
})
