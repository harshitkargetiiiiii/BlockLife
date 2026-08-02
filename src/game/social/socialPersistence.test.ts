import { beforeEach, describe, expect, it } from 'vitest'
import { applySocialSave, sanitizeSocialSave, serializeSocial } from './socialPersistence'
import { ingestSocialEvent, resetSocial, socialRuntime, getRelationship, getContacts, getMessages, getInvitations, reconcileOutreach, sendPlayerInvite } from './socialRuntime'
import { defaultSocialState, type SocialEvent } from './socialEvents'
import { INVITATION_ACTIVITY_KINDS, isInvitationActivityKind } from './socialTypes'

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

  it('persists the message-id counter so a reload cannot mint duplicate ids (PR#14)', () => {
    ingestSocialEvent(ev({ id: 'met', kind: 'met', actorId: 'npc_ravi_01', gameDay: 1 }))
    sendPlayerInvite('npc_ravi_01', 2, 10) // posts messages → bumps msgSeq
    const seqAfter = socialRuntime.state.msgSeq
    expect(seqAfter).toBeGreaterThan(0)
    const saved = serializeSocial()
    expect(saved.msgSeq).toBe(seqAfter)

    // Simulate a full reload: the module resets, then loads the save back.
    resetSocial()
    expect(socialRuntime.state.msgSeq).toBe(0)
    applySocialSave(saved)
    expect(socialRuntime.state.msgSeq).toBe(seqAfter) // restored, NOT reset to 0

    // A brand-new message after the reload cannot collide with a loaded one.
    const ids = new Set(getMessages('npc_ravi_01').map((m) => m.id))
    sendPlayerInvite('npc_ravi_01', 3, 10)
    const all = getMessages('npc_ravi_01').map((m) => m.id)
    expect(new Set(all).size).toBe(all.length) // every id unique
    expect(all.filter((id) => ids.has(id)).length).toBe(ids.size) // old ids preserved
  })

  it('the canonical invitation-kind validator covers all nine kinds incl. the home + drive-around kinds', () => {
    expect(INVITATION_ACTIVITY_KINDS).toHaveLength(9)
    for (const k of ['coffee', 'food', 'workout', 'hangout', 'walk', 'coffee_home', 'movie_night', 'dinner_home', 'drive_around']) {
      expect(isInvitationActivityKind(k)).toBe(true)
    }
    expect(isInvitationActivityKind('bogus')).toBe(false)
    expect(isInvitationActivityKind(undefined)).toBe(false)
  })

  it('round-trips every home invitation kind + an active home visit (round-3 review #1)', () => {
    // The stale five-kind whitelist dropped these on load; the canonical validator keeps them.
    const clean = sanitizeSocialSave({
      version: 1,
      invitations: [
        { id: 'i_coffee', actorId: 'npc_ravi_01', source: 'player', activityKind: 'coffee_home', proposedDay: 5, proposedHour: 13, status: 'accepted', createdDay: 5 },
        { id: 'i_movie', actorId: 'npc_maya_01', source: 'player', activityKind: 'movie_night', proposedDay: 6, proposedHour: 20, status: 'pending', createdDay: 5 },
        { id: 'i_dinner', actorId: 'npc_leo_01', source: 'player', activityKind: 'dinner_home', proposedDay: 7, proposedHour: 19, status: 'completed', createdDay: 6 },
      ],
      // The active-hosting load policy is RESTORE: an active home visit + its linked plan survive.
      activeActivity: { id: 'act1', actorId: 'npc_ravi_01', template: 'meet', step: 'together', activityKind: 'coffee_home', venueId: 'home', venueLabel: 'Home', invitationId: 'i_coffee', startedDay: 5 },
    })
    expect(clean.invitations.map((i) => i.activityKind).sort()).toEqual(['coffee_home', 'dinner_home', 'movie_night'])
    const accepted = clean.invitations.find((i) => i.id === 'i_coffee')
    expect(accepted).toMatchObject({ activityKind: 'coffee_home', status: 'accepted', proposedDay: 5, proposedHour: 13 })
    expect(clean.activeActivity?.activityKind).toBe('coffee_home') // active home visit survives, coherently linked
    expect(clean.activeActivity?.invitationId).toBe('i_coffee')
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
