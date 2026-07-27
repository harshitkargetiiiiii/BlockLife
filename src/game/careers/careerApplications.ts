/**
 * Employment + application eligibility (issue #15 §3). PURE + deterministic: a
 * career's entry gate checked against the player's skills, global reputation,
 * wanted state, current employment, and any employer recommendation — returning a
 * READABLE refusal reason (never a silent no). A recommendation from the Social
 * Life system (a typed flag on career state, set through an adapter — NOT scattered
 * relationship-number checks) relaxes the skill/reputation gate for one career.
 */
import type { CareerDefinition, CareerId, EmployerId, SkillMap } from './careerTypes'
import { skillLevel } from './skills'

const SKILL_LABEL: Record<string, string> = {
  fitness: 'Fitness',
  driving: 'Driving',
  social: 'Social',
  street_smarts: 'Street Smarts',
  work_ethic: 'Work Ethic',
}

export interface EligibilityContext {
  skills: SkillMap
  /** Global reputation (the existing reputation authority — read, not owned). */
  reputation: number
  /** Current wanted level (crime authority — read, not owned). */
  wanted: number
  /** The player's current primary job (only one at a time). */
  activeJob: CareerId | null
  /** Whether a shift is in progress — you can't change jobs mid-shift (§4). */
  hasActiveShift: boolean
  /** Whether an employer has recommended the player (career-state flag, §10). */
  hasRecommendation: (employerId: EmployerId) => boolean
}

export interface EligibilityResult {
  ok: boolean
  reason?: string
  /** True when a recommendation is what let them in (for UI/messaging). */
  viaRecommendation?: boolean
}

/**
 * Is the player eligible to be hired into `career` right now? Deterministic; the
 * first unmet gate becomes the readable refusal reason. A recommendation from the
 * career's `recommendationRelaxesFrom` employer waives the skill + reputation gates.
 */
export function checkEligibility(career: CareerDefinition, ctx: EligibilityContext): EligibilityResult {
  if (ctx.activeJob === career.id) return { ok: false, reason: `You already work at ${career.employerDisplayName}.` }
  // You can't take a new job while a shift is in progress — finish or quit it first,
  // so switching employers can never leave an orphaned active shift running (§4, F1).
  if (ctx.hasActiveShift) return { ok: false, reason: 'Finish your active shift before switching jobs.' }
  if (ctx.wanted > career.maxWantedToApply) return { ok: false, reason: 'Clear your wanted level before applying.' }

  const recommended = career.entry.recommendationRelaxesFrom !== undefined && ctx.hasRecommendation(career.entry.recommendationRelaxesFrom)
  if (!recommended) {
    for (const [skill, minLvl] of Object.entries(career.entry.skills ?? {})) {
      if (skillLevel(ctx.skills[skill as keyof SkillMap]) < (minLvl ?? 0)) {
        return { ok: false, reason: `Needs ${SKILL_LABEL[skill] ?? skill} level ${minLvl}.` }
      }
    }
    if (career.entry.minReputation !== undefined && ctx.reputation < career.entry.minReputation) {
      return { ok: false, reason: `Needs reputation ${career.entry.minReputation} (you have ${ctx.reputation}).` }
    }
  }
  return { ok: true, viaRecommendation: recommended && (career.entry.skills !== undefined || career.entry.minReputation !== undefined) }
}
