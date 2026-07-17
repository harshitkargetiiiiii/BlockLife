import type { PlayerStats } from '../player/playerTypes'
import { advanceClock } from './timeSystem'

export const HUNGER_PER_HOUR = 4
export const RUN_ENERGY_PER_HOUR = 10
export const DRIVE_ENERGY_PER_HOUR = 3

export interface ActivityFlags {
  running: boolean
  driving: boolean
}

export function clampStat(v: number): number {
  return Math.min(100, Math.max(0, v))
}

/** Advances the clock and applies passive hunger growth + activity energy drain. */
export function tickNeeds(stats: PlayerStats, dtHours: number, flags: ActivityFlags): PlayerStats {
  const clock = advanceClock(stats.day, stats.hour, dtHours)
  let energyDrain = 0
  if (flags.running) energyDrain += RUN_ENERGY_PER_HOUR * dtHours
  if (flags.driving) energyDrain += DRIVE_ENERGY_PER_HOUR * dtHours
  return {
    ...stats,
    day: clock.day,
    hour: clock.hour,
    hunger: clampStat(stats.hunger + HUNGER_PER_HOUR * dtHours),
    energy: clampStat(stats.energy - energyDrain),
  }
}

/**
 * Hunger above 80 or energy below 20 slows the player. Effects stack but are
 * floored so the game never feels unplayably sluggish.
 */
export function getSpeedModifier(stats: PlayerStats): number {
  let mod = 1
  if (stats.hunger > 80) mod *= 0.7
  if (stats.energy < 20) mod *= 0.7
  return Math.max(0.5, mod)
}
