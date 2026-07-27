import type { PlayerStats } from '../player/playerTypes'
import { advanceClock, sleepUntilMorning } from './timeSystem'
import { clampStat } from './needsSystem'

export const MEAL_COST = 10
export const MEAL_HUNGER_RESTORE = 25
export const COFFEE_COST = 5
export const TRAIN_ENERGY_COST = 20
export const SLEEP_HUNGER_PENALTY = 10

export type EconomyResult =
  | { ok: true; stats: PlayerStats; message: string }
  | { ok: false; error: string }

/** Apply a 0..1 loyalty discount to a base price (rounded, never below 0). */
export function discountedPrice(base: number, discountPct = 0): number {
  return Math.max(0, Math.round(base * (1 - Math.max(0, Math.min(1, discountPct)))))
}

export function buyMeal(stats: PlayerStats, discountPct = 0): EconomyResult {
  const cost = discountedPrice(MEAL_COST, discountPct)
  if (stats.money < cost) return { ok: false, error: 'Not enough money for a meal.' }
  return {
    ok: true,
    stats: {
      ...stats,
      money: stats.money - cost,
      hunger: clampStat(stats.hunger - MEAL_HUNGER_RESTORE),
    },
    message: `Ate a hot meal (-$${cost}).`,
  }
}

export function buyCoffee(stats: PlayerStats, discountPct = 0): EconomyResult {
  const cost = discountedPrice(COFFEE_COST, discountPct)
  if (stats.money < cost) return { ok: false, error: 'Not enough money for coffee.' }
  return {
    ok: true,
    stats: { ...stats, money: stats.money - cost },
    message: `Bought a coffee (-$${cost}).`,
  }
}

/** Train at the gym. With `freeAccess` (the Gym Trainer's earned "train off the clock"
 *  unlock, §8) the energy gate is waived and the drain is halved — a real, deterministic
 *  benefit the player keeps after being promoted. */
export function train(stats: PlayerStats, freeAccess = false): EconomyResult {
  if (!freeAccess && stats.energy < TRAIN_ENERGY_COST) return { ok: false, error: 'Too tired to train.' }
  const clock = advanceClock(stats.day, stats.hour, 1)
  const energyCost = freeAccess ? Math.round(TRAIN_ENERGY_COST / 2) : TRAIN_ENERGY_COST
  return {
    ok: true,
    stats: {
      ...stats,
      energy: clampStat(stats.energy - energyCost),
      strength: stats.strength + 1,
      day: clock.day,
      hour: clock.hour,
    },
    message: freeAccess ? 'Trained on the house — Strength +1!' : 'Trained hard. Strength +1!',
  }
}

// NB: the old `workShift` money-for-energy vendor was removed — paid work now flows
// exclusively through Careers v1 (apply → scheduled shift → objectives → exact-once
// pay). The Job Board opens the career flow instead of vending money (R4).

export function sleep(stats: PlayerStats): EconomyResult {
  const clock = sleepUntilMorning(stats.day, stats.hour)
  return {
    ok: true,
    stats: {
      ...stats,
      energy: 100,
      hunger: clampStat(stats.hunger + SLEEP_HUNGER_PENALTY),
      day: clock.day,
      hour: clock.hour,
    },
    message: 'Slept like a rock. Good morning!',
  }
}
