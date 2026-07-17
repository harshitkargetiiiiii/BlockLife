import { getSectorForRoadSegment } from '../../world/sectors/sectorContent'
import type { SectorId } from '../../world/sectors/worldGrid'
import { routeRuntime } from './routeRuntime'

export { getSectorForRoadSegment }

/**
 * Route ↔ sector integration. The road graph stays GLOBAL and immutable —
 * this is a side index only: which sectors a route touches next, so the
 * streaming policy can prewarm ground ahead of routed vehicles.
 *
 * Bounded horizon: only the next few planned segments are considered (no
 * whole-route scans, no per-frame graph work — the route plan is already an
 * ordered array, so lookahead is an O(horizon) map lookup).
 */

export const PREWARM_SEGMENT_HORIZON = 3

const prewarmScratch: SectorId[] = []

/** Sectors that active routed vehicles will need soon (deduped). */
export function getRoutePrewarmSectorIds(): readonly SectorId[] {
  prewarmScratch.length = 0
  for (const state of routeRuntime.states.values()) {
    const route = state.route
    if (!route) continue
    const end = Math.min(route.segmentIds.length, state.segmentIndex + 1 + PREWARM_SEGMENT_HORIZON)
    for (let i = state.segmentIndex; i < end; i++) {
      const meta = getSectorForRoadSegment(route.segmentIds[i])
      if (!meta) continue
      for (const sector of meta.touchedSectorIds) {
        if (!prewarmScratch.includes(sector)) prewarmScratch.push(sector)
      }
    }
  }
  return prewarmScratch
}

/** Ordered sector sequence a vehicle's remaining route passes through. */
export function getVehicleRouteSectorSequence(vehicleId: string): SectorId[] {
  const state = routeRuntime.states.get(vehicleId)
  const route = state?.route
  if (!state || !route) return []
  const out: SectorId[] = []
  for (let i = state.segmentIndex; i < route.segmentIds.length; i++) {
    const meta = getSectorForRoadSegment(route.segmentIds[i])
    if (!meta) continue
    for (const sector of meta.touchedSectorIds) {
      if (out[out.length - 1] !== sector && !out.includes(sector)) out.push(sector)
    }
  }
  return out
}
