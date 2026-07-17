import type { QuestEvent, QuestState } from './questTypes'

/**
 * Tiny finite state machine for quests. Invalid transitions return the
 * current state unchanged so callers never have to guard.
 */
const TRANSITIONS: Record<QuestState, Partial<Record<QuestEvent, QuestState>>> = {
  not_started: { ACCEPT: 'active' },
  active: { GET_COFFEE: 'has_coffee' },
  has_coffee: { DELIVER: 'completed' },
  completed: {},
}

export function questTransition(state: QuestState, event: QuestEvent): QuestState {
  return TRANSITIONS[state]?.[event] ?? state
}

export function isQuestState(v: unknown): v is QuestState {
  return v === 'not_started' || v === 'active' || v === 'has_coffee' || v === 'completed'
}
