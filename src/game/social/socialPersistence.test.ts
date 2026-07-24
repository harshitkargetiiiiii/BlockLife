import { beforeEach, describe, expect, it } from 'vitest'
import { applySocialSave, sanitizeSocialSave, serializeSocial } from './socialPersistence'
import { ingestSocialEvent, resetSocial, socialRuntime, getRelationship, getContacts, getMessages, getInvitations, reconcileOutreach } from './socialRuntime'
import { defaultSocialState, type SocialEvent } from './socialEvents'

let n = 0
const ev = (over: Partial<SocialEvent>): SocialEvent => ({ id: over.id ?? `e${n++}`, kind: over.kind ?? 'conversation', actorId: over.actorId ?? 'npc_ravi_01', gameDay: over.gameDay ?? 1, ...over })

describe('social persistence — additive, fail-safe, round-trip (§12)', () => {
  beforeEach(() => resetSocial())

  it('round-trips relationships, memories, contacts, and exact-once ids', () => {
    ingestSocialEvent(ev({ id: 'a', kind: 'met', actorId: 'npc_ravi_01' }))
    ingestSocialEvent(ev({ id: 'b', kind: 'favor_completed', actorId: 'npc_leo_01' }))
    const saved = serializeSocial()

    resetSocial()
    expect(getContacts()).toHaveLength(0)
    applySocialSave(saved)
    expect(getContacts()).toContain('npc_ravi_01')
    expect(getRelationship('npc_leo_01').trust).toBe(15)
    expect(socialRuntime.state.appliedEventIds).toEqual(['a', 'b'])
  })

  it('round-trips phone messages, invitations, and outreach cooldowns (Slice 3)', () => {
    ingestSocialEvent(ev({ id: 'met', kind: 'met', actorId: 'npc_ravi_01', gameDay: 1 }))
    reconcileOutreach(4, 9) // Ravi texts + invites
    expect(getMessages('npc_ravi_01').length).toBeGreaterThan(0)
    expect(getInvitations().length).toBeGreaterThan(0)
    const saved = serializeSocial()

    resetSocial()
    expect(getMessages('npc_ravi_01')).toHaveLength(0)
    expect(getInvitations()).toHaveLength(0)
    applySocialSave(saved)
    expect(getMessages('npc_ravi_01').length).toBeGreaterThan(0)
    expect(getInvitations().length).toBeGreaterThan(0)
    expect(socialRuntime.state.lastInitiatedDay['npc_ravi_01']).toBe(4)
  })

  it('an old save (no social field) resets to canonical strangers', () => {
    ingestSocialEvent(ev({ id: 'a', kind: 'met' }))
    applySocialSave(undefined)
    expect(getContacts()).toHaveLength(0)
    expect(socialRuntime.state.appliedEventIds).toHaveLength(0)
  })

  it('sanitizes malformed data field-by-field without corrupting the whole save', () => {
    const clean = sanitizeSocialSave({
      version: 1,
      relationships: {
        npc_ravi_01: { familiarity: 999, affinity: 'nope', trust: 40, fear: -5, lastMeaningfulInteractionDay: 2 },
        npc_ghost: { familiarity: 50 }, // not a real actor → dropped
      },
      memories: {
        npc_ravi_01: [{ id: 'm1', kind: 'gift_given', sourceEventId: 'e1', salience: 300 }],
        npc_ghost: [{ id: 'x', kind: 'conversation', sourceEventId: 'e2' }], // dropped
      },
      contacts: ['npc_ravi_01', 'npc_ghost', 42, 'npc_ravi_01'],
      appliedEventIds: ['e1', 5, 'e2'],
    })
    expect(clean.relationships.npc_ravi_01.familiarity).toBe(100) // clamped
    expect(clean.relationships.npc_ravi_01.affinity).toBe(0) // invalid → default
    expect(clean.relationships.npc_ghost).toBeUndefined()
    expect(clean.memories.npc_ghost).toBeUndefined()
    expect(clean.memories.npc_ravi_01[0].salience).toBe(100)
    expect(clean.contacts).toEqual(['npc_ravi_01']) // deduped, unknown/non-string dropped
    expect(clean.appliedEventIds).toEqual(['e1', 'e2'])
  })

  it('garbage save data yields a valid empty state (never throws)', () => {
    expect(sanitizeSocialSave(null)).toEqual(defaultSocialState())
    expect(sanitizeSocialSave('nope')).toEqual(defaultSocialState())
  })
})
