import type { Vec2 } from '../world/worldTypes'

/**
 * Police AI states (Crime & Law Enforcement v1). Architected for cover/
 * combat expansion; `taking_cover_placeholder` is reserved, not driven.
 */
export type PoliceState =
  | 'responding'
  | 'investigating'
  | 'ordering_stop'
  | 'pursuing_vehicle'
  | 'pursuing_on_foot'
  | 'searching'
  | 'attempting_arrest'
  | 'taking_cover_placeholder'
  | 'combat'
  | 'returning'
  | 'despawning'

export type PoliceKind = 'vehicle' | 'officer'

export interface PoliceUnit {
  id: string
  kind: PoliceKind
  state: PoliceState
  incidentId: string
  /** For a dismounted OFFICER: the cruiser it got out of (lifecycle link). */
  cruiserId?: string
  /** Current target the unit is moving toward (suspect or last-known). */
  target: Vec2 | null
  position: Vec2
  heading: number
  health: number
  spawnedAt: number
  /** Set when the unit currently has line of sight to the suspect. */
  seesSuspect: boolean
  /** Seconds spent in arrest range of a stopped suspect (arrest at hold). */
  arrestTimer: number
  /** Seconds since the unit last had line of sight (drives search). */
  timeSinceSeen: number
  /** Game time of this unit's last return-fire shot (combat only). */
  lastShotAt: number
}

export const POLICE_MAX_HEALTH = 100

/** Active-unit caps per wanted level (vehicles / officers). */
export const POLICE_CAPS: Record<number, { vehicles: number; officers: number }> = {
  0: { vehicles: 0, officers: 0 },
  1: { vehicles: 1, officers: 2 },
  2: { vehicles: 2, officers: 4 },
  3: { vehicles: 3, officers: 6 },
}
