import type { Vec2 } from '../world/worldTypes'

export interface NPCRoutineEntry {
  /** Start hour inclusive (0-24). */
  from: number
  /** End hour exclusive (0-24). Ranges may wrap past midnight (from > to). */
  to: number
  mode: 'idle' | 'patrol'
  /** idle: single anchor point. patrol: looped waypoints. */
  points: Vec2[]
}

export interface NPCDef {
  /** Stable semantic asset id (also the interactable id). */
  id: string
  name: string
  /** Short role line shown in dialogue. */
  role: string
  bodyColor: string
  headColor: string
  walkSpeed: number
  routine: NPCRoutineEntry[]
  /** Small talk lines shown as ambient speech bubbles. */
  ambientLines: string[]
  /**
   * Character pipeline v1: render this NPC through the rigged character
   * model instead of the primitive. Absent = primitive (the safe default;
   * NPCs opt in one by one as the pipeline scales).
   */
  characterAssetId?: string
}

export interface NPCMemory {
  greetedPlayer: boolean
  completedQuestIds: string[]
  trust: number
  lastInteractionDay: number
}

export function createEmptyNpcMemory(): NPCMemory {
  return { greetedPlayer: false, completedQuestIds: [], trust: 0, lastInteractionDay: 0 }
}
