import { describe, expect, it } from 'vitest'
import { applyDialogueAction, getDialogue, type DialogueLogicState } from './DialogueSystem'
import { NPC_BY_ID } from '../../data/npcs'
import { INITIAL_STATS } from '../player/playerTypes'
import { COFFEE_QUEST_ID, QUEST_BY_ID } from '../../data/quests'
import { createEmptyNpcMemory } from './npcTypes'

function baseState(): DialogueLogicState {
  return {
    stats: { ...INITIAL_STATS },
    inventory: {},
    questStates: { [COFFEE_QUEST_ID]: 'not_started' },
    npcMemory: { npc_ravi_01: createEmptyNpcMemory() },
  }
}

describe('DialogueSystem', () => {
  const ravi = NPC_BY_ID['npc_ravi_01']

  it('Ravi offers the quest when not started', () => {
    const d = getDialogue(ravi, { [COFFEE_QUEST_ID]: 'not_started' }, undefined)
    expect(d.npcName).toBe('Ravi')
    expect(d.actions.some((a) => a.id === 'accept_quest')).toBe(true)
  })

  it('Ravi accepts a delivery when the player has coffee', () => {
    const d = getDialogue(ravi, { [COFFEE_QUEST_ID]: 'has_coffee' }, undefined)
    expect(d.actions.some((a) => a.id === 'deliver_coffee')).toBe(true)
  })

  it('accept_quest activates the quest and records the meeting', () => {
    const r = applyDialogueAction(baseState(), 'npc_ravi_01', 'accept_quest', 1)
    expect(r.state.questStates[COFFEE_QUEST_ID]).toBe('active')
    expect(r.state.npcMemory['npc_ravi_01'].greetedPlayer).toBe(true)
    expect(r.state.npcMemory['npc_ravi_01'].lastInteractionDay).toBe(1)
  })

  it('deliver_coffee pays the rewards and consumes the coffee', () => {
    const quest = QUEST_BY_ID[COFFEE_QUEST_ID]
    const state: DialogueLogicState = {
      ...baseState(),
      inventory: { coffee: 1 },
      questStates: { [COFFEE_QUEST_ID]: 'has_coffee' },
    }
    const r = applyDialogueAction(state, 'npc_ravi_01', 'deliver_coffee', 2)
    expect(r.state.questStates[COFFEE_QUEST_ID]).toBe('completed')
    expect(r.state.stats.money).toBe(INITIAL_STATS.money + quest.rewards.money)
    expect(r.state.stats.reputation).toBe(quest.rewards.reputation)
    expect(r.state.inventory['coffee']).toBeUndefined()
    expect(r.state.npcMemory['npc_ravi_01'].completedQuestIds).toContain(COFFEE_QUEST_ID)
  })

  it('deliver_coffee refuses without a coffee in the bag', () => {
    const state: DialogueLogicState = {
      ...baseState(),
      questStates: { [COFFEE_QUEST_ID]: 'has_coffee' },
    }
    const r = applyDialogueAction(state, 'npc_ravi_01', 'deliver_coffee', 2)
    expect(r.state.questStates[COFFEE_QUEST_ID]).toBe('has_coffee')
    expect(r.close).toBe(false)
  })

  it('chat builds trust once per day', () => {
    const first = applyDialogueAction(baseState(), 'npc_ravi_01', 'chat', 1)
    expect(first.state.npcMemory['npc_ravi_01'].trust).toBe(1)
    const second = applyDialogueAction(first.state, 'npc_ravi_01', 'chat', 1)
    expect(second.state.npcMemory['npc_ravi_01'].trust).toBe(1)
    const nextDay = applyDialogueAction(second.state, 'npc_ravi_01', 'chat', 2)
    expect(nextDay.state.npcMemory['npc_ravi_01'].trust).toBe(2)
  })
})
