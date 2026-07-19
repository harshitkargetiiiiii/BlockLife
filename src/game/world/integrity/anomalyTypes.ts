/**
 * Typed runtime integrity anomalies (issue §10). The detector OBSERVES and
 * reports; the occupancy/streaming systems own correction — so diagnostics
 * never become a second hidden movement authority.
 */

export type AnomalyType =
  // occupancy
  | 'person_person_overlap'
  | 'person_vehicle_overlap'
  | 'person_solid_overlap'
  | 'vehicle_vehicle_overlap'
  // streaming / lifecycle
  | 'player_outside_coverage'
  | 'sector_stuck_loading'
  | 'generation_mismatch'
  | 'duplicate_entity'
  | 'stale_entity'
  // static world
  | 'prop_unsupported'
  | 'prop_visual_intersect'
  | 'world_ui_out_of_bounds'
  | 'building_missing_occluder'
  | 'district_capability_missing'
  // traffic
  | 'traffic_blocked'
  | 'honk_loop'

export type AnomalySeverity = 'warning' | 'error'

/** A live overlap/violation detection for one tick (pre-duration-tracking). */
export interface RawAnomaly {
  type: AnomalyType
  severity: AnomalySeverity
  /** Entity ids involved, sorted for a stable dedup key. */
  entityIds: string[]
  sectorId: string | null
  x?: number
  z?: number
  /** Penetration/overlap depth in world units, where meaningful. */
  depth?: number
  detail?: string
}

/** A tracked anomaly with first/last-seen bookkeeping for sustained detection. */
export interface AnomalyRecord extends RawAnomaly {
  /** `${type}:${entityIds.join('|')}` — dedup identity. */
  key: string
  firstSeenTick: number
  lastSeenTick: number
  /** Consecutive ticks the anomaly has persisted. */
  durationTicks: number
  /** Total times observed (for a hot-loop signal). */
  observations: number
}

export function anomalyKey(a: RawAnomaly): string {
  return `${a.type}:${[...a.entityIds].sort().join('|')}`
}
