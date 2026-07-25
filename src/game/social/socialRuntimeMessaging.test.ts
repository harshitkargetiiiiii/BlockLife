import { beforeEach, describe, expect, it } from 'vitest'
import {
  getInvitations,
  getMessages,
  getPendingInvitations,
  getRelationship,
  getTotalUnread,
  ingestSocialEvent,
  markContactRead,
  reconcileOutreach,
  resetSocial,
  respondToInvitation,
  sendPlayerInvite,
  socialRuntime,
} from './socialRuntime'

/** Establish that Ravi has met the player on `day` (so he is an eligible contact). */
function meetRavi(day: number) {
  ingestSocialEvent({ id: `met:npc_ravi_01`, kind: 'met', actorId: 'npc_ravi_01', gameDay: day, gameHour: 10 })
}

describe('social runtime — phone messaging + invitations (Slice 3)', () => {
  beforeEach(() => resetSocial())

  it('reconcileOutreach creates a deterministic follow-up + invitation, exactly once/day', () => {
    meetRavi(1) // Ravi: friendly, likes you, last seen day 1
    const created = reconcileOutreach(4, 9) // 3 quiet days later
    expect(created).toBe(1)
    const thread = getMessages('npc_ravi_01')
    expect(thread.length).toBe(1)
    expect(thread[0].dir).toBe('in')
    expect(thread[0].read).toBe(false)
    expect(getTotalUnread()).toBe(1)
    // Ravi has 'invite' in preferredCategories → an incoming invitation appears too.
    expect(getPendingInvitations().length).toBe(1)
    expect(socialRuntime.state.lastInitiatedDay['npc_ravi_01']).toBe(4)

    // Same day again → idempotent (no duplicate message).
    expect(reconcileOutreach(4, 12)).toBe(0)
    expect(getMessages('npc_ravi_01').length).toBe(1)
  })

  it('marking a thread read clears the unread badge', () => {
    meetRavi(1)
    reconcileOutreach(4, 9)
    expect(getTotalUnread()).toBe(1)
    markContactRead('npc_ravi_01')
    expect(getTotalUnread()).toBe(0)
  })

  it('accepting an invitation raises affinity + posts the reply, once', () => {
    meetRavi(1)
    reconcileOutreach(4, 9)
    const invId = getPendingInvitations()[0].id
    const before = getRelationship('npc_ravi_01').affinity
    expect(respondToInvitation(invId, 'accepted', 4, 10)).toBe(true)
    expect(getInvitations().find((i) => i.id === invId)!.status).toBe('accepted')
    expect(getRelationship('npc_ravi_01').affinity).toBeGreaterThan(before)
    expect(getMessages('npc_ravi_01').some((m) => m.dir === 'out' && m.token === 'accept')).toBe(true)
    // Re-answering a resolved invitation is a no-op.
    expect(respondToInvitation(invId, 'declined', 4, 11)).toBe(false)
  })

  it('suggest-later reschedules and keeps the invitation open (no relationship change)', () => {
    meetRavi(1)
    reconcileOutreach(4, 9)
    const inv = getPendingInvitations()[0]
    const before = getRelationship('npc_ravi_01').affinity
    respondToInvitation(inv.id, 'suggested_later', 4, 23)
    const after = getInvitations().find((i) => i.id === inv.id)!
    expect(after.status).toBe('suggested_later')
    expect(getRelationship('npc_ravi_01').affinity).toBe(before) // neutral
  })

  it('a player invite to a friend is accepted; a stranger refuses (gated)', () => {
    meetRavi(1) // friendly
    const ok = sendPlayerInvite('npc_ravi_01', 5, 10)
    expect(ok.ok).toBe(true)
    expect(getInvitations().some((i) => i.source === 'player' && i.status === 'accepted')).toBe(true)
    expect(getMessages('npc_ravi_01').some((m) => m.dir === 'out' && m.token.startsWith('invite_'))).toBe(true)

    // Officer Kim is a stranger (never met) → the gate refuses.
    const refused = sendPlayerInvite('npc_kim_01', 5, 10)
    expect(refused.ok).toBe(false)
  })
})
