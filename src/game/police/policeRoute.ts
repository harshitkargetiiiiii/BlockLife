import type { Vec2 } from '../world/worldTypes'
import type { RoadGraph } from '../traffic/routing/roadGraphTypes'
import { getRoadGraph } from '../traffic/routing/roadGraphBuilder'
import { planRouteToSegment } from '../traffic/routing/routePlanner'
import { nearestRoadSegment } from '../traffic/routing/roadProjection'

/**
 * Emergency police vehicle routing — an emergency policy layered over the ONE
 * global road graph (no second graph). A pursuing cruiser plans a deterministic
 * A* route to the suspect's live road segment and follows the route's polyline,
 * so it drives ON roads toward the suspect instead of straight through blocks.
 * Police ignore congestion cost (emergency priority) and replan only on a
 * bounded cadence or when the target moves to a new area — never per frame.
 * Direct-pursuit + solid-avoidance remains the tightly-scoped fallback (off-road
 * origin/target, close-range containment, or no path).
 */

export type PoliceVehicleRouteMode =
  | 'respond_to_incident'
  | 'intercept_suspect'
  | 'follow_last_known_route'
  | 'search_sector'
  | 'return_to_patrol'

export interface PoliceRoute {
  unitId: string
  mode: PoliceVehicleRouteMode
  segmentIds: string[]
  /** Flattened route polyline the cruiser steers along. */
  waypoints: Vec2[]
  cursor: number
  targetSegmentId: string
  targetPos: Vec2
  plannedAt: number
  replanAt: number
  graphVersion: number
  replanCount: number
}

export const POLICE_REPLAN_INTERVAL = 1.5
/** Target drift (world units) that forces an early replan. */
export const POLICE_TARGET_DRIFT = 9
/** Distance at which a cruiser switches to direct close-range containment. */
export const POLICE_CLOSE_RANGE = 14
export const POLICE_WAYPOINT_REACH = 3

export const policeRouteRuntime = {
  routes: new Map<string, PoliceRoute>(),
  /** Aggregate replan count (perf/telemetry). */
  totalReplans: 0,
}

function flattenRoute(graph: RoadGraph, segmentIds: string[]): Vec2[] {
  const out: Vec2[] = []
  for (const id of segmentIds) {
    const seg = graph.segments.get(id)
    if (!seg) continue
    for (const p of seg.points) {
      const last = out[out.length - 1]
      if (!last || Math.hypot(last[0] - p[0], last[1] - p[1]) > 0.1) out.push([p[0], p[1]])
    }
  }
  return out
}

/** (Re)plan a cruiser's road route from `from` toward `target`. */
export function planPoliceRoute(
  unitId: string,
  mode: PoliceVehicleRouteMode,
  from: Vec2,
  target: Vec2,
  gameTime: number,
): PoliceRoute | null {
  const graph = getRoadGraph()
  const originProj = nearestRoadSegment(graph, from)
  const destProj = nearestRoadSegment(graph, target)
  if (!originProj || !destProj) return null
  const res = planRouteToSegment(
    graph,
    originProj.segmentId,
    originProj.progress,
    destProj.segmentId,
    destProj.progress,
    { extraCost: () => 0 }, // emergency: no congestion penalty
  )
  if (!res.ok) return null
  const route: PoliceRoute = {
    unitId,
    mode,
    segmentIds: res.plan.segmentIds,
    waypoints: flattenRoute(graph, res.plan.segmentIds),
    cursor: 0,
    targetSegmentId: destProj.segmentId,
    targetPos: [target[0], target[1]],
    plannedAt: gameTime,
    replanAt: gameTime + POLICE_REPLAN_INTERVAL,
    graphVersion: graph.version,
    replanCount: (policeRouteRuntime.routes.get(unitId)?.replanCount ?? 0) + 1,
  }
  policeRouteRuntime.routes.set(unitId, route)
  policeRouteRuntime.totalReplans++
  return route
}

/** True if the cruiser's route is stale (cadence, target drift, graph change). */
export function shouldReplanPolice(unitId: string, target: Vec2, gameTime: number): boolean {
  const route = policeRouteRuntime.routes.get(unitId)
  if (!route) return true
  if (gameTime >= route.replanAt) return true
  if (route.graphVersion !== getRoadGraph().version) return true
  if (Math.hypot(target[0] - route.targetPos[0], target[1] - route.targetPos[1]) > POLICE_TARGET_DRIFT) {
    return true
  }
  return false
}

/**
 * Advance the cursor past reached waypoints and return the next one to steer
 * toward, or null if the route is exhausted/empty (→ caller falls back).
 */
export function nextPoliceWaypoint(unitId: string, from: Vec2): Vec2 | null {
  const route = policeRouteRuntime.routes.get(unitId)
  if (!route || route.waypoints.length === 0) return null
  while (route.cursor < route.waypoints.length - 1) {
    const wp = route.waypoints[route.cursor]
    if (Math.hypot(from[0] - wp[0], from[1] - wp[1]) < POLICE_WAYPOINT_REACH) route.cursor += 1
    else break
  }
  const wp = route.waypoints[route.cursor]
  return [wp[0], wp[1]]
}

export function clearPoliceRoute(unitId: string): void {
  policeRouteRuntime.routes.delete(unitId)
}

export function getPoliceRoute(unitId: string): PoliceRoute | null {
  return policeRouteRuntime.routes.get(unitId) ?? null
}

export function resetPoliceRoutes(): void {
  policeRouteRuntime.routes.clear()
  policeRouteRuntime.totalReplans = 0
}
