import { CAR_HALF_LENGTH } from '../vehicleObstacles'
import { trafficRuntime } from '../trafficRuntime'
import type { RoadGraph, SegmentCongestion } from './roadGraphTypes'
import { findNearestSegment } from './routeRecovery'
import { routeRuntime } from './routeRuntime'

/**
 * Small, stable congestion layer: a per-segment snapshot rebuilt every
 * couple of seconds and consulted ONLY when planning new routes. Active
 * routes never react to it, penalties are capped well below typical detour
 * costs, so the fleet can never thrash in lockstep.
 */

export const CONGESTION_UPDATE_INTERVAL = 2
/** Penalty cap — meaningful congestion diverts, mild congestion doesn't. */
export const CONGESTION_PENALTY_CAP = 8

export function computeSegmentPenalty(
  occupancyRatio: number,
  stoppedVehicleCount: number,
): number {
  return Math.min(CONGESTION_PENALTY_CAP, occupancyRatio * 4 + stoppedVehicleCount * 2)
}

/** Rebuild the snapshot when the interval elapsed (early-outs otherwise). */
export function updateCongestionSnapshot(graph: RoadGraph, now: number): void {
  if (now - routeRuntime.congestionUpdatedAt < CONGESTION_UPDATE_INTERVAL) return
  routeRuntime.congestionUpdatedAt = now
  routeRuntime.congestion.clear()

  for (const car of trafficRuntime.cars.values()) {
    // Routed cars know their segment; loop cars map to the nearest lane.
    const routedState = routeRuntime.states.get(car.id)
    const segmentId =
      routedState?.route?.segmentIds[routedState.segmentIndex] ??
      findNearestSegment(graph, car.x, car.z, 4)?.segmentId
    if (!segmentId) continue
    const segment = graph.segments.get(segmentId)
    if (!segment) continue
    let entry = routeRuntime.congestion.get(segmentId)
    if (!entry) {
      entry = {
        segmentId,
        vehicleCount: 0,
        occupancyRatio: 0,
        stoppedVehicleCount: 0,
        speedRatio: 1,
        penalty: 0,
      } satisfies SegmentCongestion
      routeRuntime.congestion.set(segmentId, entry)
    }
    entry.vehicleCount += 1
    if (car.speed < 0.3) entry.stoppedVehicleCount += 1
    entry.occupancyRatio = Math.min(
      1,
      (entry.vehicleCount * CAR_HALF_LENGTH * 2) / Math.max(1, segment.length),
    )
    const ratio = segment.speedLimit > 0 ? car.speed / segment.speedLimit : 1
    entry.speedRatio = (entry.speedRatio * (entry.vehicleCount - 1) + ratio) / entry.vehicleCount
    entry.penalty = computeSegmentPenalty(entry.occupancyRatio, entry.stoppedVehicleCount)
  }
}
