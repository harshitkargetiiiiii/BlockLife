import { useGameStore } from '../../game/store/useGameStore'
import { NPC_BY_ID } from '../../data/npcs'
import type { PlayerStats } from '../../game/player/playerTypes'
import type { QuestState } from '../../game/quests/questTypes'
import { getMood } from '../../game/simulation/worldMoodSystem'
import { COFFEE_QUEST_ID } from '../../data/quests'

interface PhoneMessage {
  npcId: string
  text: string
}

/**
 * Deterministic flavor feed — no real messaging, no APIs. Each resident
 * "texts" one line derived from current game state.
 */
export function buildMessages(
  stats: PlayerStats,
  questStates: Record<string, QuestState>,
): PhoneMessage[] {
  const mood = getMood(stats.hour)
  const quest = questStates[COFFEE_QUEST_ID] ?? 'not_started'

  const ravi: Record<QuestState, string> = {
    not_started: 'yo! swing by when you have a sec, need a tiny favor 👀',
    active: 'any luck with that coffee? ☕ maya makes the best one',
    has_coffee: 'is that coffee I smell?? bring it over!!',
    completed: "you're a legend. next one's on me 🙏",
  }

  const daytime = stats.hour >= 6 && stats.hour < 22

  return [
    { npcId: 'npc_ravi_01', text: ravi[quest] },
    {
      npcId: 'npc_maya_01',
      text: daytime
        ? "truck's open! fresh coffee + hot meals ☀️"
        : 'closing up for tonight — catch me tomorrow!',
    },
    {
      npcId: 'npc_bruno_01',
      text:
        stats.energy >= 50
          ? 'you look ready. come lift something heavy 💪'
          : 'rest up first. the gym will still be here.',
    },
    {
      npcId: 'npc_leo_01',
      text: '3 deliveries left on my loop. this block keeps me FIT',
    },
    {
      npcId: 'npc_kim_01',
      text:
        stats.reputation >= 5
          ? 'hearing good things about you around the block 👍'
          : 'all quiet tonight. keep it friendly out there.',
    },
    {
      npcId: 'npc_nisha_01',
      text:
        mood === 'night'
          ? 'the lamps by the pond look so pretty right now 🌙'
          : 'park bench by the pond. best seat on the block.',
    },
  ]
}

export function PhoneMessages() {
  const stats = useGameStore((s) => s.stats)
  const questStates = useGameStore((s) => s.questStates)
  const messages = buildMessages(stats, questStates)

  return (
    <div className="phone-app">
      <div className="phone-section-title">Chats</div>
      <div className="phone-messages" data-testid="phone-messages">
        {messages.map((m) => {
          const npc = NPC_BY_ID[m.npcId]
          if (!npc) return null
          return (
            <div key={m.npcId} className="phone-message" data-testid={`phone-message-${m.npcId}`}>
              <span className="phone-avatar" style={{ background: npc.bodyColor }}>
                {npc.name[0]}
              </span>
              <div className="phone-message-body">
                <div className="phone-message-name">{npc.name}</div>
                <div className="phone-message-text">{m.text}</div>
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
