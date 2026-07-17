import type { Vec2 } from '../../world/worldTypes'
import type {
  DistrictId,
  LaneSegment,
  RouteSpawnPoint,
  SegmentKind,
  TrafficDestination,
} from './roadGraphTypes'
import { COMPILED_SECTORS } from '../../world/authoring/compiledSectors'

/**
 * Authored routed-lane network for the six-block city.
 *
 * GEOMETRY CONTRACT — one source of truth:
 * Every lane line here is derived from the SAME constants that drive
 * rendering, colliders and the legacy loop lanes (cityLayout road constants
 * ± the 1.4-unit lane offset the loops have always used). Wherever a routed
 * segment runs on a road that a local loop drives, the routed line
 * coincides EXACTLY with the loop lane, so routed cars and loop cars share
 * physical lanes and queue behind each other via the existing following
 * logic. roadGraphValidation asserts this alignment against LANES_BY_ID —
 * the two representations cannot drift apart silently.
 *
 * Junction movements are segments (kind 'junction') with explicit turn
 * polylines that stay inside the junction box (road ∩ road = all asphalt).
 *
 * Handedness note: the legacy loops are not uniformly right-hand (e.g. the
 * residential street runs eastbound on its north side, the industrial road
 * southbound on its east side). Routed lanes ADOPT each road's existing
 * convention — matching live traffic matters more than textbook handedness;
 * turn movements that cross the opposing lane are explicit and tagged.
 *
 * v1 limitation (documented): the market-strip and freight stretches of the
 * eastern arterial have opposite loop handedness, so there is no direct
 * routed link across the z∈[-20,-14] seam — routes between those districts
 * legally detour via the ring. All-pairs district reachability holds.
 */

/** Lane offset from a road centerline — matches every legacy loop lane. */
export const LANE_OFFSET = 1.4

/** Junction boxes (road ∩ road), used for turn arcs and spawn validation. */
export const JUNCTION_BOXES: Record<string, { minX: number; maxX: number; minZ: number; maxZ: number }> = {
  // Kit-compiled junction boxes (merge/turn arcs of authored sectors).
  ...Object.assign({}, ...COMPILED_SECTORS.map((c) => c.junctionBoxes)),
  j_ring_north: { minX: 9, maxX: 15, minZ: -29, maxZ: -23 },
  j_ring_east: { minX: 23, maxX: 29, minZ: 3, maxZ: 9 },
  j_ring_west: { minX: -29, maxX: -23, minZ: 3, maxZ: 9 },
  j_ring_south: { minX: -15, maxX: -9, minZ: 23, maxZ: 29 },
  j_res_north: { minX: 9, maxX: 15, minZ: -48, maxZ: -42 },
  j_res_arterial: { minX: 44, maxX: 52, minZ: -48, maxZ: -42 },
  j_ind_east: { minX: 44, maxX: 52, minZ: 3, maxZ: 9 },
  j_west_res: { minX: -51, maxX: -45, minZ: 3, maxZ: 9 },
  j_south_res: { minX: -15, maxX: -9, minZ: 45, maxZ: 51 },
}

interface SegmentSpec {
  id: string
  kind: SegmentKind
  points: Vec2[]
  speedLimit: number
  districtId: DistrictId
  roadId: string
  laneId: string
  tags?: string[]
  junctionId?: string
  movement?: LaneSegment['movement']
  signalGroupId?: string
  stopLineKeys?: { position: Vec2; direction: Vec2 }[]
  crossingZoneIds?: string[]
  stopSignIds?: string[]
  isConnector?: boolean
  spawn?: boolean
  destination?: boolean
}

/**
 * Quadratic-bezier turn arc between two lane endpoints. The control point is
 * the intersection of the entry/exit direction lines (for perpendicular
 * turns: the corner), which keeps the arc inside the junction box.
 */
export function turnArc(from: Vec2, fromDir: Vec2, to: Vec2, toDir: Vec2, steps = 4): Vec2[] {
  // Line intersection: from + t*fromDir == to - s*toDir.
  const cross = fromDir[0] * toDir[1] - fromDir[1] * toDir[0]
  let cx: number
  let cz: number
  if (Math.abs(cross) < 1e-6) {
    // Parallel (straight-through): midpoint control = straight line.
    cx = (from[0] + to[0]) / 2
    cz = (from[1] + to[1]) / 2
  } else {
    const t = ((to[0] - from[0]) * toDir[1] - (to[1] - from[1]) * toDir[0]) / cross
    cx = from[0] + fromDir[0] * t
    cz = from[1] + fromDir[1] * t
  }
  const pts: Vec2[] = []
  for (let i = 0; i <= steps; i++) {
    const u = i / steps
    const a = (1 - u) * (1 - u)
    const b = 2 * (1 - u) * u
    const c = u * u
    pts.push([a * from[0] + b * cx + c * to[0], a * from[1] + b * cz + c * to[1]])
  }
  return pts
}

// Direction shorthands (heading convention: atan2(dx, dz)).
const E: Vec2 = [1, 0]
const W: Vec2 = [-1, 0]
const N: Vec2 = [0, -1] // -z is north
const S: Vec2 = [0, 1]

const TURN_SPEED = 3.4
const CONNECTOR_SPEED = 5

function lane(spec: Omit<SegmentSpec, 'kind'>): SegmentSpec {
  return { kind: 'lane', ...spec }
}

function junction(spec: Omit<SegmentSpec, 'kind'>): SegmentSpec {
  return { kind: 'junction', ...spec }
}

const SEGMENT_SPECS: SegmentSpec[] = [
  // ================= Central ring — inner clockwise lane =================
  lane({
    id: 'ring_in_n_a', points: [[-24.6, -24.6], [9, -24.6]], speedLimit: 5.5,
    districtId: 'central', roadId: 'ring', laneId: 'inner_cw',
    signalGroupId: 'signal_main',
    stopLineKeys: [{ position: [-3.6, -24.6], direction: [1, 0] }],
    crossingZoneIds: ['crosswalk_north'], spawn: true, destination: true,
  }),
  lane({
    id: 'ring_in_n_b', points: [[15, -24.6], [24.6, -24.6]], speedLimit: 5.5,
    districtId: 'central', roadId: 'ring', laneId: 'inner_cw',
  }),
  lane({
    id: 'ring_in_e_a', points: [[24.6, -24.6], [24.6, 3]], speedLimit: 5.5,
    districtId: 'central', roadId: 'ring', laneId: 'inner_cw', spawn: true, destination: true,
  }),
  lane({
    id: 'ring_in_e_b', points: [[24.6, 9], [24.6, 24.6]], speedLimit: 5.5,
    districtId: 'central', roadId: 'ring', laneId: 'inner_cw', destination: true,
  }),
  lane({
    id: 'ring_in_s_a', points: [[24.6, 24.6], [-9, 24.6]], speedLimit: 5.5,
    districtId: 'central', roadId: 'ring', laneId: 'inner_cw', spawn: true, destination: true,
  }),
  lane({
    id: 'ring_in_s_b', points: [[-15, 24.6], [-24.6, 24.6]], speedLimit: 5.5,
    districtId: 'central', roadId: 'ring', laneId: 'inner_cw',
  }),
  lane({
    id: 'ring_in_w_a', points: [[-24.6, 24.6], [-24.6, 9]], speedLimit: 5.5,
    districtId: 'central', roadId: 'ring', laneId: 'inner_cw',
  }),
  // Starts at z = 3.8 (asymmetric junction cut) so the existing stop line at
  // z = 3.6 lands ON this segment and signal braking applies unchanged.
  lane({
    id: 'ring_in_w_b', points: [[-24.6, 3.8], [-24.6, -24.6]], speedLimit: 5.5,
    districtId: 'central', roadId: 'ring', laneId: 'inner_cw',
    signalGroupId: 'signal_main',
    stopLineKeys: [{ position: [-24.6, 3.6], direction: [0, -1] }],
    crossingZoneIds: ['crosswalk_west'], spawn: true, destination: true,
  }),

  // ============= Central ring — outer counter-clockwise lane =============
  lane({
    id: 'ring_out_s_a', points: [[-27.4, 27.4], [-15, 27.4]], speedLimit: 6.2,
    districtId: 'central', roadId: 'ring', laneId: 'outer_ccw',
  }),
  lane({
    id: 'ring_out_s_b', points: [[-9, 27.4], [27.4, 27.4]], speedLimit: 6.2,
    districtId: 'central', roadId: 'ring', laneId: 'outer_ccw', spawn: true, destination: true,
  }),
  lane({
    id: 'ring_out_e_a', points: [[27.4, 27.4], [27.4, 9]], speedLimit: 6.2,
    districtId: 'central', roadId: 'ring', laneId: 'outer_ccw', destination: true,
  }),
  lane({
    id: 'ring_out_e_b', points: [[27.4, 3], [27.4, -27.4]], speedLimit: 6.2,
    districtId: 'central', roadId: 'ring', laneId: 'outer_ccw', spawn: true, destination: true,
  }),
  lane({
    id: 'ring_out_n_a', points: [[27.4, -27.4], [15, -27.4]], speedLimit: 6.2,
    districtId: 'central', roadId: 'ring', laneId: 'outer_ccw',
  }),
  lane({
    id: 'ring_out_n_b', points: [[9, -27.4], [-27.4, -27.4]], speedLimit: 6.2,
    districtId: 'central', roadId: 'ring', laneId: 'outer_ccw',
    signalGroupId: 'signal_main',
    stopLineKeys: [{ position: [3.6, -27.4], direction: [-1, 0] }],
    crossingZoneIds: ['crosswalk_north'], spawn: true, destination: true,
  }),
  lane({
    id: 'ring_out_w_a', points: [[-27.4, -27.4], [-27.4, 3]], speedLimit: 6.2,
    districtId: 'central', roadId: 'ring', laneId: 'outer_ccw',
    signalGroupId: 'signal_main',
    stopLineKeys: [{ position: [-27.4, -3.6], direction: [0, 1] }],
    crossingZoneIds: ['crosswalk_west'], spawn: true, destination: true,
  }),
  lane({
    id: 'ring_out_w_b', points: [[-27.4, 9], [-27.4, 27.4]], speedLimit: 6.2,
    districtId: 'central', roadId: 'ring', laneId: 'outer_ccw',
  }),

  // ==================== Connector north (x = 12) =========================
  lane({
    id: 'conn_n_nb', points: [[13.4, -29], [13.4, -42]], speedLimit: CONNECTOR_SPEED,
    districtId: 'residential', roadId: 'connector_north', laneId: 'nb',
    crossingZoneIds: ['crosswalk_connector_north'], isConnector: true,
  }),
  lane({
    id: 'conn_n_sb', points: [[10.6, -42], [10.6, -29]], speedLimit: CONNECTOR_SPEED,
    districtId: 'residential', roadId: 'connector_north', laneId: 'sb',
    crossingZoneIds: ['crosswalk_connector_north'], isConnector: true,
  }),

  // ==================== Connector east (z = 6) ===========================
  lane({
    id: 'conn_e_eb', points: [[29, 7.4], [44, 7.4]], speedLimit: CONNECTOR_SPEED,
    districtId: 'industrial', roadId: 'connector_east', laneId: 'eb',
    crossingZoneIds: ['crosswalk_connector_east'], isConnector: true,
  }),
  lane({
    id: 'conn_e_wb', points: [[44, 4.6], [29, 4.6]], speedLimit: CONNECTOR_SPEED,
    districtId: 'industrial', roadId: 'connector_east', laneId: 'wb',
    crossingZoneIds: ['crosswalk_connector_east'], isConnector: true,
  }),

  // ==================== Connector west (z = 6) ===========================
  lane({
    id: 'conn_w_wb', points: [[-29, 4.6], [-45, 4.6]], speedLimit: CONNECTOR_SPEED,
    districtId: 'residential_west', roadId: 'connector_west', laneId: 'wb', isConnector: true,
  }),
  lane({
    id: 'conn_w_eb', points: [[-45, 7.4], [-29, 7.4]], speedLimit: CONNECTOR_SPEED,
    districtId: 'residential_west', roadId: 'connector_west', laneId: 'eb', isConnector: true,
  }),

  // ==================== Connector south (x = -12) ========================
  lane({
    id: 'conn_s_sb', points: [[-13.4, 29], [-13.4, 45]], speedLimit: CONNECTOR_SPEED,
    districtId: 'residential_south', roadId: 'connector_south', laneId: 'sb', isConnector: true,
  }),
  lane({
    id: 'conn_s_nb', points: [[-10.6, 45], [-10.6, 29]], speedLimit: CONNECTOR_SPEED,
    districtId: 'residential_south', roadId: 'connector_south', laneId: 'nb', isConnector: true,
  }),

  // ============ Residential street (north district, z = -45) =============
  // Matches lane_residential's lines (EB on the south half at z = -46.4,
  // WB at -43.6) and extends east past the loop's x = 28 turnaround to the
  // freight arterial T-junction at x = 44.
  lane({
    id: 'res_eb_a', points: [[-18, -46.4], [9, -46.4]], speedLimit: 4.2,
    districtId: 'residential', roadId: 'residential_street', laneId: 'eb',
    crossingZoneIds: ['crosswalk_residential'], stopSignIds: ['stop_res_east'],
    spawn: true, destination: true,
  }),
  lane({
    id: 'res_eb_b', points: [[15, -46.4], [44, -46.4]], speedLimit: 4.2,
    districtId: 'residential', roadId: 'residential_street', laneId: 'eb',
    spawn: true, destination: true,
  }),
  lane({
    id: 'res_wb_a', points: [[44, -43.6], [15, -43.6]], speedLimit: 4.2,
    districtId: 'residential', roadId: 'residential_street', laneId: 'wb',
    spawn: true, destination: true,
  }),
  lane({
    id: 'res_wb_b', points: [[9, -43.6], [-18, -43.6]], speedLimit: 4.2,
    districtId: 'residential', roadId: 'residential_street', laneId: 'wb',
    crossingZoneIds: ['crosswalk_residential'], stopSignIds: ['stop_res_west'],
    destination: true,
  }),
  {
    id: 'res_turn_w', kind: 'turnaround', points: [[-18, -43.6], [-18, -46.4]],
    speedLimit: TURN_SPEED, districtId: 'residential',
    roadId: 'residential_street', laneId: 'turn_w',
  },

  // ============ Residential West (x = -48) — matches its loop ============
  lane({
    id: 'rw_sb_a', points: [[-46.6, -18], [-46.6, 3]], speedLimit: 4.2,
    districtId: 'residential_west', roadId: 'residential_west_street', laneId: 'sb',
    spawn: true, destination: true,
  }),
  lane({
    id: 'rw_sb_b', points: [[-46.6, 9], [-46.6, 18]], speedLimit: 4.2,
    districtId: 'residential_west', roadId: 'residential_west_street', laneId: 'sb',
  }),
  lane({
    id: 'rw_nb_a', points: [[-49.4, 18], [-49.4, 9]], speedLimit: 4.2,
    districtId: 'residential_west', roadId: 'residential_west_street', laneId: 'nb',
  }),
  lane({
    id: 'rw_nb_b', points: [[-49.4, 3], [-49.4, -18]], speedLimit: 4.2,
    districtId: 'residential_west', roadId: 'residential_west_street', laneId: 'nb',
    spawn: true, destination: true,
  }),
  {
    id: 'rw_turn_s', kind: 'turnaround', points: [[-46.6, 18], [-49.4, 18]],
    speedLimit: TURN_SPEED, districtId: 'residential_west',
    roadId: 'residential_west_street', laneId: 'turn_s',
  },
  {
    id: 'rw_turn_n', kind: 'turnaround', points: [[-49.4, -18], [-46.6, -18]],
    speedLimit: TURN_SPEED, districtId: 'residential_west',
    roadId: 'residential_west_street', laneId: 'turn_n',
  },

  // ============ Residential South (z = 48) — matches its loop ============
  lane({
    id: 'rs_eb_a', points: [[-18, 49.4], [-15, 49.4]], speedLimit: 4.2,
    districtId: 'residential_south', roadId: 'residential_south_street', laneId: 'eb',
  }),
  lane({
    id: 'rs_eb_b', points: [[-9, 49.4], [18, 49.4]], speedLimit: 4.2,
    districtId: 'residential_south', roadId: 'residential_south_street', laneId: 'eb',
    spawn: true, destination: true,
  }),
  lane({
    id: 'rs_wb_a', points: [[18, 46.6], [-9, 46.6]], speedLimit: 4.2,
    districtId: 'residential_south', roadId: 'residential_south_street', laneId: 'wb',
    spawn: true, destination: true,
  }),
  lane({
    id: 'rs_wb_b', points: [[-15, 46.6], [-18, 46.6]], speedLimit: 4.2,
    districtId: 'residential_south', roadId: 'residential_south_street', laneId: 'wb',
  }),
  {
    id: 'rs_turn_e', kind: 'turnaround', points: [[18, 49.4], [18, 46.6]],
    speedLimit: TURN_SPEED, districtId: 'residential_south',
    roadId: 'residential_south_street', laneId: 'turn_e',
  },
  {
    id: 'rs_turn_w', kind: 'turnaround', points: [[-18, 46.6], [-18, 49.4]],
    speedLimit: TURN_SPEED, districtId: 'residential_south',
    roadId: 'residential_south_street', laneId: 'turn_w',
  },

  // ========== Industrial / Market Strip (x = 48) — matches loop ==========
  // Left-hand like its loop: SB on the east half (x = 50), NB west (x = 46).
  // The SB junction cut is asymmetric (z = 8.2) so the existing stop line at
  // z = 8.4 lands on ind_sb_b and signal braking works unchanged.
  lane({
    id: 'ind_sb_a', points: [[50, -14], [50, 3]], speedLimit: 6.5,
    districtId: 'industrial', roadId: 'industrial_road', laneId: 'sb',
    spawn: true, destination: true,
  }),
  lane({
    id: 'ind_sb_b', points: [[50, 8.2], [50, 24]], speedLimit: 6.5,
    districtId: 'industrial', roadId: 'industrial_road', laneId: 'sb',
    signalGroupId: 'signal_main',
    stopLineKeys: [{ position: [50, 8.4], direction: [0, 1] }],
    crossingZoneIds: ['crosswalk_industrial'], destination: true,
  }),
  lane({
    id: 'ind_nb_a', points: [[46, 24], [46, 9]], speedLimit: 6.5,
    districtId: 'industrial', roadId: 'industrial_road', laneId: 'nb',
    signalGroupId: 'signal_main',
    stopLineKeys: [{ position: [46, 15.6], direction: [0, -1] }],
    crossingZoneIds: ['crosswalk_industrial'], spawn: true, destination: true,
  }),
  lane({
    id: 'ind_nb_b', points: [[46, 3], [46, -14]], speedLimit: 6.5,
    districtId: 'industrial', roadId: 'industrial_road', laneId: 'nb',
    destination: true,
  }),
  {
    id: 'ind_turn_s', kind: 'turnaround', points: [[50, 24], [46, 24]],
    speedLimit: TURN_SPEED, districtId: 'industrial',
    roadId: 'industrial_road', laneId: 'turn_s',
  },
  {
    id: 'ind_turn_n', kind: 'turnaround', points: [[46, -14], [50, -14]],
    speedLimit: TURN_SPEED, districtId: 'industrial',
    roadId: 'industrial_road', laneId: 'turn_n',
  },

  // ===== Freight arterial (industrial_north, x = 48) — matches loop ======
  // NB on the east half (x = 50) toward the freight yards, SB west (x = 46);
  // the T-junction with the residential street cuts both lanes.
  lane({
    id: 'art_nb_a', points: [[50, -20], [50, -42]], speedLimit: 6,
    districtId: 'industrial_north', roadId: 'freight_arterial', laneId: 'nb',
    spawn: true, destination: true,
  }),
  lane({
    id: 'art_nb_b', points: [[50, -48], [50, -50]], speedLimit: 6,
    districtId: 'industrial_north', roadId: 'freight_arterial', laneId: 'nb',
    destination: true,
  }),
  lane({
    id: 'art_sb_a', points: [[46, -50], [46, -48]], speedLimit: 6,
    districtId: 'industrial_north', roadId: 'freight_arterial', laneId: 'sb',
  }),
  lane({
    id: 'art_sb_b', points: [[46, -42], [46, -20]], speedLimit: 6,
    districtId: 'industrial_north', roadId: 'freight_arterial', laneId: 'sb',
    spawn: true, destination: true,
  }),
  {
    id: 'art_turn_n', kind: 'turnaround', points: [[50, -50], [46, -50]],
    speedLimit: TURN_SPEED, districtId: 'industrial_north',
    roadId: 'freight_arterial', laneId: 'turn_n',
  },
  {
    id: 'art_turn_s', kind: 'turnaround', points: [[46, -20], [50, -20]],
    speedLimit: TURN_SPEED, districtId: 'industrial_north',
    roadId: 'freight_arterial', laneId: 'turn_s',
  },

  // ===== Downtown Gateway avenue (Large City Foundation v1, s0_-1) =======
  // The arterial simply continues north from the freight stub's end node at
  // (50, -50): a new fork edge appears by node adjacency — NO existing
  // segment or id changes. Southbound rejoins art_sb_a's start node.
  lane({
    id: 'gate_nb', points: [[50, -50], [50, -96]], speedLimit: 6,
    districtId: 'downtown_gateway', roadId: 'gateway_avenue', laneId: 'nb',
    destination: true,
  }),
  {
    id: 'gate_turn_n', kind: 'turnaround', points: [[50, -96], [46, -96]],
    speedLimit: TURN_SPEED, districtId: 'downtown_gateway',
    roadId: 'gateway_avenue', laneId: 'turn_n',
  },
  lane({
    id: 'gate_sb', points: [[46, -96], [46, -50]], speedLimit: 6,
    districtId: 'downtown_gateway', roadId: 'gateway_avenue', laneId: 'sb',
    destination: true,
  }),

  // ======================= Junction: ring × connector north ==============
  junction({
    id: 'jn_ring_n_in_straight', points: [[9, -24.6], [15, -24.6]], speedLimit: 5.5,
    districtId: 'central', roadId: 'ring', laneId: 'inner_cw',
    junctionId: 'j_ring_north', movement: 'straight',
  }),
  junction({
    id: 'jn_ring_n_in_left_conn', points: turnArc([9, -24.6], E, [13.4, -29], N),
    speedLimit: TURN_SPEED, districtId: 'central', roadId: 'ring', laneId: 'inner_cw',
    junctionId: 'j_ring_north', movement: 'left', tags: ['crossesOpposing'],
  }),
  junction({
    id: 'jn_ring_n_out_straight', points: [[15, -27.4], [9, -27.4]], speedLimit: 6.2,
    districtId: 'central', roadId: 'ring', laneId: 'outer_ccw',
    junctionId: 'j_ring_north', movement: 'straight',
  }),
  junction({
    id: 'jn_ring_n_out_right_conn', points: turnArc([15, -27.4], W, [13.4, -29], N),
    speedLimit: TURN_SPEED, districtId: 'central', roadId: 'ring', laneId: 'outer_ccw',
    junctionId: 'j_ring_north', movement: 'right',
  }),
  junction({
    id: 'jn_ring_n_conn_right_out', points: turnArc([10.6, -29], S, [9, -27.4], W),
    speedLimit: TURN_SPEED, districtId: 'central', roadId: 'connector_north', laneId: 'sb',
    junctionId: 'j_ring_north', movement: 'right',
  }),
  junction({
    id: 'jn_ring_n_conn_left_in', points: turnArc([10.6, -29], S, [15, -24.6], E),
    speedLimit: TURN_SPEED, districtId: 'central', roadId: 'connector_north', laneId: 'sb',
    junctionId: 'j_ring_north', movement: 'left', tags: ['crossesOpposing'],
  }),

  // ======================= Junction: ring × connector east ===============
  junction({
    id: 'jn_ring_e_in_straight', points: [[24.6, 3], [24.6, 9]], speedLimit: 5.5,
    districtId: 'central', roadId: 'ring', laneId: 'inner_cw',
    junctionId: 'j_ring_east', movement: 'straight',
  }),
  junction({
    id: 'jn_ring_e_in_left_conn', points: turnArc([24.6, 3], S, [29, 7.4], E),
    speedLimit: TURN_SPEED, districtId: 'central', roadId: 'ring', laneId: 'inner_cw',
    junctionId: 'j_ring_east', movement: 'left', tags: ['crossesOpposing'],
  }),
  junction({
    id: 'jn_ring_e_out_straight', points: [[27.4, 9], [27.4, 3]], speedLimit: 6.2,
    districtId: 'central', roadId: 'ring', laneId: 'outer_ccw',
    junctionId: 'j_ring_east', movement: 'straight',
  }),
  junction({
    id: 'jn_ring_e_out_right_conn', points: turnArc([27.4, 9], N, [29, 7.4], E),
    speedLimit: TURN_SPEED, districtId: 'central', roadId: 'ring', laneId: 'outer_ccw',
    junctionId: 'j_ring_east', movement: 'right',
  }),
  junction({
    id: 'jn_ring_e_conn_right_out', points: turnArc([29, 4.6], W, [27.4, 3], N),
    speedLimit: TURN_SPEED, districtId: 'central', roadId: 'connector_east', laneId: 'wb',
    junctionId: 'j_ring_east', movement: 'right',
  }),
  junction({
    id: 'jn_ring_e_conn_left_in', points: turnArc([29, 4.6], W, [24.6, 9], S),
    speedLimit: TURN_SPEED, districtId: 'central', roadId: 'connector_east', laneId: 'wb',
    junctionId: 'j_ring_east', movement: 'left', tags: ['crossesOpposing'],
  }),

  // ======================= Junction: ring × connector west ===============
  junction({
    id: 'jn_ring_w_in_straight', points: [[-24.6, 9], [-24.6, 3.8]], speedLimit: 5.5,
    districtId: 'central', roadId: 'ring', laneId: 'inner_cw',
    junctionId: 'j_ring_west', movement: 'straight',
  }),
  junction({
    id: 'jn_ring_w_in_left_conn', points: turnArc([-24.6, 9], N, [-29, 4.6], W),
    speedLimit: TURN_SPEED, districtId: 'central', roadId: 'ring', laneId: 'inner_cw',
    junctionId: 'j_ring_west', movement: 'left', tags: ['crossesOpposing'],
  }),
  junction({
    id: 'jn_ring_w_out_straight', points: [[-27.4, 3], [-27.4, 9]], speedLimit: 6.2,
    districtId: 'central', roadId: 'ring', laneId: 'outer_ccw',
    junctionId: 'j_ring_west', movement: 'straight',
  }),
  junction({
    id: 'jn_ring_w_out_right_conn', points: turnArc([-27.4, 3], S, [-29, 4.6], W),
    speedLimit: TURN_SPEED, districtId: 'central', roadId: 'ring', laneId: 'outer_ccw',
    junctionId: 'j_ring_west', movement: 'right',
  }),
  junction({
    id: 'jn_ring_w_conn_right_out', points: turnArc([-29, 7.4], E, [-27.4, 9], S),
    speedLimit: TURN_SPEED, districtId: 'central', roadId: 'connector_west', laneId: 'eb',
    junctionId: 'j_ring_west', movement: 'right',
  }),
  junction({
    id: 'jn_ring_w_conn_left_in', points: turnArc([-29, 7.4], E, [-24.6, 3.8], N),
    speedLimit: TURN_SPEED, districtId: 'central', roadId: 'connector_west', laneId: 'eb',
    junctionId: 'j_ring_west', movement: 'left', tags: ['crossesOpposing'],
  }),

  // ======================= Junction: ring × connector south ==============
  junction({
    id: 'jn_ring_s_in_straight', points: [[-9, 24.6], [-15, 24.6]], speedLimit: 5.5,
    districtId: 'central', roadId: 'ring', laneId: 'inner_cw',
    junctionId: 'j_ring_south', movement: 'straight',
  }),
  junction({
    id: 'jn_ring_s_in_left_conn', points: turnArc([-9, 24.6], W, [-13.4, 29], S),
    speedLimit: TURN_SPEED, districtId: 'central', roadId: 'ring', laneId: 'inner_cw',
    junctionId: 'j_ring_south', movement: 'left', tags: ['crossesOpposing'],
  }),
  junction({
    id: 'jn_ring_s_out_straight', points: [[-15, 27.4], [-9, 27.4]], speedLimit: 6.2,
    districtId: 'central', roadId: 'ring', laneId: 'outer_ccw',
    junctionId: 'j_ring_south', movement: 'straight',
  }),
  junction({
    id: 'jn_ring_s_out_right_conn', points: turnArc([-15, 27.4], E, [-13.4, 29], S),
    speedLimit: TURN_SPEED, districtId: 'central', roadId: 'ring', laneId: 'outer_ccw',
    junctionId: 'j_ring_south', movement: 'right',
  }),
  junction({
    id: 'jn_ring_s_conn_right_out', points: turnArc([-10.6, 29], N, [-9, 27.4], E),
    speedLimit: TURN_SPEED, districtId: 'central', roadId: 'connector_south', laneId: 'nb',
    junctionId: 'j_ring_south', movement: 'right',
  }),
  junction({
    id: 'jn_ring_s_conn_left_in', points: turnArc([-10.6, 29], N, [-15, 24.6], W),
    speedLimit: TURN_SPEED, districtId: 'central', roadId: 'connector_south', laneId: 'nb',
    junctionId: 'j_ring_south', movement: 'left', tags: ['crossesOpposing'],
  }),

  // ============= Junction: residential street × connector north ==========
  junction({
    id: 'jn_res_n_eb_straight', points: [[9, -46.4], [15, -46.4]], speedLimit: 4.2,
    districtId: 'residential', roadId: 'residential_street', laneId: 'eb',
    junctionId: 'j_res_north', movement: 'straight',
  }),
  junction({
    id: 'jn_res_n_eb_right_conn', points: turnArc([9, -46.4], E, [10.6, -42], S),
    speedLimit: TURN_SPEED, districtId: 'residential', roadId: 'residential_street', laneId: 'eb',
    junctionId: 'j_res_north', movement: 'right', tags: ['crossesOpposing'],
  }),
  junction({
    id: 'jn_res_n_wb_straight', points: [[15, -43.6], [9, -43.6]], speedLimit: 4.2,
    districtId: 'residential', roadId: 'residential_street', laneId: 'wb',
    junctionId: 'j_res_north', movement: 'straight',
  }),
  junction({
    id: 'jn_res_n_wb_left_conn', points: turnArc([15, -43.6], W, [10.6, -42], S),
    speedLimit: TURN_SPEED, districtId: 'residential', roadId: 'residential_street', laneId: 'wb',
    junctionId: 'j_res_north', movement: 'left',
  }),
  junction({
    id: 'jn_res_n_conn_right_eb', points: turnArc([13.4, -42], N, [15, -46.4], E),
    speedLimit: TURN_SPEED, districtId: 'residential', roadId: 'connector_north', laneId: 'nb',
    junctionId: 'j_res_north', movement: 'right', tags: ['crossesOpposing'],
  }),
  junction({
    id: 'jn_res_n_conn_left_wb', points: turnArc([13.4, -42], N, [9, -43.6], W),
    speedLimit: TURN_SPEED, districtId: 'residential', roadId: 'connector_north', laneId: 'nb',
    junctionId: 'j_res_north', movement: 'left',
  }),

  // ========== Junction: residential street × freight arterial (T) ========
  junction({
    id: 'jn_res_art_nb_straight', points: [[50, -42], [50, -48]], speedLimit: 6,
    districtId: 'industrial_north', roadId: 'freight_arterial', laneId: 'nb',
    junctionId: 'j_res_arterial', movement: 'straight',
  }),
  junction({
    id: 'jn_res_art_sb_straight', points: [[46, -48], [46, -42]], speedLimit: 6,
    districtId: 'industrial_north', roadId: 'freight_arterial', laneId: 'sb',
    junctionId: 'j_res_arterial', movement: 'straight',
  }),
  junction({
    id: 'jn_res_art_eb_left_nb', points: turnArc([44, -46.4], E, [50, -48], N),
    speedLimit: TURN_SPEED, districtId: 'industrial_north',
    roadId: 'residential_street', laneId: 'eb',
    junctionId: 'j_res_arterial', movement: 'left', tags: ['crossesOpposing'],
  }),
  junction({
    id: 'jn_res_art_eb_right_sb', points: turnArc([44, -46.4], E, [46, -42], S),
    speedLimit: TURN_SPEED, districtId: 'industrial_north',
    roadId: 'residential_street', laneId: 'eb',
    junctionId: 'j_res_arterial', movement: 'right',
  }),
  junction({
    id: 'jn_res_art_nb_left_wb', points: turnArc([50, -42], N, [44, -43.6], W),
    speedLimit: TURN_SPEED, districtId: 'industrial_north',
    roadId: 'freight_arterial', laneId: 'nb',
    junctionId: 'j_res_arterial', movement: 'left', tags: ['crossesOpposing'],
  }),
  junction({
    id: 'jn_res_art_sb_right_wb', points: turnArc([46, -48], S, [44, -43.6], W),
    speedLimit: TURN_SPEED, districtId: 'industrial_north',
    roadId: 'freight_arterial', laneId: 'sb',
    junctionId: 'j_res_arterial', movement: 'right',
  }),

  // ============ Junction: industrial road × connector east ===============
  junction({
    id: 'jn_ind_e_sb_straight', points: [[50, 3], [50, 8.2]], speedLimit: 6.5,
    districtId: 'industrial', roadId: 'industrial_road', laneId: 'sb',
    junctionId: 'j_ind_east', movement: 'straight',
  }),
  junction({
    id: 'jn_ind_e_nb_straight', points: [[46, 9], [46, 3]], speedLimit: 6.5,
    districtId: 'industrial', roadId: 'industrial_road', laneId: 'nb',
    junctionId: 'j_ind_east', movement: 'straight',
  }),
  junction({
    id: 'jn_ind_e_eb_left_nb', points: turnArc([44, 7.4], E, [46, 3], N),
    speedLimit: TURN_SPEED, districtId: 'industrial', roadId: 'connector_east', laneId: 'eb',
    junctionId: 'j_ind_east', movement: 'left',
  }),
  junction({
    id: 'jn_ind_e_eb_right_sb', points: turnArc([44, 7.4], E, [50, 8.2], S),
    speedLimit: TURN_SPEED, districtId: 'industrial', roadId: 'connector_east', laneId: 'eb',
    junctionId: 'j_ind_east', movement: 'right', tags: ['crossesOpposing'],
  }),
  junction({
    id: 'jn_ind_e_sb_right_wb', points: turnArc([50, 3], S, [44, 4.6], W),
    speedLimit: TURN_SPEED, districtId: 'industrial', roadId: 'industrial_road', laneId: 'sb',
    junctionId: 'j_ind_east', movement: 'right', tags: ['crossesOpposing'],
  }),
  junction({
    id: 'jn_ind_e_nb_left_wb', points: turnArc([46, 9], N, [44, 4.6], W),
    speedLimit: TURN_SPEED, districtId: 'industrial', roadId: 'industrial_road', laneId: 'nb',
    junctionId: 'j_ind_east', movement: 'left',
  }),

  // ========== Junction: residential west street × connector west =========
  junction({
    id: 'jn_west_sb_straight', points: [[-46.6, 3], [-46.6, 9]], speedLimit: 4.2,
    districtId: 'residential_west', roadId: 'residential_west_street', laneId: 'sb',
    junctionId: 'j_west_res', movement: 'straight',
  }),
  junction({
    id: 'jn_west_nb_straight', points: [[-49.4, 9], [-49.4, 3]], speedLimit: 4.2,
    districtId: 'residential_west', roadId: 'residential_west_street', laneId: 'nb',
    junctionId: 'j_west_res', movement: 'straight',
  }),
  junction({
    id: 'jn_west_wb_left_sb', points: turnArc([-45, 4.6], W, [-46.6, 9], S),
    speedLimit: TURN_SPEED, districtId: 'residential_west',
    roadId: 'connector_west', laneId: 'wb',
    junctionId: 'j_west_res', movement: 'left',
  }),
  junction({
    id: 'jn_west_wb_right_nb', points: turnArc([-45, 4.6], W, [-49.4, 3], N),
    speedLimit: TURN_SPEED, districtId: 'residential_west',
    roadId: 'connector_west', laneId: 'wb',
    junctionId: 'j_west_res', movement: 'right', tags: ['crossesOpposing'],
  }),
  junction({
    id: 'jn_west_sb_left_eb', points: turnArc([-46.6, 3], S, [-45, 7.4], E),
    speedLimit: TURN_SPEED, districtId: 'residential_west',
    roadId: 'residential_west_street', laneId: 'sb',
    junctionId: 'j_west_res', movement: 'left',
  }),
  junction({
    id: 'jn_west_nb_right_eb', points: turnArc([-49.4, 9], N, [-45, 7.4], E),
    speedLimit: TURN_SPEED, districtId: 'residential_west',
    roadId: 'residential_west_street', laneId: 'nb',
    junctionId: 'j_west_res', movement: 'right', tags: ['crossesOpposing'],
  }),

  // ========== Junction: residential south street × connector south =======
  junction({
    id: 'jn_south_eb_straight', points: [[-15, 49.4], [-9, 49.4]], speedLimit: 4.2,
    districtId: 'residential_south', roadId: 'residential_south_street', laneId: 'eb',
    junctionId: 'j_south_res', movement: 'straight',
  }),
  junction({
    id: 'jn_south_wb_straight', points: [[-9, 46.6], [-15, 46.6]], speedLimit: 4.2,
    districtId: 'residential_south', roadId: 'residential_south_street', laneId: 'wb',
    junctionId: 'j_south_res', movement: 'straight',
  }),
  junction({
    id: 'jn_south_sb_right_wb', points: turnArc([-13.4, 45], S, [-15, 46.6], W),
    speedLimit: TURN_SPEED, districtId: 'residential_south',
    roadId: 'connector_south', laneId: 'sb',
    junctionId: 'j_south_res', movement: 'right',
  }),
  junction({
    id: 'jn_south_sb_left_eb', points: turnArc([-13.4, 45], S, [-9, 49.4], E),
    speedLimit: TURN_SPEED, districtId: 'residential_south',
    roadId: 'connector_south', laneId: 'sb',
    junctionId: 'j_south_res', movement: 'left', tags: ['crossesOpposing'],
  }),
  junction({
    id: 'jn_south_eb_left_nb', points: turnArc([-15, 49.4], E, [-10.6, 45], N),
    speedLimit: TURN_SPEED, districtId: 'residential_south',
    roadId: 'residential_south_street', laneId: 'eb',
    junctionId: 'j_south_res', movement: 'left', tags: ['crossesOpposing'],
  }),
  junction({
    id: 'jn_south_wb_right_nb', points: turnArc([-9, 46.6], W, [-10.6, 45], N),
    speedLimit: TURN_SPEED, districtId: 'residential_south',
    roadId: 'residential_south_street', laneId: 'wb',
    junctionId: 'j_south_res', movement: 'right',
  }),
]

// District Authoring Kit: compiled sector roads join the same SegmentSpec
// architecture — Main Street East forks off the gateway avenue's existing
// nodes ((50,-96) out, (46,-96) rejoin) without touching existing ids.
export const ROUTED_SEGMENT_SPECS: readonly SegmentSpec[] = [
  ...SEGMENT_SPECS,
  ...COMPILED_SECTORS.flatMap((c) => c.segmentSpecs as SegmentSpec[]),
]

/** Weighted, lane-anchored destinations (never inside junctions/crossings). */
export const TRAFFIC_DESTINATIONS: TrafficDestination[] = [
  { id: 'dest_central_plaza_east', districtId: 'central', segmentId: 'ring_in_e_a', progress: 0.5, kind: 'commercial', weight: 2 },
  { id: 'dest_central_promenade', districtId: 'central', segmentId: 'ring_out_s_b', progress: 0.5, kind: 'commercial', weight: 2 },
  { id: 'dest_residential_homes', districtId: 'residential', segmentId: 'res_eb_a', progress: 0.3, kind: 'residential', weight: 2 },
  { id: 'dest_residential_return', districtId: 'residential', segmentId: 'res_wb_b', progress: 0.6, kind: 'residential', weight: 1 },
  { id: 'dest_westside_lane', districtId: 'residential_west', segmentId: 'rw_nb_b', progress: 0.5, kind: 'residential', weight: 2 },
  { id: 'dest_westside_south', districtId: 'residential_west', segmentId: 'rw_sb_a', progress: 0.4, kind: 'residential', weight: 1 },
  { id: 'dest_southside_row', districtId: 'residential_south', segmentId: 'rs_eb_b', progress: 0.5, kind: 'residential', weight: 2 },
  { id: 'dest_southside_return', districtId: 'residential_south', segmentId: 'rs_wb_a', progress: 0.5, kind: 'residential', weight: 1 },
  { id: 'dest_market_strip', districtId: 'industrial', segmentId: 'ind_sb_b', progress: 0.6, kind: 'commercial', weight: 2 },
  { id: 'dest_market_north', districtId: 'industrial', segmentId: 'ind_nb_b', progress: 0.5, kind: 'industrial', weight: 1 },
  { id: 'dest_freight_yard', districtId: 'industrial_north', segmentId: 'art_nb_a', progress: 0.5, kind: 'industrial', weight: 2 },
  { id: 'dest_freight_return', districtId: 'industrial_north', segmentId: 'art_sb_b', progress: 0.5, kind: 'industrial', weight: 1 },
  // Downtown Gateway (expansion sector s0_-1).
  { id: 'dest_gateway_plaza', districtId: 'downtown_gateway', segmentId: 'gate_nb', progress: 0.7, kind: 'commercial', weight: 2 },
  { id: 'dest_gateway_offices', districtId: 'downtown_gateway', segmentId: 'gate_sb', progress: 0.35, kind: 'commercial', weight: 1 },
  // Through-traffic exits: despawn anchors at the network's quiet ends.
  { id: 'exit_freight_north', districtId: 'industrial_north', segmentId: 'art_nb_b', progress: 0.5, kind: 'districtExit', weight: 1 },
  { id: 'exit_westside_north', districtId: 'residential_west', segmentId: 'rw_nb_b', progress: 0.85, kind: 'districtExit', weight: 1 },
  { id: 'exit_gateway_north', districtId: 'downtown_gateway', segmentId: 'gate_nb', progress: 0.9, kind: 'districtExit', weight: 1 },
  // Kit-compiled destinations (Main Street East).
  ...COMPILED_SECTORS.flatMap((c) => c.destinations as TrafficDestination[]),
]

/** Validated spawn anchors on long lane segments, clear of junctions. */
export const ROUTE_SPAWN_POINTS: RouteSpawnPoint[] = [
  { id: 'spawn_ring_north', segmentId: 'ring_in_n_a', progress: 0.3, districtId: 'central' },
  { id: 'spawn_ring_south', segmentId: 'ring_out_s_b', progress: 0.2, districtId: 'central' },
  { id: 'spawn_ring_east', segmentId: 'ring_out_e_b', progress: 0.45, districtId: 'central' },
  { id: 'spawn_res_street', segmentId: 'res_eb_b', progress: 0.3, districtId: 'residential' },
  { id: 'spawn_freight', segmentId: 'art_nb_a', progress: 0.15, districtId: 'industrial_north' },
  { id: 'spawn_market', segmentId: 'ind_sb_a', progress: 0.4, districtId: 'industrial' },
  { id: 'spawn_westside', segmentId: 'rw_nb_b', progress: 0.1, districtId: 'residential_west' },
  { id: 'spawn_southside', segmentId: 'rs_eb_b', progress: 0.3, districtId: 'residential_south' },
]
