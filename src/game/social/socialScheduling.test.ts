import { describe, expect, it } from 'vitest'
import {
  canPlayerInvite,
  decideNpcInviteResponse,
  isAvailable,
  isWithinWindow,
  nextAvailableSlot,
  npcShouldReachOut,
  outreachToken,
  preferredActivityKind,
} from './socialScheduling'
import { getSocialActor } from './socialActors'
import type { MemoryEntry, Relationship, SocialActor } from './socialTypes'

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
