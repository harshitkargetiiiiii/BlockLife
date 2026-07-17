import type { MissionDefinition, MissionStatus } from './missionTypes'
import { createRng, hashString } from '../traffic/routing/routeRng'

/**
 * Pure mission availability + deterministic target selection. No `Math.random`,
 * no scene access, no runtime mutation — everything is a function of explicit
 * inputs so it is fully unit-testable and reproducible.
 */

export interface AvailabilityContext {
  gameHours: number
  /** Id of the currently active mission, or null. */
  activeMissionId: string | null
  /** Mission ids the player has discovered (e.g. by visiting a fixer). */
  discovered: ReadonlySet<string>
  /** In-game hour at which each mission's cooldown ends. */
  cooldownReadyAt: Readonly<Record<string, number>>
}

/**
 * The mission's own availability status, independent of the one-active-mission
 * rule (the engine enforces that separately at start).
 */
export function getMissionAvailability(
  def: MissionDefinition,
  ctx: AvailabilityContext,
): MissionStatus {
  if (ctx.activeMissionId === def.id) return 'active'
  const readyAt = ctx.cooldownReadyAt[def.id]
  if (readyAt !== undefined && readyAt > ctx.gameHours) return 'cooldown'
  // Interactable-offered missions (the fixer) stay locked until discovered.
  if (def.offerSource.kind === 'interactable' && !ctx.discovered.has(def.id)) return 'locked'
  return 'available'
}

/**
 * Deterministically pick one target vehicle from the eligible candidates.
 * Seeded on mission + selector + attempt + game day, so the same attempt always
 * resolves the same target and never depends on iteration order or a remount.
 * Returns null when no candidate is eligible.
 */
export function selectMissionTarget(input: {
  missionId: string
  selectorId: string
  attemptSeq: number
  gameDay: number
  /** Eligible vehicle ids, already filtered by the caller (civilian, stealable,
   *  not disabled, not police, not mission-owned, valid sector, reachable). */
  candidates: readonly string[]
}): string | null {
  if (input.candidates.length === 0) return null
  // Sort candidates for a stable domain regardless of caller order.
  const sorted = [...input.candidates].sort()
  const rng = createRng(
    hashString(`${input.missionId}:${input.selectorId}:${input.attemptSeq}:${input.gameDay}`),
  )
  const idx = Math.floor(rng() * sorted.length) % sorted.length
  return sorted[idx]
}
