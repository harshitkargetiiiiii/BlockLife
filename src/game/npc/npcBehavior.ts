import type { NPCDef, NPCRoutineEntry } from './npcTypes'
import type { Vec2 } from '../world/worldTypes'

/** Finds the routine entry active at `hour`, handling ranges that wrap midnight. */
export function getRoutineForHour(npc: NPCDef, hour: number): NPCRoutineEntry {
  const h = ((hour % 24) + 24) % 24
  for (const entry of npc.routine) {
    if (entry.from <= entry.to) {
      if (h >= entry.from && h < entry.to) return entry
    } else if (h >= entry.from || h < entry.to) {
      return entry
    }
  }
  return npc.routine[0]
}

export interface MoveResult {
  position: Vec2
  arrived: boolean
  /** Normalized direction of travel; [0, 0] when arrived. */
  direction: Vec2
}

/** Steps `current` toward `target` by at most `maxStep`. */
export function moveTowards(current: Vec2, target: Vec2, maxStep: number): MoveResult {
  const dx = target[0] - current[0]
  const dz = target[1] - current[1]
  const dist = Math.hypot(dx, dz)
  if (dist <= maxStep || dist === 0) {
    return { position: [target[0], target[1]], arrived: true, direction: [0, 0] }
  }
  const nx = dx / dist
  const nz = dz / dist
  return {
    position: [current[0] + nx * maxStep, current[1] + nz * maxStep],
    arrived: false,
    direction: [nx, nz],
  }
}
