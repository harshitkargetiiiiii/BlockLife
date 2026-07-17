import type { Vec2 } from '../../world/worldTypes'
import type {
  RoadGraph,
  RoutePlanResult,
  RouteSpawnPoint,
  VehicleRouteMode,
} from './roadGraphTypes'
import { headingAtProgress, pointAtProgress } from './roadGraphBuilder'
import { planRoute } from './routePlanner'
import { createVehicleRng, selectDestination } from './routeSelection'
import {
  congestionExtraCost,
  createVehicleRouteState,
  routeRuntime,
  type VehicleRouteState,
} from './routeRuntime'
import { progressOfPointIndex } from './routeProgress'

/**
 * Routed-vehicle lifecycle: spawn, destination arrival, respawn. Pure logic
 * over the runtime state so every policy is unit-testable without R3F.
 *
 * Spawn contract: pose and route are created ATOMICALLY — a vehicle either
 * initializes with a valid plan or reports failure; there is never a car
 * without a route.
 */

/** Recent destinations remembered to discourage immediate repeats. */
const DESTINATION_HISTORY = 3

export interface RoutedSpawnResult {
  state: VehicleRouteState
  position: Vec2
  heading: number
}

function planWithCongestion(
  graph: RoadGraph,
  originSegmentId: string,
  originProgress: number,
  destinationId: string,
  extraBlocked?: ReadonlySet<string>,
): RoutePlanResult {
  const blocked = new Set(routeRuntime.blockedSegmentIds)
  if (extraBlocked) for (const id of extraBlocked) blocked.add(id)
  return planRoute(graph, originSegmentId, originProgress, destinationId, {
    extraCost: congestionExtraCost,
    blockedSegmentIds: blocked.size > 0 ? blocked : undefined,
  })
}

/** Anchor the waypoint cursor at a progress along the current segment. */
export function anchorCursorAtProgress(
  graph: RoadGraph,
  state: VehicleRouteState,
  progress: number,
): void {
  const segId = state.route?.segmentIds[state.segmentIndex]
  const seg = segId ? graph.segments.get(segId) : null
  state.pointIndex = 0
  state.segmentProgress = progress
  if (!seg) return
  for (let i = 1; i < seg.points.length - 1; i++) {
    if (progressOfPointIndex(seg, i) <= progress) state.pointIndex = i
    else break
  }
}

/** Dev/test destination forcing: consumed exactly once, wins everywhere. */
export function consumeForcedDestination(vehicleId: string): string | null {
  const forced = routeRuntime.forcedDestinations.get(vehicleId)
  if (!forced) return null
  routeRuntime.forcedDestinations.delete(vehicleId)
  return forced
}

/** Pick the next destination for a vehicle (honoring dev/test forcing). */
export function chooseDestination(
  graph: RoadGraph,
  state: VehicleRouteState,
  currentDistrictId?: string,
): string | null {
  const forced = consumeForcedDestination(state.vehicleId)
  if (forced) return forced
  const picked = selectDestination(graph, state.rng, {
    mode: state.mode,
    currentDistrictId,
    lastDestinationIds: state.lastDestinationIds,
  })
  return picked?.id ?? null
}

/**
 * Plan (or replan) toward a destination from an explicit origin. Updates
 * route/cursor bookkeeping on success; leaves the previous route untouched
 * on failure so the caller can escalate instead of stranding the car.
 */
export function planStateRoute(
  graph: RoadGraph,
  state: VehicleRouteState,
  originSegmentId: string,
  originProgress: number,
  destinationId: string,
  extraBlocked?: ReadonlySet<string>,
): boolean {
  const result = planWithCongestion(graph, originSegmentId, originProgress, destinationId, extraBlocked)
  if (!result.ok) return false
  state.route = result.plan
  state.destinationId = destinationId
  state.segmentIndex = 0
  anchorCursorAtProgress(graph, state, originProgress)
  return true
}

/** Fresh routed vehicle at its assigned (or given) spawn point. */
export function initializeRoutedVehicle(
  graph: RoadGraph,
  vehicleId: string,
  mode: VehicleRouteMode,
  spawnPointId: string,
): RoutedSpawnResult | null {
  const spawn = graph.spawnPoints.get(spawnPointId) ?? [...graph.spawnPoints.values()][0]
  if (!spawn) return null
  const state = createVehicleRouteState(vehicleId, mode, createVehicleRng(routeRuntime.seed, vehicleId))
  const destinationId = chooseDestination(graph, state, spawn.districtId)
  if (!destinationId) return null
  if (!planStateRoute(graph, state, spawn.segmentId, spawn.progress, destinationId)) return null
  const seg = graph.segments.get(spawn.segmentId)!
  return {
    state,
    position: pointAtProgress(seg, spawn.progress),
    heading: headingAtProgress(seg, spawn.progress),
  }
}

export type ArrivalOutcome = 'continue' | 'despawn' | 'stranded'

/**
 * Destination reached. Cross-district cars roll on to a new destination;
 * through-traffic cars report 'despawn' (the component relocates them to a
 * fresh spawn). Never called mid-intersection: arrival anchors live on
 * plain lane segments by validation.
 */
export function handleDestinationArrival(
  graph: RoadGraph,
  state: VehicleRouteState,
): ArrivalOutcome {
  const finished = state.destinationId
  if (finished) {
    state.lastDestinationIds.push(finished)
    if (state.lastDestinationIds.length > DESTINATION_HISTORY) state.lastDestinationIds.shift()
    state.tripsCompleted += 1
    const dest = graph.destinations.get(finished)
    if (dest) state.districtsVisited.add(dest.districtId)
  }
  if (state.mode === 'throughTraffic') return 'despawn'

  const segId = state.route?.segmentIds[state.segmentIndex]
  const seg = segId ? graph.segments.get(segId) : null
  if (!seg || !state.route) return 'stranded'
  const nextDestination = chooseDestination(graph, state, seg.districtId)
  if (!nextDestination) return 'stranded'
  const progress = state.route.destinationProgress
  if (!planStateRoute(graph, state, seg.id, progress, nextDestination)) return 'stranded'
  return 'continue'
}

export interface RespawnContext {
  /** Avoid spawning inside this circle (player camera focus). */
  avoid?: { x: number; z: number; radius: number }
  /** True when a physical body already occupies the candidate point. */
  isOccupied: (x: number, z: number) => boolean
}

/**
 * Deterministic respawn: iterate spawn points in seeded order, take the
 * first free one (prefer off-camera candidates when any exist).
 */
export function pickRespawnPoint(
  graph: RoadGraph,
  state: VehicleRouteState,
  context: RespawnContext,
): RouteSpawnPoint | null {
  const all = [...graph.spawnPoints.values()].sort((a, b) => (a.id < b.id ? -1 : 1))
  const startIndex = Math.floor(state.rng() * all.length)
  const rotated = [...all.slice(startIndex), ...all.slice(0, startIndex)]
  const isVisible = (p: RouteSpawnPoint): boolean => {
    if (!context.avoid) return false
    const seg = graph.segments.get(p.segmentId)
    if (!seg) return false
    const [x, z] = pointAtProgress(seg, p.progress)
    return Math.hypot(x - context.avoid.x, z - context.avoid.z) < context.avoid.radius
  }
  const free = rotated.filter((p) => {
    const seg = graph.segments.get(p.segmentId)
    if (!seg) return false
    const [x, z] = pointAtProgress(seg, p.progress)
    return !context.isOccupied(x, z)
  })
  const hidden = free.filter((p) => !isVisible(p))
  const pool = hidden.length > 0 ? hidden : free
  return pool[0] ?? null
}

/** Respawn the vehicle at a point: fresh route, reset recovery, new pose. */
export function respawnRoutedVehicle(
  graph: RoadGraph,
  state: VehicleRouteState,
  spawn: RouteSpawnPoint,
): RoutedSpawnResult | null {
  const destinationId = chooseDestination(graph, state, spawn.districtId)
  if (!destinationId) return null
  if (!planStateRoute(graph, state, spawn.segmentId, spawn.progress, destinationId)) return null
  state.stoppedTime = 0
  state.suspectTime = 0
  state.recoveryStage = 0
  state.recoveryAttempts = 0
  state.blockageReason = 'none'
  const seg = graph.segments.get(spawn.segmentId)!
  return {
    state,
    position: pointAtProgress(seg, spawn.progress),
    heading: headingAtProgress(seg, spawn.progress),
  }
}
