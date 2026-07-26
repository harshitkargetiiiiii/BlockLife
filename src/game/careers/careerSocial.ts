/**
 * Career → Social integration (issue #15 §10) — a typed ADAPTER. Employer messages,
 * memories and recommendations flow through the EXISTING social authority
 * (`postContactMessage` + the ONE `ingestSocialEvent` pipeline) — this file never
 * touches relationship numbers or message arrays directly. Only named-actor employers
 * (Maya, Coach Bruno, Leo) participate; other employers are silent. Every message +
 * memory carries a STABLE id so a reload / repeat can't duplicate them.
 */
import { allCareers, getCareer } from './careerRegistry'
import { grantRecommendation, hasRecommendation } from './careerRuntime'
import type { CareerId } from './careerTypes'
import { getDerivedRelationship, ingestSocialEvent, postContactMessage } from '../social/socialRuntime'
import { tierAtLeast } from '../social/socialScheduling'
import type { SocialActorId } from '../social/socialTypes'

/** Employer message + a positive memory when a player is hired. */
export function notifyHired(careerId: CareerId, gameDay: number, gameHour: number): void {
  const actor = getCareer(careerId)?.employerActorId as SocialActorId | undefined
  if (!actor) return
  postContactMessage(actor, 'job_hired', `career:hired:${careerId}`, gameDay, gameHour)
}

/** Employer message + a positive relationship memory on promotion. */
export function notifyPromoted(careerId: CareerId, rankId: string, gameDay: number, gameHour: number): void {
  const actor = getCareer(careerId)?.employerActorId as SocialActorId | undefined
  if (!actor) return
  postContactMessage(actor, 'job_promoted', `career:promo:${careerId}:${rankId}`, gameDay, gameHour)
  ingestSocialEvent({ id: `career:promo_mem:${careerId}:${rankId}`, kind: 'favor_completed', actorId: actor, gameDay, gameHour })
}

/**
 * Employer follow-up after a resolved shift: praise + a positive memory for a strong
 * run, a nudge + a `no_show` memory for a missed shift. Keyed on the shift id (exact-once).
 */
export function notifyShiftOutcome(careerId: CareerId, outcome: 'completed' | 'failed' | 'missed', score: number, shiftId: string, gameDay: number, gameHour: number): void {
  const actor = getCareer(careerId)?.employerActorId as SocialActorId | undefined
  if (!actor) return
  if (outcome === 'completed' && score >= 80) {
    postContactMessage(actor, 'job_good_shift', `career:good:${shiftId}`, gameDay, gameHour)
    ingestSocialEvent({ id: `career:good_mem:${shiftId}`, kind: 'favor_completed', actorId: actor, gameDay, gameHour })
  } else if (outcome === 'missed') {
    postContactMessage(actor, 'job_missed_shift', `career:missed:${shiftId}`, gameDay, gameHour)
    ingestSocialEvent({ id: `career:missed_mem:${shiftId}`, kind: 'no_show', actorId: actor, gameDay, gameHour })
  }
}

/**
 * Earn a career recommendation from a warm employer NPC (§3/§10): if a career's
 * recommender is a named actor the player is `friendly`+ with, they put in a good
 * word — relaxing that career's entry gate — with a one-time employer message.
 * Deterministic; called lazily (phone/job-board open), never per frame.
 */
export function reconcileEarnedRecommendations(gameDay: number, gameHour: number): CareerId[] {
  const earned: CareerId[] = []
  for (const career of allCareers()) {
    const empId = career.entry.recommendationRelaxesFrom
    const actor = career.employerActorId as SocialActorId | undefined
    if (!empId || !actor || hasRecommendation(empId)) continue
    if (tierAtLeast(getDerivedRelationship(actor).tier, 'friendly')) {
      grantRecommendation(empId)
      postContactMessage(actor, 'job_recommendation', `career:rec:${career.id}`, gameDay, gameHour)
      earned.push(career.id)
    }
  }
  return earned
}
