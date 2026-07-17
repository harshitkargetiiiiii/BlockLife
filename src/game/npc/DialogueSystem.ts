import type { NPCDef, NPCMemory } from './npcTypes'
import type { QuestState } from '../quests/questTypes'
import type { GameLogicState } from '../interactables/interactionHandlers'
import { addItem } from '../interactables/interactionHandlers'
import { questTransition } from '../quests/questMachine'
import { COFFEE_QUEST_ID, QUEST_BY_ID } from '../../data/quests'
import { clampStat } from '../simulation/needsSystem'

export interface DialogueAction {
  id: string
  label: string
}

export interface Dialogue {
  npcId: string
  npcName: string
  role: string
  text: string
  actions: DialogueAction[]
}

export interface DialogueLogicState extends GameLogicState {
  npcMemory: Record<string, NPCMemory>
}

export interface DialogueOutcome {
  state: DialogueLogicState
  message: string | null
  /** Close the panel after this action. */
  close: boolean
}

/** Resolves what an NPC says right now, based on quest state and memory. */
export function getDialogue(
  npc: NPCDef,
  questStates: Record<string, QuestState>,
  memory: NPCMemory | undefined,
): Dialogue {
  const base: Dialogue = {
    npcId: npc.id,
    npcName: npc.name,
    role: npc.role,
    text: '',
    actions: [{ id: 'close', label: 'See you!' }],
  }

  if (npc.id === 'npc_ravi_01') {
    const q = questStates[COFFEE_QUEST_ID] ?? 'not_started'
    switch (q) {
      case 'not_started':
        return {
          ...base,
          text: "Hey! Rough morning — I'd do anything for a coffee from Maya's truck. Could you grab me one?",
          actions: [
            { id: 'accept_quest', label: 'Sure, one coffee coming up!' },
            { id: 'close', label: 'Maybe later' },
          ],
        }
      case 'active':
        return {
          ...base,
          text: "Maya's truck is right on the plaza — orange one, you can't miss it. Best coffee on the block!",
        }
      case 'has_coffee':
        return {
          ...base,
          text: 'Is that coffee for me? You absolute legend!',
          actions: [
            { id: 'deliver_coffee', label: 'Hand over the coffee' },
            { id: 'close', label: 'Not yet' },
          ],
        }
      case 'completed':
        return {
          ...base,
          text: 'That coffee saved my day. I owe you one, friend!',
        }
    }
  }

  const greeted = memory?.greetedPlayer
  const lines: Record<string, string> = {
    npc_maya_01: greeted
      ? 'Back again! The usual? Walk up to the truck window and order.'
      : "Welcome to my snack truck! Hot meals, fresh coffee — walk up to the window and I'll fix you up.",
    npc_bruno_01: greeted
      ? 'Ready for another session? The gym is always open for you.'
      : "New face! I'm Bruno — I run the Block Gym. Come train, first rep is free. So are all the others.",
    npc_leo_01: 'Can’t stop — packages wait for no one! Catch me on my next loop.',
    npc_kim_01: greeted
      ? 'Block is quiet today. Just how I like it.'
      : "Officer Kim, neighborhood patrol. Keep it friendly out here and we'll get along great.",
    npc_nisha_01: greeted
      ? 'The park bench by the pond is my favorite spot. Try it sometime.'
      : "Oh hi, you're the new neighbor! I'm Nisha. If you need anything, I'm usually around the park.",
  }

  return {
    ...base,
    text: lines[npc.id] ?? 'Nice day on the block, huh?',
    actions: [
      { id: 'chat', label: 'Nice to meet you!' },
      { id: 'close', label: 'See you!' },
    ],
  }
}

/** Applies a dialogue action. Pure: returns new state, never mutates. */
export function applyDialogueAction(
  state: DialogueLogicState,
  npcId: string,
  actionId: string,
  today: number,
): DialogueOutcome {
  const memory = state.npcMemory[npcId]
  const touchMemory = (extra?: Partial<NPCMemory>): Record<string, NPCMemory> => ({
    ...state.npcMemory,
    [npcId]: {
      greetedPlayer: true,
      completedQuestIds: memory?.completedQuestIds ?? [],
      trust: (memory?.trust ?? 0) + (memory?.lastInteractionDay === today ? 0 : 1),
      lastInteractionDay: today,
      ...extra,
    },
  })

  switch (actionId) {
    case 'accept_quest': {
      const q = state.questStates[COFFEE_QUEST_ID] ?? 'not_started'
      return {
        state: {
          ...state,
          questStates: { ...state.questStates, [COFFEE_QUEST_ID]: questTransition(q, 'ACCEPT') },
          npcMemory: touchMemory(),
        },
        message: 'Quest started: Coffee for Ravi',
        close: true,
      }
    }
    case 'deliver_coffee': {
      const q = state.questStates[COFFEE_QUEST_ID] ?? 'not_started'
      if (q !== 'has_coffee' || (state.inventory['coffee'] ?? 0) < 1) {
        return { state, message: "You don't have a coffee yet.", close: false }
      }
      const quest = QUEST_BY_ID[COFFEE_QUEST_ID]
      return {
        state: {
          stats: {
            ...state.stats,
            money: state.stats.money + quest.rewards.money,
            reputation: clampStat(state.stats.reputation + quest.rewards.reputation),
          },
          inventory: addItem(state.inventory, 'coffee', -1),
          questStates: { ...state.questStates, [COFFEE_QUEST_ID]: questTransition(q, 'DELIVER') },
          npcMemory: touchMemory({
            completedQuestIds: [...(memory?.completedQuestIds ?? []), COFFEE_QUEST_ID],
            trust: (memory?.trust ?? 0) + 2,
          }),
        },
        message: `Quest complete! +$${quest.rewards.money}, +${quest.rewards.reputation} reputation`,
        close: true,
      }
    }
    case 'chat':
      return { state: { ...state, npcMemory: touchMemory() }, message: null, close: true }
    default:
      return { state, message: null, close: true }
  }
}
