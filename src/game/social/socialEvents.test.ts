import { describe, expect, it } from 'vitest'
import { applySocialEvent, defaultSocialState, type SocialEvent } from './socialEvents'
import { deriveRelationship } from './relationship'

let n = 0
const ev = (over: Partial<SocialEvent>): SocialEvent => ({
  id: over.id ?? `ev${n++}`,
  kind: over.kind ?? 'conversation',
  actorId: over.actorId ?? 'npc_ravi_01',
  gameDay: over.gameDay ?? 1,
  ...over,
})

describe('social event pipeline — exact-once, memory, relationship, unlocks (§4)', () => {
  it('a first meeting raises familiarity, writes a pinned memory, and unlocks Ravi as a contact', () => {
    const r = applySocialEvent(defaultSocialState(), ev({ id: 'm1', kind: 'met', actorId: 'npc_ravi_01' }))
    expect(r.applied).toBe(true)
    expect(r.contactUnlocked).toBe(true)
    expect(r.state.contacts).toContain('npc_ravi_01')
    expect(r.state.relationships.npc_ravi_01.familiarity).toBe(35) // 20 default + 15
    const mem = r.state.memories.npc_ravi_01
    expect(mem).toHaveLength(1)
    expect(mem[0].kind).toBe('first_meeting')
    expect(mem[0].pinned).toBe(true)
    expect(mem[0].sourceEventId).toBe('m1')
  })

  it('is exact-once: re-delivering the same event id changes nothing', () => {
    const s1 = applySocialEvent(defaultSocialState(), ev({ id: 'dup', kind: 'gift_liked' })).state
    const r2 = applySocialEvent(s1, ev({ id: 'dup', kind: 'gift_liked' }))
    expect(r2.applied).toBe(false)
    expect(r2.state).toBe(s1) // untouched
    expect(s1.memories.npc_ravi_01).toHaveLength(1)
  })

  it('a completed favor raises trust and pins the memory', () => {
    const r = applySocialEvent(defaultSocialState(), ev({ id: 'f1', kind: 'favor_completed', actorId: 'npc_leo_01' }))
    expect(r.state.relationships.npc_leo_01.trust).toBe(15)
    expect(r.state.memories.npc_leo_01[0].pinned).toBe(true)
  })

  it('crime-witnessed fear scales with the NPC crime sensitivity (Kim >> Ravi)', () => {
    const kim = applySocialEvent(defaultSocialState(), ev({ id: 'c1', kind: 'crime_witnessed', actorId: 'npc_kim_01' }))
    const ravi = applySocialEvent(defaultSocialState(), ev({ id: 'c2', kind: 'crime_witnessed', actorId: 'npc_ravi_01' }))
    expect(kim.state.relationships.npc_kim_01.fear).toBeGreaterThan(ravi.state.relationships.npc_ravi_01.fear)
    expect(deriveRelationship(kim.state.relationships.npc_kim_01)).toBeDefined()
  })

  it('reinforcing memories (same kind, same day) dedupe instead of duplicating', () => {
    let s = defaultSocialState()
    s = applySocialEvent(s, ev({ id: 't1', kind: 'conversation', gameDay: 3 })).state
    s = applySocialEvent(s, ev({ id: 't2', kind: 'conversation', gameDay: 3 })).state
    expect(s.memories.npc_ravi_01).toHaveLength(1) // one memory, reinforced
    expect(s.appliedEventIds).toEqual(['t1', 't2']) // but BOTH events counted exactly once
    // Familiarity accrued from both distinct events.
    expect(s.relationships.npc_ravi_01.familiarity).toBe(28) // 20 + 4 + 4
  })

  it('a familiarity-gated contact (Maya) unlocks only once the threshold is crossed', () => {
    let s = defaultSocialState()
    const r1 = applySocialEvent(s, ev({ id: 'x1', kind: 'met', actorId: 'npc_maya_01' })) // +15 → 15, min 20
    expect(r1.contactUnlocked).toBe(false)
    s = r1.state
    const r2 = applySocialEvent(s, ev({ id: 'x2', kind: 'conversation', actorId: 'npc_maya_01' })) // +4 → 19
    expect(r2.contactUnlocked).toBe(false)
    s = r2.state
    const r3 = applySocialEvent(s, ev({ id: 'x3', kind: 'gift_liked', actorId: 'npc_maya_01' })) // +2 fam → 21 ≥ 20
    expect(r3.contactUnlocked).toBe(true)
    expect(r3.state.contacts).toContain('npc_maya_01')
  })

  it('an unknown actor is a safe no-op', () => {
    const r = applySocialEvent(defaultSocialState(), ev({ id: 'u1', actorId: 'npc_nobody' }))
    expect(r.applied).toBe(false)
    expect(r.state.memories).toEqual({})
  })
})
