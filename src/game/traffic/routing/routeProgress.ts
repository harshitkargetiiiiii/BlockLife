import type { Vec2 } from '../../world/worldTypes'
import type { LaneSegment, RoadGraph } from './roadGraphTypes'
import { closestPointOnSegment, pointAtProgress } from './roadGraphBuilder'
import type { VehicleRouteState } from './routeRuntime'

/**
 * Route progress: an explicit (segmentIndex, pointIndex) cursor over the
 * planned segment polylines — the same waypoint-following model the loop
 * cars have always used, extended across segment boundaries.
 *
 * - the current segment is authoritative
 * - the cursor advances exactly one waypoint per arrival, one segment per
 *   endpoint — a fast frame cannot skip a junction
 * - completion fires only on the FINAL segment at the destination anchor,
 *   never on mere proximity to the destination point from another lane
 */

/** Cursor arrival tolerance (matches moveTowards' arrive semantics). */
export const WAYPOINT_ARRIVE_EPSILON = 0.05
/** Distance beyond which the car is considered off its route corridor. */
export const OFF_LANE_DISTANCE = 3.5

export function currentSegment(graph: RoadGraph, state: VehicleRouteState): LaneSegment | null {
  const id = state.route?.segmentIds[state.segmentIndex]
  return id ? (graph.segments.get(id) ?? null) : null
}

export function nextSegment(graph: RoadGraph, state: VehicleRouteState): LaneSegment | null {
  const id = state.route?.segmentIds[state.segmentIndex + 1]
  return id ? (graph.segments.get(id) ?? null) : null
}

export function isOnFinalSegment(state: VehicleRouteState): boolean {
  return state.route !== null && state.segmentIndex >= state.route.segmentIds.length - 1
}

/**
 * The point the car should drive toward right now: the next polyline
 * waypoint of the current segment, or the destination anchor on the final
 * segment once every intermediate waypoint before it has been consumed.
 */
export function getCurrentRouteTarget(graph: RoadGraph, state: VehicleRouteState): Vec2 | null {
  const seg = currentSegment(graph, state)
  if (!seg || !state.route) return null
  if (isOnFinalSegment(state)) {
    const anchor = pointAtProgress(seg, state.route.destinationProgress)
    // Consume intermediate waypoints that still lie before the anchor.
    const next = seg.points[state.pointIndex + 1]
    if (next && progressOfPointIndex(seg, state.pointIndex + 1) < state.route.destinationProgress) {
      return next
    }
    return anchor
  }
  const next = seg.points[state.pointIndex + 1]
  return next ? next : seg.points[seg.points.length - 1]
}

/** Normalized progress of a waypoint index along its segment. */
export function progressOfPointIndex(seg: LaneSegment, pointIndex: number): number {
  if (seg.length <= 0) return 1
  let walked = 0
  for (let i = 1; i <= Math.min(pointIndex, seg.points.length - 1); i++) {
    walked += Math.hypot(
      seg.points[i][0] - seg.points[i - 1][0],
      seg.points[i][1] - seg.points[i - 1][1],
    )
  }
  return walked / seg.length
}

export type CursorAdvance =
  | { kind: 'none' }
  | { kind: 'waypoint' }
  | { kind: 'segment'; segmentId: string }
  | { kind: 'arrived' }

/**
 * Advance the cursor after the car reached its current target. Exactly one
 * step per call: a waypoint, a segment boundary, or final arrival.
 */
export function advanceRouteCursor(graph: RoadGraph, state: VehicleRouteState): CursorAdvance {
  const seg = currentSegment(graph, state)
  if (!seg || !state.route) return { kind: 'none' }

  if (isOnFinalSegment(state)) {
    const anchorProgress = state.route.destinationProgress
    const nextIndexProgress = progressOfPointIndex(seg, state.pointIndex + 1)
    if (state.pointIndex + 1 < seg.points.length && nextIndexProgress < anchorProgress) {
      state.pointIndex += 1
      state.segmentProgress = nextIndexProgress
      return { kind: 'waypoint' }
    }
    state.segmentProgress = anchorProgress
    return { kind: 'arrived' }
  }

  if (state.pointIndex + 1 < seg.points.length - 1) {
    state.pointIndex += 1
    state.segmentProgress = progressOfPointIndex(seg, state.pointIndex)
    return { kind: 'waypoint' }
  }

  // Endpoint reached → hand over to the next planned segment (index moves
  // exactly once; the new cursor starts at the segment's first waypoint).
  state.segmentIndex += 1
  state.pointIndex = 0
  state.segmentProgress = 0
  const entered = state.route.segmentIds[state.segmentIndex]
  return { kind: 'segment', segmentId: entered }
}

export interface RouteDeviation {
  offLane: boolean
  distance: number
  /** Progress of the closest point on the current segment. */
  progress: number
}

/** How far the car is from its current segment's polyline. */
export function measureRouteDeviation(
  graph: RoadGraph,
  state: VehicleRouteState,
  x: number,
  z: number,
): RouteDeviation | null {
  const seg = currentSegment(graph, state)
  if (!seg) return null
  const near = closestPointOnSegment(seg, x, z)
  return { offLane: near.distance > OFF_LANE_DISTANCE, distance: near.distance, progress: near.progress }
}

/**
 * Re-anchor the cursor onto a segment of the active route (used after
 * overshoot/teleport when the car is unambiguously on a planned segment).
 * Returns false when the position doesn't match any route segment closely.
 */
export function reanchorOnRoute(
  graph: RoadGraph,
  state: VehicleRouteState,
  x: number,
  z: number,
  tolerance = 2.5,
): boolean {
  if (!state.route) return false
  let bestIndex = -1
  let bestDistance = tolerance
  let bestProgress = 0
  for (let i = 0; i < state.route.segmentIds.length; i++) {
    const seg = graph.segments.get(state.route.segmentIds[i])
    if (!seg) continue
    const near = closestPointOnSegment(seg, x, z)
    if (near.distance < bestDistance) {
      bestDistance = near.distance
      bestIndex = i
      bestProgress = near.progress
    }
  }
  if (bestIndex < 0) return false
  const seg = graph.segments.get(state.route.segmentIds[bestIndex])!
  state.segmentIndex = bestIndex
  state.segmentProgress = bestProgress
  // Cursor points at the first waypoint AHEAD of the anchored progress.
  state.pointIndex = 0
  for (let i = 1; i < seg.points.length - 1; i++) {
    if (progressOfPointIndex(seg, i) <= bestProgress) state.pointIndex = i
    else break
  }
  return true
}
