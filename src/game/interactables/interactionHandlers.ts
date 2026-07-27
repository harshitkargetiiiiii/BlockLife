import type { PlayerStats } from '../player/playerTypes'
import type { QuestState } from '../quests/questTypes'
import type { ActivityAction, InteractableKind } from './interactableTypes'
import {
  buyCoffee,
  buyMeal,
  discountedPrice,
  sleep,
  train,
  workShift,
  COFFEE_COST,
  MEAL_COST,
  TRAIN_ENERGY_COST,
  WORK_ENERGY_COST,
  WORK_PAY,
} from '../simulation/economySystem'
import { questTransition } from '../quests/questMachine'
import { COFFEE_QUEST_ID } from '../../data/quests'

export type Inventory = Record<string, number>

export interface GameLogicState {
  stats: PlayerStats
  inventory: Inventory
  questStates: Record<string, QuestState>
}

export interface ActionOutcome {
  ok: boolean
  message: string
  state: GameLogicState
}

export function addItem(inventory: Inventory, itemId: string, quantity = 1): Inventory {
  const next = { ...inventory, [itemId]: (inventory[itemId] ?? 0) + quantity }
  if (next[itemId] <= 0) delete next[itemId]
  return next
}

/** Available actions for an activity panel, with affordability baked in. */
export function getActionsFor(
  kind: InteractableKind,
  state: GameLogicState,
  foodDiscountPct = 0,
): ActivityAction[] {
  const { stats } = state
  switch (kind) {
    case 'food_truck': {
      const questActive = state.questStates[COFFEE_QUEST_ID] === 'active'
      const mealCost = discountedPrice(MEAL_COST, foodDiscountPct)
      const coffeeCost = discountedPrice(COFFEE_COST, foodDiscountPct)
      const loyal = foodDiscountPct > 0 ? ' · friend price' : ''
      return [
        {
          id: 'buy_meal',
          label: `🍜 Eat a hot meal — $${mealCost}`,
          detail: `Hunger −25${loyal}`,
          disabled: stats.money < mealCost,
          disabledReason: `Need $${mealCost}`,
        },
        {
          id: 'buy_coffee',
          label: `☕ Buy a coffee — $${coffeeCost}`,
          detail: (questActive ? 'Ravi is waiting for this!' : 'Goes in your bag') + loyal,
          disabled: stats.money < coffeeCost,
          disabledReason: `Need $${coffeeCost}`,
        },
      ]
    }
    case 'gym':
      return [
        {
          id: 'train',
          label: '💪 Train for an hour',
          detail: 'Strength +1 · Energy −20',
          disabled: stats.energy < TRAIN_ENERGY_COST,
          disabledReason: `Too tired — need ${TRAIN_ENERGY_COST} energy`,
        },
      ]
    case 'job_board':
      return [
        {
          id: 'work_shift',
          label: '🧰 Work a 4-hour shift',
          detail: `+$${WORK_PAY} · Energy −30`,
          disabled: stats.energy < WORK_ENERGY_COST,
          disabledReason: `Too tired — need ${WORK_ENERGY_COST} energy`,
        },
      ]
    // The apartment door now walks the player inside (Home Base v1);
    // sleeping happens at the bed in the interior.
    case 'bed':
      return [
        {
          id: 'sleep',
          label: '🛏️ Sleep until morning',
          detail: 'Energy → 100 · wake at 07:00',
        },
      ]
    default:
      return []
  }
}

/** Options threading earned career unlocks into interaction outcomes (§8). */
export interface PerformActionOptions {
  /** Gym Trainer's "train off the clock" unlock — waives the energy gate. */
  gymFreeAccess?: boolean
}

/** Applies an activity action to pure game state. Never mutates its input. */
export function performAction(state: GameLogicState, actionId: string, foodDiscountPct = 0, opts: PerformActionOptions = {}): ActionOutcome {
  switch (actionId) {
    case 'buy_meal': {
      const r = buyMeal(state.stats, foodDiscountPct)
      if (!r.ok) return { ok: false, message: r.error, state }
      return { ok: true, message: r.message, state: { ...state, stats: r.stats } }
    }
    case 'buy_coffee': {
      const r = buyCoffee(state.stats, foodDiscountPct)
      if (!r.ok) return { ok: false, message: r.error, state }
      const questState = state.questStates[COFFEE_QUEST_ID] ?? 'not_started'
      const nextQuest = questTransition(questState, 'GET_COFFEE')
      const message =
        nextQuest === 'has_coffee' && questState === 'active'
          ? 'Got the coffee — bring it to Ravi!'
          : r.message
      return {
        ok: true,
        message,
        state: {
          stats: r.stats,
          inventory: addItem(state.inventory, 'coffee', 1),
          questStates: { ...state.questStates, [COFFEE_QUEST_ID]: nextQuest },
        },
      }
    }
    case 'train': {
      const r = train(state.stats, opts.gymFreeAccess === true)
      if (!r.ok) return { ok: false, message: r.error, state }
      return { ok: true, message: r.message, state: { ...state, stats: r.stats } }
    }
    case 'work_shift': {
      const r = workShift(state.stats)
      if (!r.ok) return { ok: false, message: r.error, state }
      return { ok: true, message: r.message, state: { ...state, stats: r.stats } }
    }
    case 'sleep': {
      const r = sleep(state.stats)
      if (!r.ok) return { ok: false, message: r.error, state }
      return { ok: true, message: r.message, state: { ...state, stats: r.stats } }
    }
    default:
      return { ok: false, message: `Unknown action: ${actionId}`, state }
  }
}
