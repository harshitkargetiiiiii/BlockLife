/**
 * Property eligibility (issue #17 §10) — PURE. Given a property and a resolved
 * career/tour context, returns whether the player qualifies and the FIRST unmet
 * requirement as readable copy. Career money helps pay costs, but only VERIFIED
 * CAREER income satisfies an income gate — crime/mission cash never counts, which
 * is why the runtime derives `recentCareerIncome` solely from career shift results.
 */
import { RANK_ORDER, type RankId, type ShiftResultRecord } from '../careers/careerTypes'
import { RECENT_INCOME_WINDOW_DAYS, type PropertyDef } from './housingTypes'

const RANK_LABEL: Record<RankId, string> = {
  trainee: 'Trainee',
  regular: 'Regular',
  experienced: 'Experienced',
  senior: 'Senior',
}

export interface EligibilityContext {
  /** Best rank held across ALL careers (verified employment), or null if none. */
  highestRankAny: RankId | null
  /** Verified career income earned within the property's recent window. */
  recentCareerIncome: number
  /** Whether the player has toured this property. */
  toured: boolean
  /** A trusted-NPC recommendation may relax a non-financial (tour) requirement. */
  recommendationRelaxesTour?: boolean
}

export interface EligibilityResult {
  eligible: boolean
  /** The first unmet requirement (readable), or undefined when eligible. */
  firstUnmetReason?: string
}

function rankIndex(rank: RankId | null): number {
  return rank ? RANK_ORDER.indexOf(rank) : -1
}

/** True when `have` is at least `need` by RANK_ORDER. */
export function rankAtLeast(have: RankId | null, need: RankId): boolean {
  return rankIndex(have) >= RANK_ORDER.indexOf(need)
}

/**
 * Verified career income within a window (issue §10). Sums the pay of career
 * shift RESULTS whose game day is within `windowDays` of `today`. Career pay only.
 */
export function recentCareerIncome(
  results: readonly ShiftResultRecord[],
  today: number,
  windowDays: number = RECENT_INCOME_WINDOW_DAYS,
): number {
  const cutoff = Math.trunc(today) - windowDays
  let sum = 0
  for (const r of results) if (r.day > cutoff) sum += Math.max(0, r.pay)
  return sum
}

/** Evaluate eligibility, returning the FIRST unmet requirement (rank → income → tour). */
export function propertyEligibility(property: PropertyDef, ctx: EligibilityContext): EligibilityResult {
  const req = property.requirement
  if (req.minRank && !rankAtLeast(ctx.highestRankAny, req.minRank)) {
    return { eligible: false, firstUnmetReason: `Requires ${RANK_LABEL[req.minRank]} rank in any career.` }
  }
  if (req.minRecentCareerIncome !== undefined && ctx.recentCareerIncome < req.minRecentCareerIncome) {
    const window = req.recentIncomeWindowDays ?? RECENT_INCOME_WINDOW_DAYS
    return {
      eligible: false,
      firstUnmetReason: `Needs $${req.minRecentCareerIncome} verified career income in the last ${window} days.`,
    }
  }
  if (property.tourRequired && !ctx.toured && !ctx.recommendationRelaxesTour) {
    return { eligible: false, firstUnmetReason: 'Tour this property before leasing.' }
  }
  return { eligible: true }
}
