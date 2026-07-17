import type { QuestDef } from '../game/quests/questTypes'

export const COFFEE_QUEST_ID = 'coffee_for_ravi'

export const QUEST_DEFS: QuestDef[] = [
  {
    id: COFFEE_QUEST_ID,
    title: 'Coffee for Ravi',
    giverNpcId: 'npc_ravi_01',
    steps: {
      not_started: 'Talk to Ravi — he looks like he needs something.',
      active: "Buy a coffee ($5) from Maya's Snack Truck.",
      has_coffee: 'Bring the coffee back to Ravi.',
      completed: 'Completed — Ravi got his coffee!',
    },
    rewards: { money: 25, reputation: 5 },
  },
]

export const QUEST_BY_ID: Record<string, QuestDef> = Object.fromEntries(
  QUEST_DEFS.map((q) => [q.id, q]),
)
