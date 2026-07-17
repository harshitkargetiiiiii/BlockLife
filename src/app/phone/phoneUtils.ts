import type { PlayerStats } from '../../game/player/playerTypes'
import type { QuestState } from '../../game/quests/questTypes'
import type { WorldMood } from '../../game/world/worldTypes'
import { CITY_BOUNDS, GATEWAY } from '../../game/world/cityLayout'
import { COMPILED_SECTORS } from '../../game/world/authoring/compiledSectors'
import { COFFEE_QUEST_ID } from '../../data/quests'

/**
 * World extent shown on the phone map: derived from the playable content
 * areas (original city bounds + each expansion sector's walled area) rather
 * than a hardcoded rectangle — new sectors appear automatically.
 */
const AREAS = [
  CITY_BOUNDS,
  GATEWAY.area,
  ...COMPILED_SECTORS.map((c) => c.spec.area),
  ...COMPILED_SECTORS.flatMap((c) => c.spec.water ?? []),
]
export const MAP_BOUNDS = {
  minX: Math.min(...AREAS.map((a) => a.minX)),
  maxX: Math.max(...AREAS.map((a) => a.maxX)),
  minZ: Math.min(...AREAS.map((a) => a.minZ)),
  maxZ: Math.max(...AREAS.map((a) => a.maxZ)),
}

/**
 * One short flavor line for the phone home screen, picked by priority:
 * pressing needs first, then quest nudges, then time-of-day vibes.
 */
export function getFlavorLine(
  stats: PlayerStats,
  questStates: Record<string, QuestState>,
  mood: WorldMood,
): string {
  if (stats.hunger > 70) return 'You should eat soon.'
  if (stats.energy < 30) return 'You look cooked. Sleep or chill.'
  const quest = questStates[COFFEE_QUEST_ID]
  if (quest === 'active') return 'Ravi is waiting on that coffee.'
  if (quest === 'has_coffee') return 'That coffee is getting cold — find Ravi.'
  if (mood === 'night') return 'City lights are doing their thing.'
  if (mood === 'morning') return 'Fresh morning on the block.'
  if (mood === 'evening') return 'Golden hour. Go touch grass.'
  return 'A perfectly ordinary block afternoon.'
}

/**
 * Flavor line while the player is inside the apartment: pressing needs
 * first, then cozy weather vibes.
 */
export function getApartmentFlavorLine(stats: PlayerStats, weather: string): string {
  if (stats.energy < 30) return 'Your bed is right there.'
  if (stats.hunger > 70) return 'The fridge is empty — hit the snack truck.'
  if (weather === 'rain') return 'Rain on the window. Cozy.'
  if (weather === 'foggy') return 'Fog outside. Warm inside.'
  return 'Home sweet home.'
}

/**
 * Maps world x/z to percentage coordinates for the phone's 2D mini-map.
 * North (−z) is up. Bounds derive from the authored world (MAP_BOUNDS).
 */
export function worldToMap(x: number, z: number): { left: number; top: number } {
  return {
    left: ((x - MAP_BOUNDS.minX) / (MAP_BOUNDS.maxX - MAP_BOUNDS.minX)) * 100,
    top: ((z - MAP_BOUNDS.minZ) / (MAP_BOUNDS.maxZ - MAP_BOUNDS.minZ)) * 100,
  }
}

/** World width / height as percentages of map size (for sized shapes). */
export function worldSizeToMap(w: number, d: number): { width: number; height: number } {
  return {
    width: (w / (MAP_BOUNDS.maxX - MAP_BOUNDS.minX)) * 100,
    height: (d / (MAP_BOUNDS.maxZ - MAP_BOUNDS.minZ)) * 100,
  }
}

/** Battery is decorative but playful: it mirrors the player's energy. */
export function getBatteryLevel(stats: PlayerStats): number {
  return Math.round(stats.energy)
}
