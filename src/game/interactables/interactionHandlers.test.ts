import { describe, expect, it } from 'vitest'
import { addItem, getActionsFor, performAction, type GameLogicState } from './interactionHandlers'
import { INITIAL_STATS } from '../player/playerTypes'
import { COFFEE_QUEST_ID } from '../../data/quests'

function baseState(): GameLogicState {
  return {
    stats: { ...INITIAL_STATS },
    inventory: {},
    questStates: { [COFFEE_QUEST_ID]: 'not_started' },
  }
}

describe('interactionHandlers.performAction', () => {
  it('buy_meal updates money and hunger', () => {
    const r = performAction({ ...baseState(), stats: { ...INITIAL_STATS, hunger: 50 } }, 'buy_meal')
    expect(r.ok).toBe(true)
    expect(r.state.stats.money).toBe(40)
    expect(r.state.stats.hunger).toBe(25)
  })

  it('buy_coffee adds a coffee item', () => {
    const r = performAction(baseState(), 'buy_coffee')
    expect(r.ok).toBe(true)
    expect(r.state.inventory['coffee']).toBe(1)
    expect(r.state.stats.money).toBe(45)
  })

  it('buy_coffee advances the quest only when it is active', () => {
    const notStarted = performAction(baseState(), 'buy_coffee')
    expect(notStarted.state.questStates[COFFEE_QUEST_ID]).toBe('not_started')

    const active = performAction(
      { ...baseState(), questStates: { [COFFEE_QUEST_ID]: 'active' } },
      'buy_coffee',
    )
    expect(active.state.questStates[COFFEE_QUEST_ID]).toBe('has_coffee')
  })

  it('train raises strength and burns energy', () => {
    const r = performAction(baseState(), 'train')
    expect(r.ok).toBe(true)
    expect(r.state.stats.strength).toBe(2)
    expect(r.state.stats.energy).toBe(80)
  })

  it('gym free access lets a tired player still train (waives the energy gate)', () => {
    const tired = { ...baseState(), stats: { ...INITIAL_STATS, energy: 10 } }
    expect(performAction(tired, 'train').ok).toBe(false) // normally blocked
    const r = performAction(tired, 'train', 0, { gymFreeAccess: true })
    expect(r.ok).toBe(true)
    expect(r.state.stats.strength).toBe(2)
  })

  it('sleep restores energy and moves to next morning', () => {
    const r = performAction(
      { ...baseState(), stats: { ...INITIAL_STATS, energy: 5, hour: 22 } },
      'sleep',
    )
    expect(r.ok).toBe(true)
    expect(r.state.stats.energy).toBe(100)
    expect(r.state.stats.day).toBe(2)
    expect(r.state.stats.hour).toBe(7)
  })

  it('failed actions leave state untouched', () => {
    const state = { ...baseState(), stats: { ...INITIAL_STATS, money: 2 } }
    const r = performAction(state, 'buy_meal')
    expect(r.ok).toBe(false)
    expect(r.state).toBe(state)
  })

  it('never mutates the input state', () => {
    const state = baseState()
    performAction(state, 'buy_coffee')
    expect(state.stats.money).toBe(INITIAL_STATS.money)
    expect(state.inventory['coffee']).toBeUndefined()
  })
})

describe('interactionHandlers.getActionsFor', () => {
  it('food truck offers meal and coffee', () => {
    const ids = getActionsFor('food_truck', baseState()).map((a) => a.id)
    expect(ids).toEqual(['buy_meal', 'buy_coffee'])
  })

  it('gym offers training, disabled when tired — unless free access is unlocked', () => {
    const tired = { ...baseState(), stats: { ...INITIAL_STATS, energy: 5 } }
    const actions = getActionsFor('gym', tired)
    expect(actions[0].id).toBe('train')
    expect(actions[0].disabled).toBe(true)
    // Gym free-access unlock waives the energy gate → the button is enabled (R4).
    expect(getActionsFor('gym', tired, 0, { gymFreeAccess: true })[0].disabled).toBe(false)
  })

  it('the job board opens Careers (not a money vendor), the apartment bed offers sleep', () => {
    expect(getActionsFor('job_board', baseState())[0].id).toBe('open_careers')
    // Home Base v1: the apartment door walks the player inside; sleeping
    // moved to the bed interactable in the interior.
    expect(getActionsFor('bed', baseState())[0].id).toBe('sleep')
    expect(getActionsFor('apartment', baseState())).toEqual([])
  })
})

describe('addItem', () => {
  it('adds and stacks items', () => {
    const inv = addItem(addItem({}, 'coffee'), 'coffee')
    expect(inv['coffee']).toBe(2)
  })

  it('removes items that reach zero', () => {
    const inv = addItem({ coffee: 1 }, 'coffee', -1)
    expect(inv['coffee']).toBeUndefined()
  })
})
