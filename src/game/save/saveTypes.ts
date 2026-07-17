import type { PlayerStats } from '../player/playerTypes'
import type { QuestState } from '../quests/questTypes'
import type { NPCMemory } from '../npc/npcTypes'
import type { Inventory } from '../interactables/interactionHandlers'
import type { MissionSaveData } from '../missions/missionPersistence'

export const SAVE_KEY = 'blocklife-save-v1'
export const SAVE_VERSION = 1

export interface SaveData {
  version: number
  savedAt: number
  stats: PlayerStats
  inventory: Inventory
  questStates: Record<string, QuestState>
  npcMemory: Record<string, NPCMemory>
  playerPosition: [number, number, number]
  /**
   * Weather System v1 (additive, optional): older saves simply lack this
   * field and load with clear skies.
   */
  weather?: { kind: string; wetness: number }
  /**
   * Apartment v1 (additive, optional): outfit colors. Older saves lack this
   * field and load with the classic default look.
   */
  appearance?: { shirtColor: string; pantsColor: string; accentColor: string }
  /**
   * Crime v1 (additive, optional): player health persists (the only combat
   * state that does — wanted/police/weapon are transient). Older saves lack
   * it and load at full health.
   */
  playerHealth?: number
  /**
   * Mission & Activity Framework v1 (additive, optional): completed records,
   * cooldowns, discovered missions, and a safe (lawful) active mission. Older
   * saves lack it and load with no mission history.
   */
  missions?: MissionSaveData
}
