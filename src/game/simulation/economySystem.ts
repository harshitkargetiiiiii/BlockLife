import type { PlayerStats } from '../player/playerTypes'
import { advanceClock, sleepUntilMorning } from './timeSystem'
import { clampStat } from './needsSystem'

export const MEAL_COST = 10
export const MEAL_HUNGER_RESTORE = 25
export const COFFEE_COST = 5
export const TRAIN_ENERGY_COST = 20
export const WORK_ENERGY_COST = 30
export const WORK_PAY = 50
export const SLEEP_HUNGER_PENALTY = 10

export type EconomyResult =
  | { ok: true; stats: PlayerStats; message: string }
  | { ok: false; error: string }

export function buyMeal(stats: PlayerStats): EconomyResult {
  if (stats.money < MEAL_COST) return { ok: false, error: 'Not enough money for a meal.' }
  return {
    ok: true,
    stats: {
      ...stats,
      money: stats.money - MEAL_COST,
      hunger: clampStat(stats.hunger - MEAL_HUNGER_RESTORE),
    },
    message: `Ate a hot meal (-$${MEAL_COST}).`,
  }
}

export function buyCoffee(stats: PlayerStats): EconomyResult {
  if (stats.money < COFFEE_COST) return { ok: false, error: 'Not enough money for coffee.' }
  return {
    ok: true,
    stats: { ...stats, money: stats.money - COFFEE_COST },
    message: `Bought a coffee (-$${COFFEE_COST}).`,
  }
}

export function train(stats: PlayerStats): EconomyResult {
  if (stats.energy < TRAIN_ENERGY_COST) return { ok: false, error: 'Too tired to train.' }
  const clock = advanceClock(stats.day, stats.hour, 1)
  return {
    ok: true,
    stats: {
      ...stats,
      energy: clampStat(stats.energy - TRAIN_ENERGY_COST),
      strength: stats.strength + 1,
      day: clock.day,
      hour: clock.hour,
    },
    message: 'Trained hard. Strength +1!',
  }
}

export function workShift(stats: PlayerStats): EconomyResult {
  if (stats.energy < WORK_ENERGY_COST) return { ok: false, error: 'Too tired to work a shift.' }
  const clock = advanceClock(stats.day, stats.hour, 4)
  return {
    ok: true,
    stats: {
      ...stats,
      money: stats.money + WORK_PAY,
      energy: clampStat(stats.energy - WORK_ENERGY_COST),
      day: clock.day,
      hour: clock.hour,
    },
    message: `Worked a shift (+$${WORK_PAY}).`,
  }
}

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
