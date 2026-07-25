import { describe, expect, it } from 'vitest'
import {
  canPlayerInvite,
  decideNpcInviteResponse,
  invitationStartWindow,
  isAvailable,
  isWithinWindow,
  nextAvailableSlot,
  npcShouldReachOut,
  outreachToken,
  preferredActivityKind,
} from './socialScheduling'
import { getSocialActor } from './socialActors'
import type { MemoryEntry, Relationship, SocialActor, SocialInvitation } from './socialTypes'

const ravi = getSocialActor('npc_ravi_01') as SocialActor // availability [[6,22]]
const bruno = getSocialActor('npc_bruno_01') as SocialActor // fitness
const leo = getSocialActor('npc_leo_01') as SocialActor
const rel = (over: Partial<Relationship> = {}): Relationship => ({ familiarity: 0, affinity: 0, trust: 0, fear: 0, lastMeaningfulInteractionDay: -1, ...over })

describe('availability windows', () => {
  it('handles a normal window and a midnight wrap', () => {
    expect(isWithinWindow(12, [6, 22])).toBe(true)
    expect(isWithinWindow(23, [6, 22])).toBe(false)
    expect(isWithinWindow(23, [22, 6])).toBe(true) // wraps
    expect(isWithinWindow(3, [22, 6])).toBe(true)
    expect(isWithinWindow(9, [22, 6])).toBe(false)
  })

  it('isAvailable checks any of the actor windows', () => {
    expect(isAvailable(ravi, 10)).toBe(true)
    expect(isAvailable(ravi, 2)).toBe(false)
  })

  it('nextAvailableSlot finds the next open hour, wrapping the day', () => {
    const slot = nextAvailableSlot(ravi, 5, 23) // 23:00 day 5 → next available is 06:00 day 6
    expect(slot.day).toBe(6)
    expect(slot.hour).toBe(6)
  })
})

describe('preferredActivityKind — from the actor categories', () => {
  it('maps by preference', () => {
    expect(preferredActivityKind(ravi)).toBe('coffee')
    expect(preferredActivityKind(bruno)).toBe('workout')
    expect(preferredActivityKind(leo)).toBe('walk') // no invite/fitness/commerce category
  })
})

describe('canPlayerInvite — relationship + cooldown + mission gate', () => {
  it('refuses a stranger', () => {
    expect(canPlayerInvite(ravi, { tier: 'stranger', missionBusy: false, hasOpenInvitation: false, invitedToday: false }).ok).toBe(false)
  })
  it('refuses while busy, when plans are pending, or already invited today', () => {
    expect(canPlayerInvite(ravi, { tier: 'friendly', missionBusy: true, hasOpenInvitation: false, invitedToday: false }).ok).toBe(false)
    expect(canPlayerInvite(ravi, { tier: 'friendly', missionBusy: false, hasOpenInvitation: true, invitedToday: false }).ok).toBe(false)
    expect(canPlayerInvite(ravi, { tier: 'friendly', missionBusy: false, hasOpenInvitation: false, invitedToday: true }).ok).toBe(false)
  })
  it('allows an acquaintance who is free', () => {
    expect(canPlayerInvite(ravi, { tier: 'acquaintance', missionBusy: false, hasOpenInvitation: false, invitedToday: false }).ok).toBe(true)
  })
})

describe('decideNpcInviteResponse — deterministic reply', () => {
  it('friend + free → yes, friend + busy → later, acquaintance → later, stranger → no', () => {
    expect(decideNpcInviteResponse('friendly', true)).toBe('accepted')
    expect(decideNpcInviteResponse('friendly', false)).toBe('suggested_later')
    expect(decideNpcInviteResponse('acquaintance', true)).toBe('suggested_later')
    expect(decideNpcInviteResponse('stranger', true)).toBe('declined')
  })
})

describe('invitationStartWindow — a plan is startable only inside its window (PR#14 review)', () => {
  const inv = (over: Partial<SocialInvitation> = {}): SocialInvitation => ({
    id: 'i', actorId: 'npc_ravi_01', source: 'player', activityKind: 'coffee', proposedDay: 5, proposedHour: 9, status: 'accepted', createdDay: 1, ...over,
  })

  it('refuses starting too early (before 1h ahead of the proposed slot)', () => {
    // proposed day5 09:00 → window opens day5 08:00. On day 1 it is far too early.
    const r = invitationStartWindow(inv(), 1, 12)
    expect(r.startable).toBe(false)
    expect(r.kind).toBe('too_early')
    expect(r.reason).toBe('Available on day 5 at 09:00')
  })

  it('opens exactly 1h before the proposed slot and stays open through the 3h grace', () => {
    expect(invitationStartWindow(inv(), 5, 8).startable).toBe(true) // 1h before
    expect(invitationStartWindow(inv(), 5, 9).startable).toBe(true) // on time
    expect(invitationStartWindow(inv(), 5, 11).startable).toBe(true) // +2h, inside grace
    expect(invitationStartWindow(inv(), 5, 7).kind).toBe('too_early') // 2h before → still closed
  })

  it('expires once past the proposed slot + the grace window (the no-show boundary)', () => {
    const r = invitationStartWindow(inv(), 5, 12) // +3h == grace → expired
    expect(r.startable).toBe(false)
    expect(r.kind).toBe('expired')
    expect(r.reason).toBe('This plan has expired.')
  })

  it('is never startable unless the invitation is accepted', () => {
    expect(invitationStartWindow(inv({ status: 'active' }), 5, 9).kind).toBe('active')
    expect(invitationStartWindow(inv({ status: 'completed' }), 5, 9).kind).toBe('not_accepted')
    expect(invitationStartWindow(inv({ status: 'pending' }), 5, 9).startable).toBe(false)
  })
})

describe('npcShouldReachOut — deterministic follow-up eligibility', () => {
  it('needs affinity, silence, and an elapsed cooldown', () => {
    // liked you, last seen day 1, now day 4, never reached out → yes
    expect(npcShouldReachOut(ravi, rel({ affinity: 30, lastMeaningfulInteractionDay: 1 }), 4, undefined)).toBe(true)
    // too cold
    expect(npcShouldReachOut(ravi, rel({ affinity: 5, lastMeaningfulInteractionDay: 1 }), 4, undefined)).toBe(false)
    // saw you yesterday → not yet
    expect(npcShouldReachOut(ravi, rel({ affinity: 30, lastMeaningfulInteractionDay: 3 }), 4, undefined)).toBe(false)
    // already reached out today → cooldown blocks
    expect(npcShouldReachOut(ravi, rel({ affinity: 30, lastMeaningfulInteractionDay: 1 }), 4, 4)).toBe(false)
    // never actually met → no
    expect(npcShouldReachOut(ravi, rel({ affinity: 30, lastMeaningfulInteractionDay: -1 }), 4, undefined)).toBe(false)
  })
})

describe('outreachToken — references the salient memory', () => {
  it('maps a memory summary to an outreach flavour', () => {
    const gift: MemoryEntry = { id: 'm', npcId: ravi.id, kind: 'gift_given', gameDay: 1, salience: 40, valence: 1, sourceEventId: 'e', pinned: false, summaryToken: 'gift_liked' }
    expect(outreachToken(gift)).toBe('reach_out_thanks_gift')
    expect(outreachToken(undefined)).toBe('reach_out_generic')
  })
})
