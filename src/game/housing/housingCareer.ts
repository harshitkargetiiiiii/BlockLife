/**
 * Career → housing eligibility adapter (issue #17 §10). A typed, READ-ONLY view of
 * the career system: the highest rank the player has attained across any career and
 * their verified career income over a window. Housing never mutates rank, pay,
 * performance, or history — it only reads. Crime/mission cash is deliberately not
 * consulted, so a landlord's income gate is satisfied by real career earnings only.
 */
import { getCareerState, getRecentResults } from '../careers/careerRuntime'
import { RANK_ORDER, type RankId } from '../careers/careerTypes'
import { propertyEligibility, recentCareerIncome, type EligibilityResult } from './eligibility'
import { RECENT_INCOME_WINDOW_DAYS, type PropertyId } from './housingTypes'
import { getProperty } from './propertyRegistry'
import { isToured } from './housingRuntime'

/** The best rank the player has reached in ANY career (current ranks + history highs). */
export function highestCareerRank(): RankId | null {
  const state = getCareerState()
  let best: RankId | null = null
  const consider = (r: RankId | undefined): void => {
    if (r && (best === null || RANK_ORDER.indexOf(r) > RANK_ORDER.indexOf(best))) best = r
  }
  for (const r of Object.values(state.ranks)) consider(r)
  for (const h of Object.values(state.history)) consider(h?.highestRank)
  return best
}

/** Verified career income earned in the last `windowDays` game days. */
export function housingRecentCareerIncome(day: number, windowDays = RECENT_INCOME_WINDOW_DAYS): number {
  return recentCareerIncome(getRecentResults(), day, windowDays)
}

/** Full eligibility verdict for a property, with the first unmet requirement. */
export function housingEligibility(propertyId: PropertyId, day: number): EligibilityResult {
  const property = getProperty(propertyId)
  if (!property) return { eligible: false, firstUnmetReason: 'Unknown property.' }
  const windowDays = property.requirement.recentIncomeWindowDays ?? RECENT_INCOME_WINDOW_DAYS
  return propertyEligibility(property, {
    highestRankAny: highestCareerRank(),
    recentCareerIncome: housingRecentCareerIncome(day, windowDays),
    toured: isToured(propertyId),
    recommendationRelaxesTour: false, // a trusted-NPC recommendation is wired in the hosting slice (§10)
  })
}
