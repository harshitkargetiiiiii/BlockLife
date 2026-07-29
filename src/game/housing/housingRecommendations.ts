/**
 * Trusted-NPC property recommendations (issue #17 §10, PR#18 review #1). A typed,
 * READ-ONLY adapter over the social relationship system: a friend you've earned real
 * trust with vouches for a place, which relaxes ONLY the authored non-financial TOUR
 * requirement. It never relaxes rank, verified income, money, debt, wanted, or activity
 * gates — those are enforced separately by `propertyEligibility` and the move money calc.
 *
 * Surfacing is exact-once through the existing social message authority (`postContactMessage`
 * with a stable id) + property discovery, driven lazily from the phone-open touch point.
 */
import { getDerivedRelationship, hasMet, postContactMessage } from '../social/socialRuntime'
import type { SocialActorId } from '../social/socialTypes'
import { tierAtLeast } from './housingSocial'
import type { PropertyId } from './housingTypes'
import { discoverProperty, hasTxnKey, recordRecommendation } from './housingRuntime'

/** Which trusted NPC vouches for which property. Data-driven + read-only. */
export interface Recommender {
  actorId: SocialActorId
  propertyId: PropertyId
}
const RECOMMENDERS: readonly Recommender[] = [
  { actorId: 'npc_maya_01', propertyId: 'city_loft' }, // Maya's café network knows the downtown loft landlord
  { actorId: 'npc_nisha_01', propertyId: 'premium_apartment' }, // Nisha vouches for the premium block
]
/** A recommendation is earned only at REAL trust — well past a casual acquaintance. */
const MIN_TIER = 'trusted' as const

/** Trusted NPCs currently vouching for `propertyId` (met + relationship ≥ trusted). */
export function propertyRecommenders(propertyId: PropertyId): Recommender[] {
  return RECOMMENDERS.filter(
    (r) => r.propertyId === propertyId && hasMet(r.actorId) && tierAtLeast(getDerivedRelationship(r.actorId).tier, MIN_TIER),
  )
}

/** Whether a trusted friend's recommendation may relax the TOUR gate for `propertyId`. */
export function isPropertyRecommended(propertyId: PropertyId): boolean {
  return propertyRecommenders(propertyId).length > 0
}

/**
 * Lazily surface any newly-earned recommendation: discover the property and post ONE
 * exact-once employer/friend message with a stable id. Called from the phone-open touch
 * point (never per frame). Returns the number of new recommendations surfaced.
 */
export function reconcileHousingRecommendations(gameDay: number, gameHour: number): number {
  let surfaced = 0
  for (const r of RECOMMENDERS) {
    if (!hasMet(r.actorId) || !tierAtLeast(getDerivedRelationship(r.actorId).tier, MIN_TIER)) continue
    const key = `housing_rec:${r.actorId}:${r.propertyId}`
    if (hasTxnKey(key)) continue // exact-once — already surfaced
    discoverProperty(r.propertyId)
    postContactMessage(r.actorId, 'housing_recommend', key, Math.trunc(gameDay), Math.trunc(gameHour))
    recordRecommendation(key)
    surfaced += 1
  }
  return surfaced
}
