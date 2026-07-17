import type { Vec2 } from '../world/worldTypes'
import type { Point2 } from '../world/trafficAvoidance'

/** A drivable lane: an ordered waypoint loop with speed + braking envelope. */
export interface RoadLane {
  id: string
  waypoints: Vec2[]
  loop: boolean
  speedLimit: number
  laneWidth: number
  /** Begin easing off when an obstacle is within this distance ahead. */
  slowDistance: number
  /** Full stop before getting closer than this. */
  stopDistance: number
}

/** A striped crossing: where pedestrians cross and cars must yield. */
export interface CrosswalkZone {
  id: string
  center: Vec2
  /** Axis-aligned [width(x), depth(z)] of the zone. */
  size: Vec2
  /** Safe standing spots on each side, outside the road. */
  waitSpots: Vec2[]
  connectedSidewalkNodeIds: string[]
  affectedLaneIds: string[]
}

/** Documented pedestrian routes (NPC routines reference these paths' shapes). */
export interface SidewalkPath {
  id: string
  waypoints: Vec2[]
  connectedCrosswalkIds?: string[]
}

export type CarTrafficState =
  | 'cruising'
  | 'slowing'
  | 'yielding'
  | 'stopped'
  | 'resuming'
  | 'blocked'

export type PedestrianState =
  | 'walking_sidewalk'
  | 'waiting_to_cross'
  | 'crossing'
  | 'yielding_to_car'
  | 'idle'

export type CarSlowdownReason =
  | 'clear'
  | 'obstacle'
  | 'follow'
  | 'crosswalk'
  | 'signal'
  | 'stop_sign'

/** A signal group: which lanes/crosswalks one controller governs. */
export interface TrafficSignalGroup {
  id: string
  controlledLaneIds: string[]
  controlledCrosswalkIds: string[]
}

/** Lightweight live view of a car, shared with rules + debug + tests. */
export interface CarAgentView {
  position: Point2
  heading: number
  speed: number
}

/** Per-crosswalk status snapshot consumed by the car rules. */
export interface CrosswalkStatusView {
  id: string
  center: Point2
  occupied: boolean
  hasWaitingPedestrian: boolean
}
