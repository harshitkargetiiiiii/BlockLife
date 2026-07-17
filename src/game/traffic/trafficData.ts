import type { Vec2 } from '../world/worldTypes'
import type { CrosswalkZone, RoadLane, SidewalkPath, TrafficSignalGroup } from './trafficTypes'
import type { StopLine } from './signalRules'

/**
 * Data-driven street definitions for the one city block. The ring road
 * centerline sits at ±26 (asphalt 23..29); the inner clockwise lane runs at
 * ±24.6 and the outer counter-clockwise lane at ±27.4 — matching the lanes
 * ambient cars have always driven.
 */

function ring(r: number, clockwise: boolean): Vec2[] {
  const pts: Vec2[] = [
    [-r, -r],
    [r, -r],
    [r, r],
    [-r, r],
  ]
  return clockwise ? pts : pts.slice().reverse()
}

export const ROAD_LANES: RoadLane[] = [
  {
    id: 'lane_inner_cw',
    waypoints: ring(24.6, true),
    loop: true,
    speedLimit: 5.5,
    laneWidth: 2.6,
    slowDistance: 5.5,
    stopDistance: 2.6,
  },
  {
    id: 'lane_outer_ccw',
    waypoints: ring(27.4, false),
    loop: true,
    speedLimit: 6.2,
    laneWidth: 2.6,
    slowDistance: 5.5,
    stopDistance: 2.6,
  },
  // Residential Street: calm two-way loop (east on the south half, back
  // west on the north half — tiny turnarounds at the ends read fine).
  {
    id: 'lane_residential',
    waypoints: [
      [-18, -46.4],
      [28, -46.4],
      [28, -43.6],
      [-18, -43.6],
    ],
    loop: true,
    speedLimit: 4.2,
    laneWidth: 2.6,
    slowDistance: 5,
    stopDistance: 2.6,
  },
  // Industrial strip: wider, faster two-way loop (north on the east half).
  {
    id: 'lane_industrial',
    waypoints: [
      [50, -14],
      [50, 24],
      [46, 24],
      [46, -14],
    ],
    loop: true,
    speedLimit: 6.5,
    laneWidth: 3,
    slowDistance: 6.5,
    stopDistance: 2.8,
  },
  // ---- City Expansion v2 loops (courtesy etiquette, no signals) ----
  // Residential West: calm north-south lane.
  {
    id: 'lane_residential_west',
    waypoints: [
      [-46.6, -18],
      [-46.6, 18],
      [-49.4, 18],
      [-49.4, -18],
    ],
    loop: true,
    speedLimit: 4.2,
    laneWidth: 2.6,
    slowDistance: 5,
    stopDistance: 2.6,
  },
  // Residential South: calm east-west lane.
  {
    id: 'lane_residential_south',
    waypoints: [
      [-18, 49.4],
      [18, 49.4],
      [18, 46.6],
      [-18, 46.6],
    ],
    loop: true,
    speedLimit: 4.2,
    laneWidth: 2.6,
    slowDistance: 5,
    stopDistance: 2.6,
  },
  // Industrial North: freight run along the arterial extension. Kept a
  // couple of units clear of the lane_industrial turnaround at z = -14 so
  // the two loops never share a corner.
  {
    id: 'lane_industrial_north',
    waypoints: [
      [50, -20],
      [50, -50],
      [46, -50],
      [46, -20],
    ],
    loop: true,
    speedLimit: 6,
    laneWidth: 3,
    slowDistance: 6.5,
    stopDistance: 2.8,
  },
]

export const LANES_BY_ID: Record<string, RoadLane> = Object.fromEntries(
  ROAD_LANES.map((l) => [l.id, l]),
)

/** Matches the two striped crossings rendered in Roads.tsx. */
export const CROSSWALKS: CrosswalkZone[] = [
  {
    id: 'crosswalk_north',
    center: [0, -26],
    size: [3.2, 6.8],
    waitSpots: [
      [0, -22.2],
      [0, -29.8],
    ],
    connectedSidewalkNodeIds: ['sidewalk_inner_loop', 'sidewalk_outer_loop'],
    affectedLaneIds: ['lane_inner_cw', 'lane_outer_ccw'],
  },
  {
    id: 'crosswalk_west',
    center: [-26, 0],
    size: [6.8, 3.2],
    waitSpots: [
      [-22.2, 0],
      [-29.8, 0],
    ],
    connectedSidewalkNodeIds: ['sidewalk_inner_loop', 'sidewalk_outer_loop'],
    affectedLaneIds: ['lane_inner_cw', 'lane_outer_ccw'],
  },
  // Residential Street crossing (stop-sign controlled, unsignalled).
  {
    id: 'crosswalk_residential',
    center: [-2, -45],
    size: [3, 7.2],
    waitSpots: [
      [-2, -40.8],
      [-2, -49.2],
    ],
    connectedSidewalkNodeIds: ['sidewalk_residential_loop'],
    affectedLaneIds: ['lane_residential'],
  },
  // Industrial strip crossing (on the shared signal).
  {
    id: 'crosswalk_industrial',
    center: [48, 12],
    size: [8.8, 3],
    waitSpots: [
      [42.8, 12],
      [53.2, 12],
    ],
    connectedSidewalkNodeIds: ['sidewalk_industrial_loop'],
    affectedLaneIds: ['lane_industrial'],
  },
  // Connector-road mouths cut the central outer sidewalk: these zones make
  // pedestrian routes across them legal. No ambient lane ever drives the
  // connectors (player-only roads), so they are always safe to cross.
  {
    id: 'crosswalk_connector_north',
    center: [12, -30],
    size: [6.6, 3],
    waitSpots: [
      [8.2, -30],
      [15.8, -30],
    ],
    connectedSidewalkNodeIds: ['sidewalk_outer_loop'],
    affectedLaneIds: [],
  },
  {
    id: 'crosswalk_connector_east',
    center: [30, 6],
    size: [3, 6.6],
    waitSpots: [
      [30, 2.2],
      [30, 9.8],
    ],
    connectedSidewalkNodeIds: ['sidewalk_outer_loop'],
    affectedLaneIds: [],
  },
]

export const CROSSWALKS_BY_ID: Record<string, CrosswalkZone> = Object.fromEntries(
  CROSSWALKS.map((c) => [c.id, c]),
)

/** Documented pedestrian routes (shapes referenced by NPC routines). */
export const SIDEWALK_PATHS: SidewalkPath[] = [
  {
    id: 'sidewalk_inner_loop',
    waypoints: ring(19.5, true),
    connectedCrosswalkIds: ['crosswalk_north', 'crosswalk_west'],
  },
  {
    id: 'sidewalk_outer_loop',
    waypoints: ring(30, true),
    connectedCrosswalkIds: [
      'crosswalk_north',
      'crosswalk_west',
      'crosswalk_connector_north',
      'crosswalk_connector_east',
    ],
  },
  // North connector (east side) up to the residential south sidewalk.
  {
    id: 'sidewalk_residential_loop',
    waypoints: [
      [16, -30.5],
      [16, -40.5],
      [26, -40.5],
      [-2, -40.8],
      [-2, -49.2],
      [-18, -49.5],
    ],
    connectedCrosswalkIds: ['crosswalk_residential', 'crosswalk_connector_north'],
  },
  // East connector (south side) to the strip's west sidewalk.
  {
    id: 'sidewalk_industrial_loop',
    waypoints: [
      [30, 9.8],
      [40, 10.5],
      [43, 16],
      [43, 24],
      [53.2, 12],
    ],
    connectedCrosswalkIds: ['crosswalk_industrial', 'crosswalk_connector_east'],
  },
]

/** Shared behavior tuning for cars + pedestrians. */
export const TRAFFIC_TUNING = {
  /** Cars: hard stop if a pedestrian is basically touching the bumper/sides. */
  emergencyRadius: 2.2,
  /** Cars: pedestrian/player detection width beyond the lane half-width. */
  obstacleRadius: 0.8,
  /** Car-to-car following: distances to the other car's NEAR EDGE. */
  vehicleSlowDistance: 8,
  vehicleStopDistance: 3.2,
  vehicleLaneHalfWidth: 1.5,
  vehicleLookAhead: 9,
  /** Cars yield to a crossing/waiting pedestrian within this range of a crosswalk. */
  crosswalkYieldDistance: 6,
  /** Courtesy yield to a *waiting* pedestrian expires after this (failsafe). */
  yieldPatience: 6,
  /** Pedestrians: a car this close, moving toward the crossing, is dangerous. */
  pedestrianDangerDistance: 8,
  /** Below this speed a car counts as stopped/yielding for safety checks. */
  stoppedSpeed: 0.35,
  /**
   * Absolute stand-off failsafe: cross anyway after this long (cars brake
   * for pedestrians). Longer than a full signal cycle so it never fires in
   * normal signalled waiting.
   */
  pedestrianMaxWait: 40,
  /** Small organic pause at the curb before stepping off, even when clear. */
  curbPause: 0.4,
  /** Honk feedback: blocked threshold, bubble duration, spam cooldown. */
  honkAfterBlocked: 2.5,
  honkDuration: 2,
  honkCooldown: 6,
  /** Car acceleration/braking (units/s²). */
  acceleration: 4.5,
  braking: 16,
  /**
   * Braking envelopes are linear ramps and would otherwise make cars creep
   * asymptotically toward obstacles forever; below this the car commits to
   * a full stop (and blocked/honk/state logic can latch).
   */
  minMovingSpeed: 0.4,
}

/**
 * One signal controller governs both painted crosswalks: the whole ring
 * alternates between vehicle and pedestrian phases (see signalRules.ts).
 */
export const TRAFFIC_SIGNAL: TrafficSignalGroup = {
  id: 'signal_main',
  controlledLaneIds: ['lane_inner_cw', 'lane_outer_ccw', 'lane_industrial'],
  controlledCrosswalkIds: ['crosswalk_north', 'crosswalk_west', 'crosswalk_industrial'],
}

/** Crosswalks governed by the shared signal (pedestrians obey walk/don't-walk). */
export const SIGNALLED_CROSSWALK_IDS = new Set(TRAFFIC_SIGNAL.controlledCrosswalkIds)

/**
 * Stop signs (residential crosswalk): cars halt at the line, hold briefly,
 * then proceed when clear. Data mirrors StopLine plus a hold duration.
 */
export interface StopSign {
  id: string
  laneId: string
  position: Vec2
  direction: Vec2
  holdSeconds: number
}

export const STOP_SIGNS: StopSign[] = [
  {
    id: 'stop_res_east',
    laneId: 'lane_residential',
    position: [-5.6, -46.4],
    direction: [1, 0],
    holdSeconds: 1.2,
  },
  {
    id: 'stop_res_west',
    laneId: 'lane_residential',
    position: [1.6, -43.6],
    direction: [-1, 0],
    holdSeconds: 1.2,
  },
]

export const STOP_SIGNS_BY_LANE: Record<string, StopSign[]> = {
  lane_residential: STOP_SIGNS.filter((s) => s.laneId === 'lane_residential'),
}

/**
 * Stop lines one car-length short of each crosswalk zone, per lane approach.
 * The inner (cw) lane crosses north heading east and west heading north;
 * the outer (ccw) lane crosses north heading west and west heading south.
 */
export const STOP_LINES: StopLine[] = [
  { laneId: 'lane_inner_cw', position: [-3.6, -24.6], direction: [1, 0] },
  { laneId: 'lane_inner_cw', position: [-24.6, 3.6], direction: [0, -1] },
  { laneId: 'lane_outer_ccw', position: [3.6, -27.4], direction: [-1, 0] },
  { laneId: 'lane_outer_ccw', position: [-27.4, -3.6], direction: [0, 1] },
  // Industrial crosswalk (shared signal): northbound + southbound approaches.
  { laneId: 'lane_industrial', position: [50, 8.4], direction: [0, 1] },
  { laneId: 'lane_industrial', position: [46, 15.6], direction: [0, -1] },
]

export const STOP_LINES_BY_LANE: Record<string, StopLine[]> = {
  lane_inner_cw: STOP_LINES.filter((s) => s.laneId === 'lane_inner_cw'),
  lane_outer_ccw: STOP_LINES.filter((s) => s.laneId === 'lane_outer_ccw'),
  lane_industrial: STOP_LINES.filter((s) => s.laneId === 'lane_industrial'),
}
