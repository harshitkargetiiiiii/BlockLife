import type { Vec2 } from '../world/worldTypes'
import type { DistrictId } from '../world/cityLayout'
import { BUILDINGS, getDistrict, getRoadRects } from '../world/cityLayout'
import { COMPILED_SECTORS } from '../world/authoring/compiledSectors'

/**
 * Background citizens: cheap, data-driven street life. They are not NPCs —
 * no dialogue, no quests, no contacts entry, no save state. They stand, sit,
 * queue, stroll small loops, and occasionally mutter a bubble line. Walkers
 * reuse the full pedestrian traffic etiquette (curbs, signals, stop signs).
 */
export type CitizenBehavior =
  | 'idle_stand'
  | 'sit'
  | 'loop_walk'
  | 'visit_spot'
  | 'queue'
  /** Crossing-aware destination trips over the pedestrian graph. */
  | 'destination_trips'

/**
 * How a citizen reacts to rain:
 * - 'any' (default): unbothered, carries on.
 * - 'avoid_rain': goes indoors — hidden while it rains.
 * - 'shelter_in_rain': walkers detour to the nearest covered shelter point.
 * - 'work_rain_or_clear': on the clock, keeps working in any weather.
 */
export type CitizenWeatherBehavior = 'any' | 'avoid_rain' | 'shelter_in_rain' | 'work_rain_or_clear'

export interface AmbientCitizen {
  id: string
  district: DistrictId
  archetype: string
  behaviorType: CitizenBehavior
  position: Vec2
  /** Facing direction while idle/sitting/queueing (radians). */
  heading?: number
  /** loop_walk: looped route; visit_spot: points visited with dwell pauses. */
  waypoints?: Vec2[]
  walkSpeed?: number
  bodyColor: string
  headColor: string
  bubbleLines?: string[]
  /** Only out and about between these hours (wraps midnight if from > to). */
  activeHours?: [number, number]
  /** Carries a little parcel (delivery helper flavor). */
  carriesBox?: boolean
  weatherBehavior?: CitizenWeatherBehavior
  /** destination_trips: pedestrian-graph node the home anchor attaches to. */
  homeAttachNodeId?: string
}

/** The 13 hand-crafted originals (City Life Density v1). */
const CORE_CITIZENS: AmbientCitizen[] = [
  // ---- Central Block (4) ----
  {
    id: 'cit_truck_customer',
    weatherBehavior: 'avoid_rain',
    district: 'central',
    archetype: 'Food Truck Customer',
    behaviorType: 'queue',
    position: [0.2, -2.8],
    heading: -0.5,
    bodyColor: '#c98a5e',
    headColor: '#e8b98a',
    bubbleLines: ['one coffee, please!', 'smells amazing…'],
    activeHours: [7, 21],
  },
  {
    id: 'cit_bench_reader',
    weatherBehavior: 'avoid_rain',
    district: 'central',
    archetype: 'Bench Reader',
    behaviorType: 'sit',
    position: [5, -3],
    heading: -Math.PI / 2,
    bodyColor: '#7a9cc6',
    headColor: '#c98a5e',
    bubbleLines: ['just one more chapter.'],
    activeHours: [8, 20],
  },
  {
    id: 'cit_office_worker',
    weatherBehavior: 'avoid_rain',
    district: 'central',
    archetype: 'Office Worker',
    behaviorType: 'idle_stand',
    position: [12.2, -2.2],
    heading: Math.PI,
    bodyColor: '#5a6478',
    headColor: '#e8b98a',
    bubbleLines: ['so many emails…', 'is it friday yet?'],
    activeHours: [8, 19],
  },
  {
    id: 'cit_park_walker',
    weatherBehavior: 'shelter_in_rain',
    district: 'central',
    archetype: 'Park Walker',
    behaviorType: 'visit_spot',
    // Skirts the pond path — water is solid now; nobody walks on it.
    position: [-9.2, 8.6],
    waypoints: [
      [-9.2, 8.6],
      [-11.5, 18.6],
      [-7.9, 13.8],
    ],
    walkSpeed: 1.2,
    bodyColor: '#a3b18a',
    headColor: '#8a5a3c',
    bubbleLines: ['what a nice pond.'],
  },

  // ---- Residential Street (4) ----
  {
    id: 'cit_jogger',
    weatherBehavior: 'avoid_rain',
    district: 'residential',
    archetype: 'Jogger',
    behaviorType: 'loop_walk',
    position: [-18, -49.3],
    waypoints: [
      [-18, -49.3],
      [-2, -49.2],
      [-2, -40.8],
      [6, -40.5],
      [-2, -40.8],
      [-2, -49.2],
    ],
    walkSpeed: 3.4,
    bodyColor: '#e07a5f',
    headColor: '#e8b98a',
    bubbleLines: ['almost at my goal!', 'phew.'],
    activeHours: [6, 12],
  },
  {
    id: 'cit_neighbor',
    weatherBehavior: 'avoid_rain',
    district: 'residential',
    archetype: 'Residential Neighbor',
    behaviorType: 'idle_stand',
    position: [-6, -51.2],
    heading: 0,
    bodyColor: '#c9a2c4',
    headColor: '#8a5a3c',
    bubbleLines: ['lovely morning!', 'the roses are coming in.'],
  },
  {
    id: 'cit_phone_scroller',
    weatherBehavior: 'any',
    district: 'residential',
    archetype: 'Phone Scroller',
    behaviorType: 'idle_stand',
    position: [16, -50.2],
    heading: 0.4,
    bodyColor: '#4a7fd4',
    headColor: '#c98a5e',
    bubbleLines: ['ha! cat video.', 'no signal again?'],
  },
  {
    id: 'cit_resident_sitter',
    weatherBehavior: 'avoid_rain',
    district: 'residential',
    archetype: 'Bench Sitter',
    behaviorType: 'sit',
    position: [0.2, -39.9],
    heading: Math.PI,
    bodyColor: '#9a5fc0',
    headColor: '#e8b98a',
    bubbleLines: ['quiet street today.'],
    activeHours: [9, 22],
  },

  // ---- Industrial / Market Strip (4) ----
  {
    id: 'cit_warehouse_worker',
    weatherBehavior: 'work_rain_or_clear',
    district: 'industrial',
    archetype: 'Warehouse Worker',
    behaviorType: 'visit_spot',
    position: [53.2, -3],
    // Shuttles between the loading zone and the staging pallet — routed
    // AROUND the parked truck, not through it.
    waypoints: [
      [53.2, -3],
      [53.2, -4.6],
      [54.3, -3.4],
    ],
    walkSpeed: 1.6,
    bodyColor: '#d4763a',
    headColor: '#8a5a3c',
    bubbleLines: ['heavy one…', 'last pallet, promise.'],
    carriesBox: true,
  },
  {
    id: 'cit_market_shopper',
    weatherBehavior: 'shelter_in_rain',
    district: 'industrial',
    archetype: 'Market Shopper',
    behaviorType: 'visit_spot',
    position: [42.7, 14.6],
    waypoints: [
      [42.7, 14.6],
      [42.7, 20.8],
    ],
    walkSpeed: 1.1,
    bodyColor: '#e0576f',
    headColor: '#e8b98a',
    bubbleLines: ['fresh! all of it!', 'how much for two?'],
    activeHours: [8, 20],
  },
  {
    id: 'cit_garage_worker',
    weatherBehavior: 'work_rain_or_clear',
    district: 'industrial',
    archetype: 'Garage Worker',
    behaviorType: 'idle_stand',
    position: [54.9, 8],
    heading: Math.PI / 2,
    bodyColor: '#48525e',
    headColor: '#c98a5e',
    bubbleLines: ['needs a new alternator.', 'she’ll run again.'],
  },
  {
    id: 'cit_crosswalk_waiter',
    weatherBehavior: 'any',
    district: 'industrial',
    archetype: 'Crosswalk Waiter',
    behaviorType: 'idle_stand',
    position: [53.6, 13.6],
    heading: -Math.PI / 2,
    bodyColor: '#6cc24a',
    headColor: '#e8b98a',
    bubbleLines: ['any minute now…'],
  },

  // ---- Roamer (1) ----
  {
    id: 'cit_plaza_roamer',
    weatherBehavior: 'shelter_in_rain',
    district: 'central',
    archetype: 'Plaza Stroller',
    behaviorType: 'loop_walk',
    // Plaza promenade: the old outer rectangle clipped through the shop
    // backs and the office corner — this line stays in the open.
    position: [-3.4, -11],
    waypoints: [
      [-3.4, -11],
      [-3.4, 12],
    ],
    walkSpeed: 1.4,
    bodyColor: '#8fb8a8',
    headColor: '#8a5a3c',
    bubbleLines: ['nice block.', 'good day for a walk.'],
  },
]

/* ---- City Expansion v2: 37 more citizens → 50 peds living daily life ---- */

const BODY_COLORS = [
  '#c98a5e', '#7a9cc6', '#5a6478', '#a3b18a', '#e07a5f', '#c9a2c4', '#4a7fd4',
  '#9a5fc0', '#d4763a', '#e0576f', '#48525e', '#6cc24a', '#8fb8a8', '#b8a06a',
  '#d1495b', '#5f9ea0', '#e3b448', '#96687a', '#6f7d58', '#8a9bb0',
]
const HEAD_COLORS = ['#e8b98a', '#c98a5e', '#8a5a3c', '#ffd7b0', '#a5705c']

interface CitizenSeed {
  id: string
  district: DistrictId
  archetype: string
  behaviorType: CitizenBehavior
  position: Vec2
  waypoints?: Vec2[]
  heading?: number
  walkSpeed?: number
  activeHours?: [number, number]
  weatherBehavior?: CitizenWeatherBehavior
  carriesBox?: boolean
  bubbleLines?: string[]
  homeAttachNodeId?: string
}

/** Compact builder: colors are assigned deterministically from the id. */
function citizen(seed: CitizenSeed, index: number): AmbientCitizen {
  return {
    bodyColor: BODY_COLORS[index % BODY_COLORS.length],
    headColor: HEAD_COLORS[index % HEAD_COLORS.length],
    ...seed,
  }
}

const EXPANSION_CITIZENS: AmbientCitizen[] = (
  [
    // ---- Central (commercial core) ----
    { id: 'cit_c_lunch_walker', district: 'central', archetype: 'Lunch Walker', behaviorType: 'visit_spot', position: [13.6, -6.2], waypoints: [[13.6, -6.2], [7.6, -5.2]], walkSpeed: 1.3, activeHours: [11, 15], weatherBehavior: 'avoid_rain', bubbleLines: ['lunch run!'] },
    { id: 'cit_c_window_shopper', district: 'central', archetype: 'Window Shopper', behaviorType: 'visit_spot', position: [-5, -13.2], waypoints: [[-5, -13.2], [3.5, -13.2]], walkSpeed: 1.0, activeHours: [9, 20], weatherBehavior: 'shelter_in_rain' },
    { id: 'cit_c_second_customer', district: 'central', archetype: 'Truck Regular', behaviorType: 'queue', position: [0.9, -2.2], heading: -0.6, activeHours: [8, 20], weatherBehavior: 'avoid_rain', bubbleLines: ['the usual, please.'] },
    { id: 'cit_c_pond_gazer', district: 'central', archetype: 'Pond Gazer', behaviorType: 'idle_stand', position: [-15.5, 11.5], heading: Math.PI, weatherBehavior: 'avoid_rain' },
    { id: 'cit_c_bench_napper', district: 'central', archetype: 'Bench Napper', behaviorType: 'sit', position: [-11.8, 5.6], heading: Math.PI, activeHours: [10, 18], weatherBehavior: 'avoid_rain' },
    { id: 'cit_c_ring_walker', district: 'central', archetype: 'Ring Walker', behaviorType: 'loop_walk', position: [30.5, -15], waypoints: [[30.5, -15], [30.5, 15]], walkSpeed: 1.5, weatherBehavior: 'shelter_in_rain' },
    { id: 'cit_c_busker', district: 'central', archetype: 'Busker', behaviorType: 'idle_stand', position: [-6.2, 7.4], heading: 0.8, activeHours: [10, 22], weatherBehavior: 'avoid_rain', bubbleLines: ['♪ ♫'] },

    // ---- Residential (north street) ----
    { id: 'cit_r_gardener', district: 'residential', archetype: 'Gardener', behaviorType: 'idle_stand', position: [-17.5, -52], heading: 0, activeHours: [7, 18], weatherBehavior: 'avoid_rain', bubbleLines: ['these hedges…'] },
    { id: 'cit_r_mail_round', district: 'residential', archetype: 'Mail Carrier', behaviorType: 'visit_spot', position: [-4.2, -49], waypoints: [[-4.2, -49], [4.4, -49.2]], walkSpeed: 1.4, activeHours: [8, 14], weatherBehavior: 'work_rain_or_clear', carriesBox: true },
    { id: 'cit_r_south_stroller', district: 'residential', archetype: 'Street Stroller', behaviorType: 'loop_walk', position: [-18, -49.4], waypoints: [[-18, -49.4], [8, -49.4]], walkSpeed: 1.2, weatherBehavior: 'shelter_in_rain' },
    { id: 'cit_r_porch_watcher', district: 'residential', archetype: 'Porch Watcher', behaviorType: 'idle_stand', position: [20, -49.9], heading: 0, weatherBehavior: 'any' },
    { id: 'cit_r_kid', district: 'residential', archetype: 'Kid', behaviorType: 'visit_spot', position: [14, -51.5], waypoints: [[14, -51.5], [15.8, -49.6]], walkSpeed: 1.8, activeHours: [8, 19], weatherBehavior: 'avoid_rain', bubbleLines: ['tag, you’re it!'] },

    // ---- Industrial (market strip) ----
    { id: 'cit_i_apron_hauler', district: 'industrial', archetype: 'Dock Hauler', behaviorType: 'visit_spot', position: [53.5, 18], waypoints: [[53.5, 18], [53.5, 23]], walkSpeed: 1.5, weatherBehavior: 'work_rain_or_clear', carriesBox: true },
    { id: 'cit_i_dock_boss', district: 'industrial', archetype: 'Dock Boss', behaviorType: 'idle_stand', position: [54.5, -2], heading: -Math.PI / 2, weatherBehavior: 'work_rain_or_clear', bubbleLines: ['keep it moving.'] },
    { id: 'cit_i_market_queue', district: 'industrial', archetype: 'Market Regular', behaviorType: 'queue', position: [42.6, 14.8], heading: -Math.PI / 2, activeHours: [8, 20], weatherBehavior: 'avoid_rain' },
    { id: 'cit_i_yard_walker', district: 'industrial', archetype: 'Yard Inspector', behaviorType: 'visit_spot', position: [57.5, -11], waypoints: [[57.5, -11], [57.5, -16]], walkSpeed: 1.2, weatherBehavior: 'work_rain_or_clear' },

    // ---- Residential West ----
    // Shared line with cit_w_jogger (both walked x=-52.2 in OPPOSITE directions →
    // head-on lockstep at overlapping hours; CONVENTIONS #17). De-conflicted onto
    // parallel lanes 0.9 apart, BOTH east of prop_tree_w1 (at x=-53) so neither
    // clips the trunk — this one keeps the proven-clear original line.
    { id: 'cit_w_lane_walker', district: 'residential_west', archetype: 'Lane Walker', behaviorType: 'loop_walk', position: [-52.2, -16], waypoints: [[-52.2, -16], [-52.2, 16]], walkSpeed: 1.3, weatherBehavior: 'shelter_in_rain' },
    { id: 'cit_w_east_stroller', district: 'residential_west', archetype: 'Evening Stroller', behaviorType: 'loop_walk', position: [-43.8, -16], waypoints: [[-43.8, -16], [-43.8, 0], [-43.8, 12]], walkSpeed: 1.1, activeHours: [15, 23], weatherBehavior: 'avoid_rain' },
    { id: 'cit_w_porch_neighbor', district: 'residential_west', archetype: 'Neighbor', behaviorType: 'idle_stand', position: [-53.8, -5], heading: Math.PI / 2, weatherBehavior: 'avoid_rain', bubbleLines: ['quiet out west.'] },
    { id: 'cit_w_fence_leaner', district: 'residential_west', archetype: 'Fence Leaner', behaviorType: 'idle_stand', position: [-43.6, 17.5], heading: -Math.PI / 2, weatherBehavior: 'any' },
    { id: 'cit_w_visitor', district: 'residential_west', archetype: 'Commons Visitor', behaviorType: 'visit_spot', position: [-43.7, -4.4], waypoints: [[-43.7, -4.4], [-43.7, -8.6]], walkSpeed: 1.2, activeHours: [9, 21], weatherBehavior: 'shelter_in_rain' },
    { id: 'cit_w_bench_sitter', district: 'residential_west', archetype: 'Bench Sitter', behaviorType: 'sit', position: [-42.6, -8.6], heading: -Math.PI / 2, activeHours: [9, 20], weatherBehavior: 'avoid_rain' },
    { id: 'cit_w_path_kid', district: 'residential_west', archetype: 'Path Kid', behaviorType: 'visit_spot', position: [-53.6, 9.5], waypoints: [[-53.6, 9.5], [-53.6, -1]], walkSpeed: 1.9, activeHours: [8, 19], weatherBehavior: 'avoid_rain', bubbleLines: ['race you!'] },
    { id: 'cit_w_jogger', district: 'residential_west', archetype: 'West Jogger', behaviorType: 'loop_walk', position: [-51.3, 18], waypoints: [[-51.3, 18], [-51.3, -18]], walkSpeed: 3.2, activeHours: [6, 11], weatherBehavior: 'avoid_rain', bubbleLines: ['pace, pace…'] },

    // ---- Residential South ----
    { id: 'cit_s_promenader', district: 'residential_south', archetype: 'Promenader', behaviorType: 'loop_walk', position: [-16, 52.2], waypoints: [[-16, 52.2], [16, 52.2]], walkSpeed: 1.2, weatherBehavior: 'shelter_in_rain' },
    { id: 'cit_s_north_walker', district: 'residential_south', archetype: 'Morning Walker', behaviorType: 'loop_walk', position: [-6, 44.3], waypoints: [[-6, 44.3], [18, 44.3]], walkSpeed: 1.4, activeHours: [6, 13], weatherBehavior: 'avoid_rain' },
    { id: 'cit_s_deli_owner', district: 'residential_south', archetype: 'Deli Owner', behaviorType: 'idle_stand', position: [6, 51.9], heading: 0, activeHours: [7, 21], weatherBehavior: 'work_rain_or_clear', bubbleLines: ['fresh sandwiches!'] },
    { id: 'cit_s_deli_queue', district: 'residential_south', archetype: 'Deli Regular', behaviorType: 'queue', position: [4.6, 52.1], heading: 0, activeHours: [8, 20], weatherBehavior: 'avoid_rain', bubbleLines: ['the pastrami one.'] },
    { id: 'cit_s_lawn_reader', district: 'residential_south', archetype: 'Lawn Reader', behaviorType: 'idle_stand', position: [12, 53.8], heading: 0, activeHours: [9, 19], weatherBehavior: 'avoid_rain' },
    { id: 'cit_s_stroll_pair', district: 'residential_south', archetype: 'Slow Stroller', behaviorType: 'visit_spot', position: [1.8, 52.2], waypoints: [[1.8, 52.2], [-13, 52.2]], walkSpeed: 0.9, weatherBehavior: 'shelter_in_rain' },
    { id: 'cit_s_corner_idler', district: 'residential_south', archetype: 'Corner Idler', behaviorType: 'idle_stand', position: [-16.8, 44.4], heading: Math.PI / 2, weatherBehavior: 'any' },
    { id: 'cit_s_backyard_kid', district: 'residential_south', archetype: 'Backyard Kid', behaviorType: 'visit_spot', position: [-1.8, 53.9], waypoints: [[-1.8, 53.9], [1.8, 53.9]], walkSpeed: 1.8, activeHours: [8, 19], weatherBehavior: 'avoid_rain', bubbleLines: ['catch!'] },

    // ---- Industrial North (freight) ----
    { id: 'cit_n_loader_1', district: 'industrial_north', archetype: 'Freight Loader', behaviorType: 'visit_spot', position: [53.8, -26], waypoints: [[53.8, -26], [53.8, -31.6]], walkSpeed: 1.5, weatherBehavior: 'work_rain_or_clear', carriesBox: true, bubbleLines: ['last pallet…'] },
    { id: 'cit_n_loader_2', district: 'industrial_north', archetype: 'Freight Loader', behaviorType: 'visit_spot', position: [53.2, -38.5], waypoints: [[53.2, -38.5], [53.2, -46.5]], walkSpeed: 1.4, weatherBehavior: 'work_rain_or_clear', carriesBox: true },
    { id: 'cit_n_forklift_op', district: 'industrial_north', archetype: 'Forklift Op', behaviorType: 'idle_stand', position: [43.4, -26], heading: Math.PI / 2, weatherBehavior: 'work_rain_or_clear', bubbleLines: ['where’s my manifest?'] },
    { id: 'cit_n_break_smoker', district: 'industrial_north', archetype: 'On Break', behaviorType: 'idle_stand', position: [43.4, -36.5], heading: Math.PI / 2, activeHours: [10, 22], weatherBehavior: 'any' },
    { id: 'cit_n_supervisor', district: 'industrial_north', archetype: 'Supervisor', behaviorType: 'visit_spot', position: [43.4, -24.5], waypoints: [[43.4, -24.5], [43.4, -33]], walkSpeed: 1.1, weatherBehavior: 'work_rain_or_clear' },

    // ---- Downtown Gateway (polish pass: the plaza gets people) ----
    { id: 'cit_g_plaza_stroller', district: 'downtown_gateway', archetype: 'Plaza Stroller', behaviorType: 'destination_trips', position: [55, -87.3], homeAttachNodeId: 'pdest_gateway_plaza', walkSpeed: 1.2, weatherBehavior: 'any', bubbleLines: ['the city really grew, huh.'] },
    { id: 'cit_g_bench_reader', district: 'downtown_gateway', archetype: 'Bench Reader', behaviorType: 'sit', position: [60.5, -91.2], heading: 0, activeHours: [9, 19], weatherBehavior: 'avoid_rain', bubbleLines: ['one more chapter.'] },
  ] as CitizenSeed[]
).map(citizen)

/**
 * Live pedestrian traffic at Harbor Cross (48,-160): six walkers whose
 * routes thread the intersection's four signalized crossings. Corners sit
 * on the curb (asphalt is x 44..52 / z -164..-156; crossing bands hug the
 * box) so nobody idles, spawns, or turns around on the roadway. The two
 * rectangle loops walk ALL FOUR crossings; the four shuttles queue one arm
 * each, so several curbs release together at every all-walk phase.
 */
const HARBOR_CROSS_CITIZENS: AmbientCitizen[] = (
  [
    { id: 'cit_hc_loop_cw', district: 'downtown_gateway', archetype: 'Harbor Commuter', behaviorType: 'loop_walk', position: [41, -152.9], waypoints: [[41, -152.9], [55, -152.9], [55, -167.1], [41, -167.1]], walkSpeed: 1.4, weatherBehavior: 'any', bubbleLines: ['light’s about to change.'] },
    // Concentric INNER lane (shrunk 0.9 off every edge of cit_hc_loop_cw's loop):
    // the two commuters circle the same plaza in opposite directions but on lanes
    // ≥0.9 apart (> PERSON_SEP_RADIUS 0.72), so they never meet head-on at a shared
    // corner — the opposite-direction lockstep the 300s soak caught (CONVENTIONS #17).
    { id: 'cit_hc_loop_ccw', district: 'downtown_gateway', archetype: 'Harbor Commuter', behaviorType: 'loop_walk', position: [54.1, -166.2], waypoints: [[54.1, -166.2], [54.1, -153.8], [41.9, -153.8], [41.9, -166.2]], walkSpeed: 1.3, weatherBehavior: 'any' },
    { id: 'cit_hc_south_shuttle', district: 'downtown_gateway', archetype: 'Dock Worker', behaviorType: 'visit_spot', position: [41, -154.6], waypoints: [[41, -154.6], [55, -154.6]], walkSpeed: 1.4, weatherBehavior: 'any', carriesBox: true },
    { id: 'cit_hc_east_shuttle', district: 'downtown_gateway', archetype: 'Pier Regular', behaviorType: 'visit_spot', position: [55, -152.9], waypoints: [[55, -152.9], [55, -167.1]], walkSpeed: 1.3, weatherBehavior: 'any', bubbleLines: ['harbor air.'] },
    { id: 'cit_hc_west_shuttle', district: 'downtown_gateway', archetype: 'Evening Walker', behaviorType: 'visit_spot', position: [41, -167.1], waypoints: [[41, -167.1], [41, -152.9]], walkSpeed: 1.2, weatherBehavior: 'any' },
    { id: 'cit_hc_north_shuttle', district: 'downtown_gateway', archetype: 'Boulevard Walker', behaviorType: 'visit_spot', position: [55, -165.4], waypoints: [[55, -165.4], [41, -165.4]], walkSpeed: 1.4, weatherBehavior: 'any' },
  ] as CitizenSeed[]
).map(citizen)

/**
 * Destination-driven citizens (Crossing-Aware Destinations v1): each one
 * lives on the pedestrian graph, picks seeded destinations, and crosses
 * roads only through registered crossings. Homes sit on curb-adjacent
 * sidewalk/grass; the attach node joins the home to the graph.
 */
const DESTINATION_CITIZENS: AmbientCitizen[] = (
  [
    { id: 'cit_dd_shopper_west', district: 'downtown_gateway', archetype: 'West Side Shopper', behaviorType: 'destination_trips', position: [6, -152], homeAttachNodeId: 'pn_harbor_w_walk', walkSpeed: 1.4, weatherBehavior: 'any', carriesBox: true, bubbleLines: ['errand day.'] },
    { id: 'cit_dd_waterfront_gazer', district: 'downtown_gateway', archetype: 'Waterfront Gazer', behaviorType: 'destination_trips', position: [64, -92], homeAttachNodeId: 'pdest_gateway_plaza', walkSpeed: 1.2, weatherBehavior: 'any', bubbleLines: ['sea air today?'] },
    { id: 'cit_dd_yard_worker', district: 'downtown_gateway', archetype: 'Yard Worker', behaviorType: 'destination_trips', position: [55, -124], homeAttachNodeId: 'pn_blvd_e_gate', walkSpeed: 1.8, weatherBehavior: 'any', carriesBox: true, bubbleLines: ['shift starts soon.'] },
    { id: 'cit_dd_cafe_regular', district: 'waterfront_north', archetype: 'Cafe Regular', behaviorType: 'destination_trips', position: [54, -226], homeAttachNodeId: 'pn_blvd_e_terminus', walkSpeed: 1.3, weatherBehavior: 'any' },
    { id: 'cit_dd_mart_regular', district: 'downtown_north', archetype: 'Mart Regular', behaviorType: 'destination_trips', position: [76, -294], homeAttachNodeId: 'pn_ave_s_mid', walkSpeed: 1.3, weatherBehavior: 'any' },
    { id: 'cit_dd_bench_reader', district: 'downtown_gateway', archetype: 'Bench Reader', behaviorType: 'destination_trips', position: [14, -152], homeAttachNodeId: 'pn_harbor_w_walk', walkSpeed: 1.1, weatherBehavior: 'any', bubbleLines: ['somewhere to sit…'] },
  ] as CitizenSeed[]
).map(citizen)

/** All citizens: hand-crafted core + v2 expansion crowd + Harbor Cross. */
export const AMBIENT_CITIZENS: AmbientCitizen[] = [
  ...CORE_CITIZENS,
  ...EXPANSION_CITIZENS,
  ...HARBOR_CROSS_CITIZENS,
  ...DESTINATION_CITIZENS,
  // District Authoring Kit: compiled citizen zones (Main Street East).
  ...COMPILED_SECTORS.flatMap((c) => c.citizens as unknown as AmbientCitizen[]),
]

// Road + building footprints come straight from the layout data, so spawn
// rules can never drift from the rendered geometry.
const ROAD_RECTS = getRoadRects()

function isOnRoad(x: number, z: number): boolean {
  return ROAD_RECTS.some((r) => x >= r.minX && x <= r.maxX && z >= r.minZ && z <= r.maxZ)
}

function isInsideBuilding(x: number, z: number): boolean {
  return BUILDINGS.some(
    (b) =>
      x > b.position[0] - b.size[0] / 2 &&
      x < b.position[0] + b.size[0] / 2 &&
      z > b.position[1] - b.size[2] / 2 &&
      z < b.position[1] + b.size[2] / 2,
  )
}

/** Problems with the citizen data (empty = valid). Used by tests. */
export function validateAmbientCitizens(citizens: AmbientCitizen[]): string[] {
  const errors: string[] = []
  const seen = new Set<string>()
  for (const c of citizens) {
    const where = `citizen "${c.id}"`
    if (seen.has(c.id)) errors.push(`${where}: duplicate id`)
    seen.add(c.id)
    if (getDistrict(c.position[0], c.position[1]) !== c.district) {
      errors.push(`${where}: spawn is not inside its declared district`)
    }
    if (isOnRoad(c.position[0], c.position[1])) {
      errors.push(`${where}: spawns on a road`)
    }
    if (isInsideBuilding(c.position[0], c.position[1])) {
      errors.push(`${where}: spawns inside a building`)
    }
    if ((c.behaviorType === 'loop_walk' || c.behaviorType === 'visit_spot') && !c.waypoints) {
      errors.push(`${where}: walking behavior needs waypoints`)
    }
    if (c.behaviorType === 'destination_trips' && !c.homeAttachNodeId) {
      errors.push(`${where}: destination_trips needs a homeAttachNodeId`)
    }
    for (const wp of c.waypoints ?? []) {
      if (isInsideBuilding(wp[0], wp[1])) {
        errors.push(`${where}: waypoint ${wp[0]},${wp[1]} is inside a building`)
      }
    }
    if (c.activeHours && (c.activeHours[0] < 0 || c.activeHours[1] > 24)) {
      errors.push(`${where}: activeHours out of range`)
    }
  }
  return errors
}

/** True when this citizen stays outside in the rain (false = went indoors). */
export function isCitizenOutInRain(citizen: AmbientCitizen): boolean {
  return (citizen.weatherBehavior ?? 'any') !== 'avoid_rain'
}

/** True when the citizen is out and about at this hour. */
export function isCitizenActive(citizen: AmbientCitizen, hour: number): boolean {
  if (!citizen.activeHours) return true
  const [from, to] = citizen.activeHours
  if (from <= to) return hour >= from && hour < to
  return hour >= from || hour < to
}
