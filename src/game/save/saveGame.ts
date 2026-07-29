import { del, get, set } from 'idb-keyval'
import type { SaveData } from './saveTypes'
import { SAVE_KEY, SAVE_VERSION } from './saveTypes'
import type { PlayerStats } from '../player/playerTypes'
import type { QuestState } from '../quests/questTypes'
import type { NPCMemory } from '../npc/npcTypes'
import type { Inventory } from '../interactables/interactionHandlers'
import { isQuestState } from '../quests/questMachine'
import { isWeatherKind } from '../weather/weatherTypes'
import { isPlayerAppearance } from '../interiors/interiorTypes'
import { isValidMissionSave, type MissionSaveData } from '../missions/missionPersistence'
import { isValidActivitySave, type ActivitySaveData } from '../criminalActivities/activityPersistence'
import type { CommerceSaveData } from '../commerce/commercePersistence'
import type { SocialSaveData } from '../social/socialTypes'
import type { CareerSaveData } from '../careers/careerTypes'
import type { HousingSaveData } from '../housing/housingTypes'

export interface SnapshotInput {
  stats: PlayerStats
  inventory: Inventory
  questStates: Record<string, QuestState>
  npcMemory: Record<string, NPCMemory>
  playerPosition: [number, number, number]
  weather?: { kind: string; wetness: number }
  appearance?: { shirtColor: string; pantsColor: string; accentColor: string }
  playerHealth?: number
  missions?: MissionSaveData
  activities?: ActivitySaveData
  storage?: Inventory
  wardrobe?: { unlocked: string[] }
  commerce?: CommerceSaveData
  social?: SocialSaveData
  career?: CareerSaveData
  housing?: HousingSaveData
}

export function createSnapshot(input: SnapshotInput): SaveData {
  // structuredClone guards against accidental shared references with live state.
  return structuredClone({
    version: SAVE_VERSION,
    savedAt: Date.now(),
    stats: input.stats,
    inventory: input.inventory,
    questStates: input.questStates,
    npcMemory: input.npcMemory,
    playerPosition: input.playerPosition,
    weather: input.weather,
    appearance: input.appearance,
    playerHealth: input.playerHealth,
    missions: input.missions,
    activities: input.activities,
    storage: input.storage,
    wardrobe: input.wardrobe,
    commerce: input.commerce,
    social: input.social,
    career: input.career,
    housing: input.housing,
  })
}

export function isValidSave(value: unknown): value is SaveData {
  if (typeof value !== 'object' || value === null) return false
  const v = value as Record<string, unknown>
  if (v.version !== SAVE_VERSION) return false
  const stats = v.stats as Record<string, unknown> | undefined
  if (!stats) return false
  for (const key of ['money', 'hunger', 'energy', 'reputation', 'strength', 'day', 'hour']) {
    if (typeof stats[key] !== 'number' || !Number.isFinite(stats[key])) return false
  }
  if (typeof v.inventory !== 'object' || v.inventory === null) return false
  if (typeof v.questStates !== 'object' || v.questStates === null) return false
  if (!Object.values(v.questStates).every(isQuestState)) return false
  if (typeof v.npcMemory !== 'object' || v.npcMemory === null) return false
  if (!Array.isArray(v.playerPosition) || v.playerPosition.length !== 3) return false
  if (!v.playerPosition.every((n) => typeof n === 'number' && Number.isFinite(n))) return false
  // Weather is optional (pre-weather saves) but must be sane when present.
  if (v.weather !== undefined) {
    const w = v.weather as Record<string, unknown>
    if (typeof w !== 'object' || w === null) return false
    if (!isWeatherKind(w.kind)) return false
    if (typeof w.wetness !== 'number' || !Number.isFinite(w.wetness)) return false
  }
  // Appearance is optional (pre-apartment saves) but must be sane when present.
  if (v.appearance !== undefined && !isPlayerAppearance(v.appearance)) return false
  // Player health is optional (pre-crime saves) but must be sane when present.
  if (
    v.playerHealth !== undefined &&
    (typeof v.playerHealth !== 'number' || !Number.isFinite(v.playerHealth))
  ) {
    return false
  }
  // Missions are optional (pre-mission saves) but must be sane when present.
  if (v.missions !== undefined && !isValidMissionSave(v.missions)) return false
  // Activities are optional (pre-robbery saves) but must be sane when present.
  if (v.activities !== undefined && !isValidActivitySave(v.activities)) return false
  return true
}

export async function persistSave(data: SaveData): Promise<void> {
  await set(SAVE_KEY, data)
}

export async function loadSave(): Promise<SaveData | null> {
  const raw = await get(SAVE_KEY)
  return isValidSave(raw) ? raw : null
}

export async function clearSave(): Promise<void> {
  await del(SAVE_KEY)
}
