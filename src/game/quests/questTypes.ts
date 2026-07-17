export type QuestState = 'not_started' | 'active' | 'has_coffee' | 'completed'

export type QuestEvent = 'ACCEPT' | 'GET_COFFEE' | 'DELIVER'

export interface QuestDef {
  id: string
  title: string
  giverNpcId: string
  /** Player-facing description of what to do in each state. */
  steps: Record<QuestState, string>
  rewards: { money: number; reputation: number }
}

export const QUEST_STATES: QuestState[] = ['not_started', 'active', 'has_coffee', 'completed']
