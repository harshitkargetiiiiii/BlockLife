import { beforeEach, describe, expect, it } from 'vitest'
import { getDerivedRelationship, getMessages, ingestSocialEvent, resetSocial } from '../social/socialRuntime'
import { isDiscovered, resetHousing } from './housingRuntime'
import { housingEligibility } from './housingCareer'
import { isPropertyRecommended, reconcileHousingRecommendations } from './housingRecommendations'

/** Pump enough liked-gift + completed-favor events to reach REAL trust (familiarity +
 *  affinity + trust), deterministically. */
function befriendToTrusted(actorId: string): void {
  ingestSocialEvent({ id: `met:${actorId}`, kind: 'met', actorId: actorId as never, gameDay: 0 })
  for (let i = 0; i < 60; i++) {
    if (getDerivedRelationship(actorId as never).tier === 'trusted' || getDerivedRelationship(actorId as never).tier === 'close') break
    ingestSocialEvent({ id: `g:${actorId}:${i}`, kind: 'gift_liked', actorId: actorId as never, gameDay: 0 })
    ingestSocialEvent({ id: `f:${actorId}:${i}`, kind: 'favor_completed', actorId: actorId as never, gameDay: 0 })
  }
}

describe('housing recommendations (review #1)', () => {
  beforeEach(() => {
    resetHousing(0)
    resetSocial()
  })

  it('a stranger recommends nothing', () => {
    expect(isPropertyRecommended('city_loft')).toBe(false)
    expect(isPropertyRecommended('premium_apartment')).toBe(false)
  })

  it('only the vouching trusted friend relaxes only that property, exact-once', () => {
    befriendToTrusted('npc_maya_01')
    const tier = getDerivedRelationship('npc_maya_01').tier
    expect(tier === 'trusted' || tier === 'close').toBe(true)
    // Maya vouches for the loft; she does NOT vouch for the premium.
    expect(isPropertyRecommended('city_loft')).toBe(true)
    expect(isPropertyRecommended('premium_apartment')).toBe(false)

    // Surfacing discovers the property + posts ONE message with a stable id.
    expect(reconcileHousingRecommendations(1, 12)).toBe(1)
    expect(isDiscovered('city_loft')).toBe(true)
    expect(getMessages('npc_maya_01').some((m) => m.token === 'housing_recommend')).toBe(true)
    // Exact-once: reopening the phone surfaces nothing new.
    expect(reconcileHousingRecommendations(1, 12)).toBe(0)
    expect(getMessages('npc_maya_01').filter((m) => m.token === 'housing_recommend')).toHaveLength(1)
  })

  it('relaxes ONLY the tour gate — never rank or income', () => {
    befriendToTrusted('npc_nisha_01') // Nisha vouches for the premium
    // Premium still needs Experienced rank + verified income; the recommendation only
    // waives the tour, so an untoured, un-ranked player is still ineligible for a reason
    // that is NOT "tour".
    const elig = housingEligibility('premium_apartment', 5)
    expect(elig.eligible).toBe(false)
    expect(elig.firstUnmetReason?.toLowerCase()).not.toContain('tour')
  })
})
