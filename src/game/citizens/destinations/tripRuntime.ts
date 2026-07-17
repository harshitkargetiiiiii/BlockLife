import type { Vec2 } from '../../world/worldTypes'
import { createRng, hashString } from '../../traffic/routing/routeRng'
import {
  CITIZEN_DESTINATIONS,
  DESTINATIONS_BY_ID,
  PEDESTRIAN_GRAPH,
  makeHomeDestination,
  planPedestrianRoute,
  registerHomeNode,
  selectDestination,
  type PedestrianRoutePlan,
} from './pedestrianDestinations'

/**
 * Trip state for destination-driven citizens. Module singleton (no React
 * state): the citizen frame reads/advances it; planning runs only on
 * selection, invalidation, or bounded recovery — never per frame.
 */

export type TripPhase =
  | 'selecting_destination'
  | 'walking_to_destination'
  | 'arriving'
  | 'performing_activity'
  | 'leaving'
  | 'idle_fallback'

export interface CitizenTripState {
  citizenId: string
  homeNodeId: string
  phase: TripPhase
  destinationId: string | null
  lastDestinationId: string | null
  plan: PedestrianRoutePlan | null
  waypointIndex: number
  tripIndex: number
  tripsCompleted: number
  /** Clock time (seconds) when the current activity/fallback ends. */
  activityUntil: number
  /** Seconds without waypoint progress while NOT legitimately waiting. */
  noProgressTime: number
  recoveryStage: number
  /** Dormant-LOD: trip frozen; capacity released until rematerialized. */
  suspended: boolean
}

export const tripRuntime = {
  trips: new Map<string, CitizenTripState>(),
  occupancy: new Map<string, Set<string>>(),
  debugEnabled: false,
}

export function occupancyCount(destinationId: string): number {
  return tripRuntime.occupancy.get(destinationId)?.size ?? 0
}

function claim(destinationId: string, citizenId: string): boolean {
  const dest = DESTINATIONS_BY_ID.get(destinationId)
  if (!dest) return false
  let set = tripRuntime.occupancy.get(destinationId)
  if (!set) {
    set = new Set()
    tripRuntime.occupancy.set(destinationId, set)
  }
  if (set.has(citizenId)) return true
  if (set.size >= dest.capacity) return false
  set.add(citizenId)
  return true
}

function release(destinationId: string | null, citizenId: string): void {
  if (!destinationId) return
  tripRuntime.occupancy.get(destinationId)?.delete(citizenId)
}

/** Register the citizen's home node + initial state. Idempotent. */
export function initCitizenTrips(
  citizenId: string,
  homePosition: Vec2,
  homeSectorId: string,
  attachNodeId: string,
): CitizenTripState {
  const existing = tripRuntime.trips.get(citizenId)
  if (existing) return existing
  const home = makeHomeDestination(citizenId, homePosition, homeSectorId)
  registerHomeNode(home, attachNodeId)
  const state: CitizenTripState = {
    citizenId,
    homeNodeId: home.id,
    phase: 'selecting_destination',
    destinationId: null,
    lastDestinationId: null,
    plan: null,
    waypointIndex: 0,
    tripIndex: 0,
    tripsCompleted: 0,
    activityUntil: 0,
    noProgressTime: 0,
    recoveryStage: 0,
    suspended: false,
  }
  tripRuntime.trips.set(citizenId, state)
  return state
}

export interface TripPlanningContext {
  hour: number
  raining: boolean
  now: number
}

/**
 * Select + plan the next trip from `originNodeId`. Even trips head OUT to a
 * chosen destination; odd trips return home — a readable daily rhythm.
 * Bounded: tries up to three destination candidates, then falls back to a
 * local idle (retry after a pause). Selection is fully seeded.
 */
export function beginNextTrip(state: CitizenTripState, originNodeId: string, ctx: TripPlanningContext): void {
  release(state.destinationId, state.citizenId)
  state.lastDestinationId = state.destinationId
  state.destinationId = null
  state.plan = null
  state.waypointIndex = 0
  state.noProgressTime = 0
  const goingHome = state.tripIndex % 2 === 1 && originNodeId !== state.homeNodeId
  for (let attempt = 0; attempt < 3; attempt++) {
    const dest = goingHome
      ? DESTINATIONS_BY_ID.get(state.homeNodeId)!
      : selectDestination({
          citizenId: state.citizenId,
          tripIndex: state.tripIndex * 3 + attempt,
          hour: ctx.hour,
          raining: ctx.raining,
          lastDestinationId: state.lastDestinationId,
          occupancy: occupancyCount,
        })
    if (!dest || dest.id === originNodeId) {
      if (goingHome) break
      continue
    }
    const plan = planPedestrianRoute(state.citizenId, originNodeId, dest.id)
    if (!plan) continue
    if (!claim(dest.id, state.citizenId)) continue
    state.destinationId = dest.id
    state.plan = plan
    state.phase = 'walking_to_destination'
    state.tripIndex += 1
    // recoveryStage intentionally NOT reset here: only a real arrival
    // clears the ladder, so a citizen that keeps replanning without ever
    // arriving still reaches the bounded idle fallback.
    return
  }
  // Fallback: idle in place, retry after a deterministic pause.
  const rng = createRng(hashString(`${state.citizenId}:fallback:${state.tripIndex}`))
  state.phase = 'idle_fallback'
  state.tripIndex += 1
  state.activityUntil = ctx.now + 6 + rng() * 6
}

/** Deterministic activity stay for this citizen + trip. */
export function activityDuration(state: CitizenTripState): number {
  const rng = createRng(hashString(`${state.citizenId}:stay:${state.tripIndex}`))
  return 8 + rng() * 12
}

/** Nearest graph node to a position (recovery re-anchor + resume). */
export function nearestGraphNode(position: Vec2): string {
  let best = ''
  let bestD = Infinity
  for (const node of PEDESTRIAN_GRAPH.nodes.values()) {
    const d = Math.hypot(node.position[0] - position[0], node.position[1] - position[1])
    if (d < bestD) {
      bestD = d
      best = node.id
    }
  }
  return best
}

/** Dormant-LOD suspend: freeze the trip, release the capacity claim. */
export function suspendTrip(citizenId: string): void {
  const state = tripRuntime.trips.get(citizenId)
  if (!state || state.suspended) return
  state.suspended = true
  release(state.destinationId, state.citizenId)
}

/**
 * Rematerialize after dormancy: the citizen is already at a valid point on
 * its former path (it froze there — never analytically advanced through an
 * intersection). Re-claim the destination if space remains, otherwise pick
 * a fresh one from the nearest node.
 */
export function resumeTrip(citizenId: string, position: Vec2, ctx: TripPlanningContext): void {
  const state = tripRuntime.trips.get(citizenId)
  if (!state || !state.suspended) return
  state.suspended = false
  if (state.phase === 'walking_to_destination' && state.destinationId) {
    if (claim(state.destinationId, state.citizenId)) return // plan + index intact
  } else if (state.phase === 'performing_activity' && state.destinationId) {
    if (claim(state.destinationId, state.citizenId)) return
  }
  beginNextTrip(state, nearestGraphNode(position), ctx)
}

/**
 * Bounded recovery ladder — stages 2..4 (1 = the implicit wait, handled by
 * the caller's no-progress clock which EXCLUDES legitimate crossing waits):
 *   2 re-anchor to the nearest node + replan the SAME destination
 *   3 replan to a DIFFERENT destination
 *   4 idle fallback
 */
export function recoverTrip(state: CitizenTripState, position: Vec2, ctx: TripPlanningContext): void {
  state.recoveryStage += 1
  state.noProgressTime = 0
  const anchor = nearestGraphNode(position)
  if (state.recoveryStage === 1 && state.destinationId) {
    const plan = planPedestrianRoute(state.citizenId, anchor, state.destinationId)
    if (plan) {
      state.plan = plan
      state.waypointIndex = 0
      return
    }
    state.recoveryStage += 1
  }
  if (state.recoveryStage <= 2) {
    beginNextTrip(state, anchor, ctx)
    return
  }
  release(state.destinationId, state.citizenId)
  state.destinationId = null
  state.plan = null
  state.phase = 'idle_fallback'
  state.activityUntil = ctx.now + 10
  state.recoveryStage = 0
}

/** Dev/test: force a specific destination (honors capacity). */
export function forceTripDestination(citizenId: string, destinationId: string, position: Vec2): boolean {
  const state = tripRuntime.trips.get(citizenId)
  const dest = DESTINATIONS_BY_ID.get(destinationId)
  if (!state || !dest) return false
  const plan = planPedestrianRoute(citizenId, nearestGraphNode(position), destinationId)
  if (!plan) return false
  if (!claim(destinationId, citizenId)) return false
  release(state.destinationId, citizenId)
  state.lastDestinationId = state.destinationId
  state.destinationId = destinationId
  state.plan = plan
  state.waypointIndex = 0
  state.noProgressTime = 0
  state.phase = 'walking_to_destination'
  state.tripIndex += 1
  return true
}

/** Dev/test: replan the CURRENT destination from the citizen's position. */
export function replanTrip(citizenId: string, position: Vec2): boolean {
  const state = tripRuntime.trips.get(citizenId)
  if (!state?.destinationId) return false
  const plan = planPedestrianRoute(citizenId, nearestGraphNode(position), state.destinationId)
  if (!plan) return false
  state.plan = plan
  state.waypointIndex = 0
  state.noProgressTime = 0
  state.phase = 'walking_to_destination'
  return true
}

/** Test/debug view of one crossing-aware trip. */
export function getTripSnapshot(citizenId: string) {
  const s = tripRuntime.trips.get(citizenId)
  if (!s) return null
  return {
    citizenId,
    phase: s.phase,
    destinationId: s.destinationId,
    routeEdgeIds: s.plan?.sidewalkPathIds ?? [],
    crossingIds: s.plan?.crossingIds ?? [],
    waypointIndex: s.waypointIndex,
    waypointCount: s.plan?.waypoints.length ?? 0,
    tripsCompleted: s.tripsCompleted,
    recoveryStage: s.recoveryStage,
    suspended: s.suspended,
  }
}

export function resetTripRuntime(): void {
  tripRuntime.trips.clear()
  tripRuntime.occupancy.clear()
}

/** Pause-snap determinism: the citizen teleports home, the trip restarts. */
export function resetSingleTrip(citizenId: string): void {
  const s = tripRuntime.trips.get(citizenId)
  if (!s) return
  release(s.destinationId, s.citizenId)
  s.phase = 'selecting_destination'
  s.destinationId = null
  s.lastDestinationId = null
  s.plan = null
  s.waypointIndex = 0
  s.tripIndex = 0
  s.noProgressTime = 0
  s.recoveryStage = 0
  s.suspended = false
}

/** All destinations incl. synthesized homes (for the dev/test API). */
export function listDestinations() {
  return [...DESTINATIONS_BY_ID.values()].map((d) => ({
    id: d.id,
    kind: d.kind,
    sectorId: d.sectorId,
    position: [...d.position] as Vec2,
    capacity: d.capacity,
    occupancy: occupancyCount(d.id),
    arrivalBehavior: d.arrivalBehavior,
  }))
}

export function graphSummary() {
  return {
    nodes: PEDESTRIAN_GRAPH.nodes.size,
    edges: PEDESTRIAN_GRAPH.edges.length,
    crossings: PEDESTRIAN_GRAPH.edges.filter((e) => e.crossingId).length,
    destinations: CITIZEN_DESTINATIONS.length,
  }
}
