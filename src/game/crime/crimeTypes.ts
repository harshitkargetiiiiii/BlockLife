import type { Vec3 } from '../world/worldTypes'
import type { SectorId } from '../world/sectors/worldGrid'

/**
 * Crime & Law Enforcement Gameplay v1 — the central crime event model.
 * Every gameplay system that can implicate the player emits a CrimeEvent;
 * nothing else decides "criminal" independently. See
 * docs/CRIME_LAW_ENFORCEMENT.md.
 */

export type CrimeType =
  | 'vehicle_theft'
  | 'occupied_vehicle_theft'
  | 'assault'
  | 'weapon_discharge'
  | 'reckless_driving'
  | 'vehicle_collision'
  | 'hit_and_run'
  | 'attacking_police'
  | 'civilian_injury'
  | 'police_injury'
  /** Store Robbery v1: an armed robbery reported by an alarm/cashier. */
  | 'armed_robbery'

export type CrimeStatus = 'unseen' | 'witnessed' | 'reported' | 'expired'

export interface CrimeEvent {
  id: string
  type: CrimeType
  position: Vec3
  sectorId: SectorId
  gameTime: number
  severity: number
  noiseRadius: number
  visibleRadius: number
  suspectEntityId: string
  victimEntityId?: string
  vehicleId?: string
  weaponId?: string
  witnessedBy: string[]
  reportedBy?: string
  status: CrimeStatus
}

/** What a system passes to emit — ids/time/sector/status are filled in. */
export interface CrimeEmitInput {
  type: CrimeType
  position: Vec3
  suspectEntityId: string
  victimEntityId?: string
  vehicleId?: string
  weaponId?: string
  /** Override the table severity (rare — repeated-offense escalation). */
  severity?: number
}

/**
 * Per-type profile. `severity` feeds wanted heat; the radii bound witness
 * evaluation; `debounceSeconds` collapses repeated same-key emissions
 * (one collision/frame, rate-limited gunfire) into a single event.
 */
export interface CrimeProfile {
  severity: number
  noiseRadius: number
  visibleRadius: number
  debounceSeconds: number
}

export const CRIME_PROFILES: Record<CrimeType, CrimeProfile> = {
  vehicle_theft: { severity: 2, noiseRadius: 6, visibleRadius: 22, debounceSeconds: 2 },
  occupied_vehicle_theft: { severity: 4, noiseRadius: 14, visibleRadius: 26, debounceSeconds: 2 },
  assault: { severity: 3, noiseRadius: 10, visibleRadius: 20, debounceSeconds: 1 },
  weapon_discharge: { severity: 5, noiseRadius: 45, visibleRadius: 30, debounceSeconds: 0.4 },
  reckless_driving: { severity: 1, noiseRadius: 12, visibleRadius: 24, debounceSeconds: 3 },
  vehicle_collision: { severity: 2, noiseRadius: 16, visibleRadius: 24, debounceSeconds: 1.5 },
  hit_and_run: { severity: 4, noiseRadius: 18, visibleRadius: 26, debounceSeconds: 2 },
  attacking_police: { severity: 8, noiseRadius: 45, visibleRadius: 30, debounceSeconds: 0.4 },
  civilian_injury: { severity: 4, noiseRadius: 14, visibleRadius: 24, debounceSeconds: 1 },
  police_injury: { severity: 7, noiseRadius: 18, visibleRadius: 26, debounceSeconds: 0.6 },
  armed_robbery: { severity: 5, noiseRadius: 20, visibleRadius: 26, debounceSeconds: 2 },
}
