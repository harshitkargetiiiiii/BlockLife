import type { Vec2 } from '../../world/worldTypes'
import type { DistrictId } from '../../world/cityLayout'
import type { StopLine } from '../signalRules'

/**
 * Cross-District Traffic Routing v1 — lane-level directed road graph.
 *
 * Ownership boundaries:
 * - cityLayout.ts owns road GEOMETRY constants (asphalt rects, connectors)
 * - trafficData.ts owns the legacy local-loop lanes, crosswalks and signals
 * - THIS module derives a directed lane-segment graph from those same
 *   constants (never a second copy of geometry — validation asserts the
 *   shared stretches coincide with the loop lanes to the millimeter)
 * - the route planner selects segment sequences over this graph
 * - the existing car decision engine (trafficRules.decideCarTargetSpeed)
 *   keeps owning braking/yielding/signals/following — routing only feeds it
 *   polylines and per-segment context
 *
 * Design: junction movements are SEGMENTS too (kind 'junction' with a turn
 * polyline), so a route is simply an ordered list of segments and edges are
 * pure endpoint adjacency. One follow mechanism covers lanes and turns.
 */

export type RoadNodeId = string
export type LaneSegmentId = string
export type { DistrictId }

export type SegmentKind = 'lane' | 'junction' | 'turnaround'

export type JunctionMovement = 'straight' | 'left' | 'right' | 'merge' | 'diverge' | 'loop'

export type VehicleClass = 'compact' | 'sedan' | 'van' | 'truck'

export interface RoadNode {
  id: RoadNodeId
  position: Vec2
  kind: 'laneStart' | 'laneEnd' | 'junctionEntry' | 'junctionExit' | 'corner'
  districtId: DistrictId
}

export interface LaneSegment {
  id: LaneSegmentId
  kind: SegmentKind
  from: RoadNodeId
  to: RoadNodeId
  /** Directed polyline, first point = from node, last = to node. */
  points: Vec2[]
  /** Cached total polyline length (filled by the builder). */
  length: number
  speedLimit: number
  districtId: DistrictId
  /** The road this segment runs on (ring/residential/connector_north/…). */
  roadId: string
  /** Lane identity within the road (eb/wb/nb/sb or the movement name). */
  laneId: string
  tags: string[]
  junctionId?: string
  movement?: JunctionMovement
  /** Signal group whose vehicle phase governs this segment's stop lines. */
  signalGroupId?: string
  /** Stop lines a car on this segment must respect (signal-controlled). */
  stopLines?: StopLine[]
  /** Crosswalk zones this segment passes through. */
  crossingZoneIds?: string[]
  /** Stop signs (unsignalled streets) a car on this segment must honor. */
  stopSignIds?: string[]
  allowedVehicleClasses?: VehicleClass[]
  isConnector: boolean
  isSpawnEligible: boolean
  isDestinationEligible: boolean
}

export interface RoadEdge {
  fromSegmentId: LaneSegmentId
  toSegmentId: LaneSegmentId
  movement: JunctionMovement
  /** Static extra cost (turn/connector penalties) added at plan time. */
  cost: number
  junctionId?: string
}

export type TrafficDestinationKind =
  | 'districtExit'
  | 'commercial'
  | 'residential'
  | 'industrial'
  | 'parking'
  | 'throughTraffic'

export interface TrafficDestination {
  id: string
  districtId: DistrictId
  segmentId: LaneSegmentId
  /** 0..1 along the segment polyline. */
  progress: number
  kind: TrafficDestinationKind
  weight: number
  allowedVehicleClasses?: VehicleClass[]
}

export interface RouteSpawnPoint {
  id: string
  segmentId: LaneSegmentId
  /** 0..1 along the segment polyline. */
  progress: number
  districtId: DistrictId
}

/** Immutable built graph: authored data + derived indices, built once. */
export interface RoadGraph {
  /** Stable content hash — routes remember which graph planned them. */
  version: number
  nodes: Map<RoadNodeId, RoadNode>
  segments: Map<LaneSegmentId, LaneSegment>
  edges: RoadEdge[]
  /** Outgoing adjacency: segment id → edges leaving its end node. */
  adjacency: Map<LaneSegmentId, RoadEdge[]>
  destinations: Map<string, TrafficDestination>
  spawnPoints: Map<string, RouteSpawnPoint>
}

export type VehicleRouteMode = 'localLoop' | 'crossDistrict' | 'throughTraffic'

export interface RoutePlan {
  routeId: string
  originSegmentId: LaneSegmentId
  /** 0..1 along the origin segment where the route begins. */
  originProgress: number
  destinationId: string
  segmentIds: LaneSegmentId[]
  /** 0..1 along the final segment where the route ends. */
  destinationProgress: number
  totalCost: number
  graphVersion: number
}

export type RoutePlanFailure =
  | 'noPath'
  | 'invalidOrigin'
  | 'invalidDestination'
  | 'graphMismatch'
  | 'blockedAllPaths'

export type RoutePlanResult =
  | { ok: true; plan: RoutePlan }
  | { ok: false; failure: RoutePlanFailure }

export type BlockageReason =
  | 'none'
  | 'signal'
  | 'pedestrian'
  | 'leader'
  | 'playerVehicle'
  | 'routeGeometry'
  | 'offLane'
  | 'downstreamFull'
  | 'unknown'

export type RouteRecoveryStage = 0 | 1 | 2 | 3 | 4

export interface SegmentCongestion {
  segmentId: LaneSegmentId
  vehicleCount: number
  occupancyRatio: number
  stoppedVehicleCount: number
  /** Mean speed / speed limit for cars on the segment (1 = free flow). */
  speedRatio: number
  penalty: number
}
