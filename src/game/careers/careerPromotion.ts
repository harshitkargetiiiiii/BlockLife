/**
 * Career progression: promotions + unlocks (issue #15 §8). ONE deterministic
 * promotion service — a player is promoted only when EVERY requirement of the next
 * rank is met (completed shifts, skill levels, recent performance, attendance, and
 * an optional employer-standing gate). Promotion is idempotent + evaluated from
 * bounded state; each rank's unlocks are granted exactly once. Pure reducers; the
 * runtime applies the result and the store surfaces the message.
 */
import { RECENT_PERFORMANCE_WINDOW, UNLOCKS_MAX, type CareerDefinition, type CareerId, type CareerUnlock, type RankDefinition, type SkillId } from './careerTypes'
import { nextRank } from './careerRegistry'
import { skillLevel } from './skills'
import { recordHighestRank } from './careerServices'
import type { CareerState } from './careerEvents'

const SKILL_LABEL: Record<SkillId, string> = { fitness: 'Fitness', driving: 'Driving', social: 'Social', street_smarts: 'Street Smarts', work_ethic: 'Work Ethic' }

/** Average score across the last {@link RECENT_PERFORMANCE_WINDOW} shifts of a career
 *  (0 when none yet) — the rolling summary promotions read (§6). */
export function recentPerformance(state: CareerState, careerId: CareerId): number {
  const recent = state.performanceHistory.filter((p) => p.careerId === careerId).slice(-RECENT_PERFORMANCE_WINDOW)
  if (recent.length === 0) return 0
  return Math.round(recent.reduce((a, p) => a + p.score, 0) / recent.length)
}

export interface PromotionRequirementRow {
  label: string
  have: number
  need: number
  ok: boolean
}
export interface PromotionProgress {
  currentRank: string
  nextRank: RankDefinition | null
  met: boolean
  rows: PromotionRequirementRow[]
}

/** Deterministic promotion readiness + a per-requirement breakdown for the UI (§12). */
export function evaluatePromotion(state: CareerState, career: CareerDefinition): PromotionProgress {
  const current = state.ranks[career.id] ?? 'trainee'
  const next = nextRank(career.id, current)
  if (!next || !next.promotion) return { currentRank: current, nextRank: null, met: false, rows: [] }
  const req = next.promotion
  const h = state.history[career.id]
  const completed = h?.completedShifts ?? 0
  const missed = h?.missedShifts ?? 0
  const standing = state.employerStanding[career.employerId] ?? 0
  const perf = recentPerformance(state, career.id)

  const rows: PromotionRequirementRow[] = []
  rows.push({ label: 'Completed shifts', have: completed, need: req.completedShifts, ok: completed >= req.completedShifts })
  for (const [skill, lvl] of Object.entries(req.skills)) {
    const have = skillLevel(state.skills[skill as SkillId])
    rows.push({ label: `${SKILL_LABEL[skill as SkillId]} level`, have, need: lvl ?? 0, ok: have >= (lvl ?? 0) })
  }
  rows.push({ label: 'Recent performance', have: perf, need: req.minRecentPerformance, ok: perf >= req.minRecentPerformance })
  rows.push({ label: 'Missed shifts (max)', have: missed, need: req.maxMissedShifts, ok: missed <= req.maxMissedShifts })
  if (req.minEmployerStanding !== undefined) rows.push({ label: 'Employer standing', have: standing, need: req.minEmployerStanding, ok: standing >= req.minEmployerStanding })

  return { currentRank: current, nextRank: next, met: rows.every((r) => r.ok), rows }
}

export interface PromoteResult {
  state: CareerState
  promotedTo: RankDefinition | null
  unlocks: CareerUnlock[]
}

/**
 * Promote if eligible: bump the rank, grant the new rank's unlocks exactly once,
 * and record the new highest rank. A no-op (promotedTo null) when not eligible or
 * already at the top. Demotions are out of scope (§8).
 */
export function promoteIfEligible(state: CareerState, career: CareerDefinition): PromoteResult {
  const progress = evaluatePromotion(state, career)
  if (!progress.met || !progress.nextRank) return { state, promotedTo: null, unlocks: [] }
  const next = progress.nextRank
  const newUnlocks = next.unlocks.filter((u) => !state.unlocks.includes(u.id))
  let s: CareerState = {
    ...state,
    ranks: { ...state.ranks, [career.id]: next.id },
    unlocks: [...state.unlocks, ...newUnlocks.map((u) => u.id)].slice(-UNLOCKS_MAX),
  }
  s = recordHighestRank(s, career.id, next.id)
  return { state: s, promotedTo: next, unlocks: newUnlocks }
}
