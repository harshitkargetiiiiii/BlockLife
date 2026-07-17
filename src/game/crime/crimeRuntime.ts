import type { Vec3 } from '../world/worldTypes'
import { worldToSectorId } from '../world/sectors/worldGrid'
import {
  CRIME_PROFILES,
  type CrimeEmitInput,
  type CrimeEvent,
  type CrimeStatus,
} from './crimeTypes'

/**
 * The central crime event runtime — a module singleton (survives sector
 * streaming; holds ids/positions, never scene objects). Emission is
 * deterministic (monotonic seq ids), debounced per (type,suspect,target)
 * key, and bounded to a ring of the most recent events. The game clock is
 * passed IN so the runtime stays pure and unit-testable and so pause/test
 * pinning is deterministic. Crime events are TRANSIENT (never persisted).
 */

const MAX_EVENTS = 64
/** Events older than this (in game seconds) auto-expire. */
export const CRIME_EXPIRY_SECONDS = 45

export const crimeRuntime = {
  seq: 0,
  events: [] as CrimeEvent[],
  /** debounce key → last emit gameTime. */
  lastEmit: new Map<string, number>(),
  debugEnabled: false,
}

function debounceKey(input: CrimeEmitInput): string {
  return `${input.type}:${input.suspectEntityId}:${input.victimEntityId ?? input.vehicleId ?? ''}`
}

/**
 * Emit a crime event, or return the existing one when the same
 * (type,suspect,target) key fired within its debounce window. Returns null
 * only when debounced. `gameTime` is unpaused sim seconds.
 */
export function emitCrime(input: CrimeEmitInput, gameTime: number): CrimeEvent | null {
  const profile = CRIME_PROFILES[input.type]
  const key = debounceKey(input)
  const last = crimeRuntime.lastEmit.get(key)
  if (last !== undefined && gameTime - last < profile.debounceSeconds) {
    return null
  }
  crimeRuntime.lastEmit.set(key, gameTime)

  const event: CrimeEvent = {
    id: `crime_${crimeRuntime.seq++}`,
    type: input.type,
    position: [...input.position] as Vec3,
    sectorId: worldToSectorId(input.position[0], input.position[2]),
    gameTime,
    severity: input.severity ?? profile.severity,
    noiseRadius: profile.noiseRadius,
    visibleRadius: profile.visibleRadius,
    suspectEntityId: input.suspectEntityId,
    victimEntityId: input.victimEntityId,
    vehicleId: input.vehicleId,
    weaponId: input.weaponId,
    witnessedBy: [],
    status: 'unseen',
  }
  crimeRuntime.events.push(event)
  // Bounded ring: drop the oldest once over cap.
  if (crimeRuntime.events.length > MAX_EVENTS) {
    crimeRuntime.events.splice(0, crimeRuntime.events.length - MAX_EVENTS)
  }
  return event
}

/** Mark a witness on an open event; promotes unseen → witnessed. */
export function recordWitness(eventId: string, witnessId: string): void {
  const e = crimeRuntime.events.find((x) => x.id === eventId)
  if (!e || e.status === 'expired') return
  if (!e.witnessedBy.includes(witnessId)) e.witnessedBy.push(witnessId)
  if (e.status === 'unseen') e.status = 'witnessed'
}

/** Mark an event reported (idempotent — first reporter sticks). */
export function recordReport(eventId: string, reporterId: string): void {
  const e = crimeRuntime.events.find((x) => x.id === eventId)
  if (!e || e.status === 'expired' || e.status === 'reported') return
  e.status = 'reported'
  e.reportedBy = reporterId
}

/** Expire stale UNREPORTED events; reported ones live until wanted clears. */
export function expireCrimes(gameTime: number): void {
  for (const e of crimeRuntime.events) {
    if (e.status === 'reported' || e.status === 'expired') continue
    if (gameTime - e.gameTime >= CRIME_EXPIRY_SECONDS) e.status = 'expired'
  }
}

/** Open events (unseen/witnessed) — the only ones witness eval scans. */
export function getOpenCrimes(): CrimeEvent[] {
  return crimeRuntime.events.filter((e) => e.status === 'unseen' || e.status === 'witnessed')
}

export function getCrimeEventsByStatus(status: CrimeStatus): CrimeEvent[] {
  return crimeRuntime.events.filter((e) => e.status === status)
}

/** Snapshot for the dev/test API + debug panel (cloned, wire-safe). */
export function getCrimeEventsSnapshot(): CrimeEvent[] {
  return crimeRuntime.events.map((e) => ({ ...e, position: [...e.position] as Vec3, witnessedBy: [...e.witnessedBy] }))
}

/** Transient reset (resetGame / save load). */
export function resetCrimeRuntime(): void {
  crimeRuntime.seq = 0
  crimeRuntime.events.length = 0
  crimeRuntime.lastEmit.clear()
}
