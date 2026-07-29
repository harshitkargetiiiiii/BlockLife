import type { PlayerStats } from '../player/playerTypes'
import type { QuestState } from '../quests/questTypes'
import type { NPCMemory } from '../npc/npcTypes'
import type { Inventory } from '../interactables/interactionHandlers'
import type { MissionSaveData } from '../missions/missionPersistence'
import type { ActivitySaveData } from '../criminalActivities/activityPersistence'
import type { CommerceSaveData } from '../commerce/commercePersistence'
import type { SocialSaveData } from '../social/socialTypes'
import type { CareerSaveData } from '../careers/careerTypes'

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
  /**
   * Store Robbery v1 (additive, optional): per-store cooldowns, robbery counts
   * and secure receipts. Never an active robbery or unsecured proceeds. Older
   * saves lack it and load with fresh (un-robbed) stores.
   */
  activities?: ActivitySaveData
  /**
   * Personal Economy, Inventory & Shopping v1 (additive, optional): apartment
   * storage stacks, unlocked wardrobe palettes, and store stock + restock clocks
   * + bounded delivery receipts. Older saves lack these and load with empty
   * storage, no unlocks, and fresh full stock. The BACKPACK reuses `inventory`.
   */
  storage?: Inventory
  wardrobe?: { unlocked: string[] }
  commerce?: CommerceSaveData
  /**
   * Social Life, Relationships & NPC Memory v1 (additive, optional): per-NPC
   * relationships, bounded memory ledgers, unlocked contacts, and the exact-once
   * event id ledger. Older saves lack it and load as strangers; malformed social
   * data is sanitized field-by-field and can never corrupt the wider save.
   */
  social?: SocialSaveData
  /**
   * Career, Skills & Life Progression v1 (additive, optional): active employment,
   * career history/ranks, skill XP, employer standing, scheduled/active shifts,
   * performance history, unlocks, and exact-once event/pay ledgers + the reload-safe
   * shift-id counter. Older saves lack it and load unemployed with zero skills;
   * malformed career data is sanitized field-by-field and can never corrupt the save.
   */
  career?: CareerSaveData
}
