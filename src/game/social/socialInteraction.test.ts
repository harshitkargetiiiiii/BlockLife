import { describe, expect, it } from 'vitest'
import {
  availableSocialActions,
  giftableBackpackItems,
  giftReaction,
  perDayEventId,
  resolveSocialAction,
  type SocialActionContext,
} from './socialInteraction'
import { getSocialActor } from './socialActors'
import type { DerivedRelationship, Relationship, SocialActor } from './socialTypes'

const ravi = getSocialActor('npc_ravi_01') as SocialActor

const rel = (over: Partial<Relationship> = {}): Relationship => ({
  familiarity: 0,
  affinity: 0,
  trust: 0,
  fear: 0,
  lastMeaningfulInteractionDay: -1,
  ...over,
})
const derived = (over: Partial<DerivedRelationship> = {}): DerivedRelationship => ({
  tier: 'stranger',
  hostile: false,
  afraid: false,
  ...over,
})
const ctx = (over: Partial<SocialActionContext> = {}): SocialActionContext => ({
  rel: rel(),
  derived: derived(),
  hasMet: true,
  gameDay: 1,
  gameHour: 12,
  giftableItemIds: [],
  armed: false,
  appliedEventIds: [],
  ...over,
})

describe('giftableBackpackItems — quest items excluded (§ gifts)', () => {
  it('offers discardable, non-quest-reserved items only', () => {
    const items = giftableBackpackItems({ coffee: 1, snack: 2, restock_crate: 1, ammo_box: 1 })
    expect(items).toContain('snack')
    expect(items).toContain('ammo_box')
    expect(items).not.toContain('coffee') // questReserved
    expect(items).not.toContain('restock_crate') // questReserved
  })
  it('skips zero-quantity and unknown ids', () => {
    expect(giftableBackpackItems({ snack: 0, not_a_real_item: 3 })).toEqual([])
  })
})

describe('availableSocialActions — contextual gating (§2)', () => {
  it('a never-met, unarmed, empty-handed player only gets talk + a disabled gift', () => {
    const actions = availableSocialActions(ravi, ctx({ hasMet: false }))
    const ids = actions.map((a) => a.id)
    expect(ids).toEqual(['talk', 'gift'])
    expect(actions.find((a) => a.id === 'gift')?.enabled).toBe(false)
    expect(actions.find((a) => a.id === 'gift')?.hint).toBe('Nothing to give')
  })

  it('a met player with an item, a grievance and a weapon gets the full menu', () => {
    const actions = availableSocialActions(
      ravi,
      ctx({ hasMet: true, giftableItemIds: ['snack'], armed: true, rel: rel({ fear: 60 }), derived: derived({ afraid: true }) }),
    )
    const ids = actions.map((a) => a.id)
    expect(ids).toEqual(['talk', 'check_in', 'gift', 'ask_favor', 'apologize', 'threaten'])
    expect(actions.find((a) => a.id === 'gift')?.enabled).toBe(true)
    expect(actions.find((a) => a.id === 'threaten')?.enabled).toBe(true)
  })

  it('disables an action already performed today (anti-farm)', () => {
    const applied = [perDayEventId('gift', ravi.id, 1), perDayEventId('check_in', ravi.id, 1)]
    const actions = availableSocialActions(ravi, ctx({ giftableItemIds: ['snack'], appliedEventIds: applied }))
    expect(actions.find((a) => a.id === 'gift')?.enabled).toBe(false)
    expect(actions.find((a) => a.id === 'gift')?.hint).toBe('Already gave a gift today')
    expect(actions.find((a) => a.id === 'check_in')?.enabled).toBe(false)
  })
})

describe('resolveSocialAction — outcomes feed the ONE pipeline (§2/§4)', () => {
  it('talk moves the relationship once per day, then is flavor-only', () => {
    const first = resolveSocialAction(ravi, 'talk', ctx())
    expect(first.ok).toBe(true)
    expect(first.event?.kind).toBe('conversation')
    const repeat = resolveSocialAction(ravi, 'talk', ctx({ appliedEventIds: [perDayEventId('talk', ravi.id, 1)] }))
    expect(repeat.ok).toBe(true)
    expect(repeat.event).toBeUndefined() // no double-dip
  })

  it('check_in needs a prior meeting', () => {
    expect(resolveSocialAction(ravi, 'check_in', ctx({ hasMet: false })).responseToken).toBe('unavailable')
    expect(resolveSocialAction(ravi, 'check_in', ctx()).event?.kind).toBe('check_in')
  })

  it('gift reaction follows the actor likes/dislikes and consumes the item', () => {
    expect(giftReaction(ravi, 'snack')).toBe('gift_liked')
    expect(giftReaction(ravi, 'ammo_box')).toBe('gift_disliked')
    expect(giftReaction(ravi, 'meal')).toBe('gift_neutral')

    const liked = resolveSocialAction(ravi, 'gift', ctx({ giftableItemIds: ['snack'] }), { itemId: 'snack' })
    expect(liked.event?.kind).toBe('gift_liked')
    expect(liked.consumeItemId).toBe('snack')

    const disliked = resolveSocialAction(ravi, 'gift', ctx({ giftableItemIds: ['ammo_box'] }), { itemId: 'ammo_box' })
    expect(disliked.event?.kind).toBe('gift_disliked')
  })

  it('gift refuses an item the player does not actually hold', () => {
    const r = resolveSocialAction(ravi, 'gift', ctx({ giftableItemIds: ['snack'] }), { itemId: 'meal' })
    expect(r.ok).toBe(false)
    expect(r.consumeItemId).toBeUndefined()
    expect(r.event).toBeUndefined()
  })

  it('ask_favor is a pure gate: accepted when trusted, refused otherwise (§ refusals)', () => {
    const refused = resolveSocialAction(ravi, 'ask_favor', ctx({ rel: rel({ trust: 5 }) }))
    expect(refused.ok).toBe(false)
    expect(refused.responseToken).toBe('favor_refused')
    expect(refused.event).toBeUndefined()

    const accepted = resolveSocialAction(ravi, 'ask_favor', ctx({ rel: rel({ trust: 25 }) }))
    expect(accepted.ok).toBe(true)
    expect(accepted.responseToken).toBe('favor_accepted')
    expect(accepted.event).toBeUndefined() // the favor ACTIVITY (Slice 4) moves trust, not the ask
  })

  it('apologize is accepted when merely afraid, rejected when actively hostile', () => {
    const afraid = resolveSocialAction(ravi, 'apologize', ctx({ rel: rel({ fear: 60 }), derived: derived({ afraid: true }) }))
    expect(afraid.ok).toBe(true)
    expect(afraid.event?.kind).toBe('apology_accepted')

    const hostile = resolveSocialAction(ravi, 'apologize', ctx({ rel: rel({ fear: 60, affinity: -30 }), derived: derived({ hostile: true }) }))
    expect(hostile.ok).toBe(false)
    expect(hostile.event?.kind).toBe('apology_rejected')
  })

  it('threaten needs a drawn weapon (the "where existing systems permit" gate)', () => {
    expect(resolveSocialAction(ravi, 'threaten', ctx({ armed: false })).responseToken).toBe('unavailable')
    const armed = resolveSocialAction(ravi, 'threaten', ctx({ armed: true }))
    expect(armed.ok).toBe(true)
    expect(armed.event?.kind).toBe('threatened')
  })

  it('per-day event id is stable + collision-free across actions', () => {
    expect(perDayEventId('gift', 'npc_ravi_01', 1)).toBe('social:gift:npc_ravi_01:1')
    expect(perDayEventId('gift', 'npc_ravi_01', 1)).toBe(perDayEventId('gift', 'npc_ravi_01', 1))
    expect(perDayEventId('gift', 'npc_ravi_01', 1)).not.toBe(perDayEventId('talk', 'npc_ravi_01', 1))
  })
})
