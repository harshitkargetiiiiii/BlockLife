/**
 * Non-shift skill sources (issue #15 §2, F7) — typed, exact-once ADAPTERS that turn
 * ordinary life actions into career skill XP through the ONE `ingestCareerEvent`
 * funnel. Nothing here awards XP directly; each mints a stable event id (so a reload /
 * repeat can't double-award) and carries a farmable, per-day-CAPPED reason:
 *
 *   • gym workout      → Fitness      (`gym_workout`, cap 16/day)
 *   • social activity  → Social       (`social_activity`, cap 20/day)
 *   • police evasion   → Street Smarts (`crime_escaped`, cap 12/day)
 *
 * Production paths wire these: the gym `train` action, a completed social activity,
 * and the lazy reconcile of police-evasion events. Determinism + the caps live in the
 * skill reducer; this file is only the translation layer.
 */
import { ingestCareerEvent } from './careerRuntime'

/** The player trained at the gym → a bounded Fitness workout award (capped). */
export function notePlayerTrained(gameDay: number, gameHour: number): void {
  ingestCareerEvent({
    id: `life:gym:${Math.trunc(gameDay)}:${Math.round(gameHour * 10)}`,
    kind: 'training_milestone',
    gameDay,
    gameHour,
    skillAwards: [{ skill: 'fitness', amount: 8, reason: 'gym_workout' }],
  })
}

/** A social activity / favor completed → a bounded Social award (capped). Keyed on the
 *  activity id so the same completion can never be counted twice. */
export function noteSocialActivityCompleted(activityId: string, gameDay: number, gameHour: number): void {
  ingestCareerEvent({
    id: `life:social:${activityId}`,
    kind: 'social_activity',
    gameDay,
    gameHour,
    skillAwards: [{ skill: 'social', amount: 10, reason: 'social_activity' }],
  })
}

/** The player shook off a police pursuit → a bounded Street Smarts award (capped).
 *  Keyed on a monotonic evasion sequence from the wanted runtime (exact-once). */
export function notePlayerEscaped(escapeSeq: number, gameDay: number, gameHour: number): void {
  ingestCareerEvent({
    id: `life:escape:${escapeSeq}`,
    kind: 'crime_escaped',
    gameDay,
    gameHour,
    skillAwards: [{ skill: 'street_smarts', amount: 6, reason: 'crime_escaped' }],
  })
}
