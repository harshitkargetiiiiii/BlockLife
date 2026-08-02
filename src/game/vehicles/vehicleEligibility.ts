/**
 * Career → vehicle eligibility (issue #19 §4) — a typed, READ-ONLY view of the career authority
 * for a listing's requirement (rank + driving skill + verified income). It REUSES the same
 * career-eligibility readers the housing income/rank gate already uses (`highestCareerRank`,
 * `housingRecentCareerIncome`, `rankAtLeast`) instead of modelling a second one, and never
 * mutates rank / skill / pay / history. Only VERIFIED career income qualifies you for the
 * premium tier — crime/mission cash never counts (§4). Those readers currently live under
 * `housing/` but consult ONLY career state, so reusing them introduces no housing dependency
 * in behaviour.
 */
import { getSkillLevel } from '../careers/careerRuntime'
import { rankAtLeast } from '../housing/eligibility'
import { highestCareerRank, housingRecentCareerIncome } from '../housing/housingCareer'
import { RECENT_INCOME_WINDOW_DAYS } from '../housing/housingTypes'
import { VEHICLE_REQUIREMENT_SKILL, type VehicleRequirement } from './vehicleRegistry'

export interface VehicleEligibilityResult {
  eligible: boolean
  /** The first unmet requirement (readable), or undefined when eligible. */
  firstUnmetReason?: string
}

const RANK_LABEL: Record<string, string> = {
  trainee: 'Trainee',
  regular: 'Regular',
  experienced: 'Experienced',
  senior: 'Senior',
}

/** Evaluate a listing requirement against the live career authority (rank → skill → income). */
export function vehicleEligibility(req: VehicleRequirement, day: number): VehicleEligibilityResult {
  if (req.minRank && !rankAtLeast(highestCareerRank(), req.minRank)) {
    return { eligible: false, firstUnmetReason: `Requires ${RANK_LABEL[req.minRank] ?? req.minRank} rank in any career.` }
  }
  if (req.minDrivingSkill !== undefined && getSkillLevel(VEHICLE_REQUIREMENT_SKILL) < req.minDrivingSkill) {
    return { eligible: false, firstUnmetReason: `Requires Driving skill level ${req.minDrivingSkill}.` }
  }
  if (req.minRecentCareerIncome !== undefined) {
    const window = req.recentIncomeWindowDays ?? RECENT_INCOME_WINDOW_DAYS
    if (housingRecentCareerIncome(day, window) < req.minRecentCareerIncome) {
      return {
        eligible: false,
        firstUnmetReason: `Requires $${req.minRecentCareerIncome} verified career income in the last ${window} days.`,
      }
    }
  }
  return { eligible: true }
}
