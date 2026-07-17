import type {
  BlockageReason,
  RoutePlan,
  RouteRecoveryStage,
  SegmentCongestion,
  VehicleRouteMode,
} from './roadGraphTypes'
import type { SeededRng } from './routeRng'

/**
 * Live per-vehicle routing state. Module singleton like trafficRuntime:
 * mutated from frame loops, read by debug/tests — never React state, never
 * persisted (ambient traffic rebuilds deterministically from the seed).
 */

export interface VehicleRouteState {
  vehicleId: string
  mode: VehicleRouteMode
  destinationId: string | null
  route: RoutePlan | null
  /** Index into route.segmentIds — the authoritative current segment. */
  segmentIndex: number
  /** Waypoint cursor within the current segment's polyline. */
  pointIndex: number
  /** 0..1 along the current segment (derived, for debug/tests). */
  segmentProgress: number
  /** Simulation-time bookkeeping for blockage detection. */
  lastProgressAt: number
  lastProgressX: number
  lastProgressZ: number
  /** Total time stopped, any reason (leader-stall detection). */
  stoppedTime: number
  /** Time stopped WITHOUT a legitimate reason (drives recovery stages). */
  suspectTime: number
  blockageReason: BlockageReason
  recoveryStage: RouteRecoveryStage
  recoveryCooldownUntil: number
  recoveryAttempts: number
  replanCount: number
  tripsCompleted: number
  districtsVisited: Set<string>
  lastDestinationIds: string[]
  /** Per-vehicle deterministic destination stream. */
  rng: SeededRng
}

export interface RouteRuntime {
  /** Seed for the whole routed fleet (test API can override + rebuild). */
  seed: number
  states: Map<string, VehicleRouteState>
  /** Congestion snapshot, rebuilt at a slow cadence — plan-time input only. */
  congestion: Map<string, SegmentCongestion>
  congestionUpdatedAt: number
  /** Dev/test: force-blocked segments (planner avoids, recovery escalates). */
  blockedSegmentIds: Set<string>
  /** Dev/test: force a specific destination on next arrival/replan. */
  forcedDestinations: Map<string, string>
  /** Dev/test: request a replan on the next frame. */
  replanRequests: Set<string>
  /** Bumped by setTrafficRoutingSeed so vehicles rebuild their plans. */
  fleetResetSeq: number
}

export const routeRuntime: RouteRuntime = {
  seed: 1,
  states: new Map(),
  congestion: new Map(),
  congestionUpdatedAt: -Infinity,
  blockedSegmentIds: new Set(),
  forcedDestinations: new Map(),
  replanRequests: new Set(),
  fleetResetSeq: 0,
}

export function createVehicleRouteState(
  vehicleId: string,
  mode: VehicleRouteMode,
  rng: SeededRng,
): VehicleRouteState {
  return {
    vehicleId,
    mode,
    destinationId: null,
    route: null,
    segmentIndex: 0,
    pointIndex: 0,
    segmentProgress: 0,
    lastProgressAt: 0,
    lastProgressX: 0,
    lastProgressZ: 0,
    stoppedTime: 0,
    suspectTime: 0,
    blockageReason: 'none',
    recoveryStage: 0,
    recoveryCooldownUntil: 0,
    recoveryAttempts: 0,
    replanCount: 0,
    tripsCompleted: 0,
    districtsVisited: new Set(),
    lastDestinationIds: [],
    rng,
  }
}

/** Congestion penalty applied at plan time for one segment (capped). */
export function congestionExtraCost(segmentId: string): number {
  const snapshot = routeRuntime.congestion.get(segmentId)
  return snapshot ? snapshot.penalty : 0
}
