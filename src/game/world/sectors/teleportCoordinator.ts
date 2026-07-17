import type { SectorId } from './worldGrid'
import { worldToSectorId } from './worldGrid'
import { isAuthoredSector } from './sectorRegistry'
import { isSectorReadyForGameplay } from './sectorStreaming'

/**
 * One shared teleport pipeline for debug teleports, the test API, save/load
 * placement and the apartment exit (and future fast travel).
 *
 * Contract: while a teleport is pending, its destination sector is the
 * HIGHEST-priority streaming demand (the director reads
 * teleportRuntime.destinationSectorId every tick). The player is moved only
 * once the destination reports visuals AND colliders ready; on failure or
 * cancel the player never moves.
 */

export interface TeleportRuntime {
  /** Destination currently being prepared (streaming reads this). */
  destinationSectorId: SectorId | null
  pendingPosition: [number, number, number] | null
  /** Monotonic id so stale completions can't commit an old request. */
  requestSeq: number
}

export const teleportRuntime: TeleportRuntime = {
  destinationSectorId: null,
  pendingPosition: null,
  requestSeq: 0,
}

/** Begin preparing a teleport; returns the request id. */
export function prepareTeleport(position: [number, number, number]): number {
  teleportRuntime.requestSeq += 1
  teleportRuntime.pendingPosition = position
  const sector = worldToSectorId(position[0], position[2])
  teleportRuntime.destinationSectorId = isAuthoredSector(sector) ? sector : null
  return teleportRuntime.requestSeq
}

/** True when the pending destination's ground is safe to arrive on. */
export function isTeleportDestinationReady(): boolean {
  const sector = teleportRuntime.destinationSectorId
  if (!sector) return true // unauthored void: global safety ground applies
  return isSectorReadyForGameplay(sector)
}

/** Clear the pending request (after commit or cancel). */
export function completeTeleport(requestSeq: number): void {
  if (requestSeq !== teleportRuntime.requestSeq) return // stale
  teleportRuntime.destinationSectorId = null
  teleportRuntime.pendingPosition = null
}

export function cancelTeleport(): void {
  teleportRuntime.destinationSectorId = null
  teleportRuntime.pendingPosition = null
}
