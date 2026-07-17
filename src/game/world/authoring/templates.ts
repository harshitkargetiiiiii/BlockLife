import type {
  BuildingTemplate,
  CitizenZoneTemplate,
  LotTemplate,
  PropScatterTemplate,
  RoadTemplate,
} from './authoringTypes'

/**
 * District Authoring Kit v1 — template catalog.
 *
 * Deliberately small: enough vocabulary to author one good sector. Every
 * template resolves against existing runtime vocabulary (PropTypes,
 * BuildingDef fields, lane conventions), so compiled output needs no new
 * renderers or physics.
 */

export const ROAD_TEMPLATES: readonly RoadTemplate[] = [
  {
    id: 'avenue_two_way',
    kind: 'avenue',
    directionPolicy: 'twoWayPair',
    width: 8,
    sidewalkWidth: 3,
    laneOffset: 2,
    defaultSpeedLimit: 6,
    archetypes: ['downtown', 'commercial', 'industrial', 'waterfront'],
  },
  {
    id: 'local_lane_two_way',
    kind: 'localLane',
    directionPolicy: 'twoWayPair',
    width: 6,
    sidewalkWidth: 2,
    laneOffset: 1.4,
    defaultSpeedLimit: 4.2,
    archetypes: ['residential', 'suburban', 'park'],
  },
  {
    id: 'service_one_way',
    kind: 'localLane',
    directionPolicy: 'oneWay',
    width: 4,
    sidewalkWidth: 0,
    laneOffset: 0,
    defaultSpeedLimit: 3.5,
    archetypes: ['industrial', 'commercial'],
  },
]

export const BUILDING_TEMPLATES: readonly BuildingTemplate[] = [
  {
    id: 'small_shop',
    size: [6, 5, 6],
    color: '#e3b448',
    roofColor: '#a87f2c',
    accentColor: '#5f9ea0',
    labelPolicy: 'optional',
    archetypes: ['commercial', 'downtown', 'residential', 'suburban'],
  },
  {
    id: 'cafe_shopfront',
    size: [6, 5, 6],
    color: '#f2e3c6',
    roofColor: '#c4a276',
    accentColor: '#e07a5f',
    labelPolicy: 'optional',
    archetypes: ['commercial', 'downtown', 'waterfront'],
  },
  {
    id: 'office_tower',
    size: [8, 12, 8],
    color: '#7f93ad',
    roofColor: '#54637a',
    accentColor: '#9fc2ec',
    labelPolicy: 'optional',
    archetypes: ['downtown', 'commercial'],
  },
  {
    id: 'mixed_use_block',
    size: [9, 9, 8],
    color: '#a89bb3',
    roofColor: '#73687f',
    accentColor: '#d9a5b5',
    labelPolicy: 'optional',
    archetypes: ['downtown', 'commercial'],
  },
  {
    id: 'residential_house',
    size: [5, 4, 5],
    color: '#a2c4d0',
    roofColor: '#5f8391',
    accentColor: '#f2d5a0',
    labelPolicy: 'none',
    archetypes: ['residential', 'suburban'],
  },
  {
    id: 'townhouse',
    size: [7, 6, 7],
    color: '#c98a6a',
    roofColor: '#8a5a42',
    accentColor: '#f2b263',
    labelPolicy: 'optional',
    archetypes: ['residential', 'downtown'],
  },
  {
    id: 'warehouse',
    size: [10, 7, 9],
    color: '#8d939c',
    roofColor: '#5c6068',
    accentColor: '#e3b448',
    windows: false,
    labelPolicy: 'optional',
    archetypes: ['industrial'],
  },
  {
    id: 'depot',
    size: [8, 5.5, 7],
    color: '#6e7b8a',
    roofColor: '#48525e',
    accentColor: '#5faf7f',
    windows: false,
    labelPolicy: 'none',
    archetypes: ['industrial'],
  },
  {
    id: 'kiosk_pavilion',
    size: [4, 3.2, 4],
    color: '#efe6d4',
    roofColor: '#d1694f',
    accentColor: '#7fb6c9',
    windows: false,
    labelPolicy: 'optional',
    archetypes: ['waterfront', 'park', 'downtown'],
  },
]

export const LOT_TEMPLATES: readonly LotTemplate[] = [
  {
    id: 'storefront_lot',
    depth: 10,
    frontage: 9,
    setback: 2,
    allowedBuildings: ['small_shop', 'cafe_shopfront', 'townhouse'],
    archetypes: ['commercial', 'downtown', 'residential'],
  },
  {
    id: 'tower_lot',
    depth: 13,
    frontage: 12,
    setback: 3,
    allowedBuildings: ['office_tower', 'mixed_use_block'],
    archetypes: ['downtown', 'commercial'],
  },
  {
    id: 'house_lot',
    depth: 9,
    frontage: 8,
    setback: 2.5,
    allowedBuildings: ['residential_house'],
    archetypes: ['residential', 'suburban'],
  },
  {
    id: 'industrial_lot',
    depth: 14,
    frontage: 13,
    setback: 3,
    allowedBuildings: ['warehouse', 'depot'],
    archetypes: ['industrial'],
  },
]

export const PROP_SCATTER_TEMPLATES: readonly PropScatterTemplate[] = [
  {
    id: 'sidewalk_furniture',
    props: [
      { type: 'street_lamp', weight: 3 },
      { type: 'tree', weight: 3 },
      { type: 'bench', weight: 1 },
      { type: 'trash_can', weight: 1 },
    ],
    densityPer100: 1.6,
    minSpacing: 5,
  },
  {
    id: 'plaza_decor',
    props: [
      { type: 'street_planter', weight: 3 },
      { type: 'bench', weight: 2 },
      { type: 'tree', weight: 1 },
      { type: 'trash_can', weight: 1 },
    ],
    densityPer100: 2.4,
    minSpacing: 4,
  },
  {
    id: 'industrial_clutter',
    props: [
      { type: 'crate', weight: 3 },
      { type: 'pallet', weight: 2 },
      { type: 'barrel', weight: 2 },
      { type: 'cone', weight: 1 },
    ],
    densityPer100: 2,
    minSpacing: 3,
  },
  {
    id: 'waterfront_promenade',
    props: [
      { type: 'bench', weight: 3 },
      { type: 'street_lamp', weight: 2 },
      { type: 'street_planter', weight: 2 },
      { type: 'trash_can', weight: 1 },
    ],
    densityPer100: 2.2,
    minSpacing: 4,
  },
  {
    id: 'park_greenery',
    props: [
      { type: 'park_tree', weight: 4 },
      { type: 'bench', weight: 2 },
      { type: 'flower_pot', weight: 2 },
      { type: 'trash_can', weight: 1 },
    ],
    densityPer100: 2.2,
    minSpacing: 3.5,
  },
  {
    id: 'residential_greens',
    props: [
      { type: 'tree', weight: 3 },
      { type: 'flower_pot', weight: 2 },
      { type: 'street_lamp', weight: 2 },
      { type: 'trash_can', weight: 1 },
    ],
    densityPer100: 1.8,
    minSpacing: 4.5,
  },
  {
    id: 'driveway_parking',
    props: [{ type: 'parked_car', weight: 1 }],
    densityPer100: 2.6,
    minSpacing: 5,
  },
  {
    id: 'truck_row',
    props: [{ type: 'parked_truck', weight: 1 }],
    densityPer100: 1.6,
    minSpacing: 6.5,
  },
]

export const CITIZEN_ZONE_TEMPLATES: readonly CitizenZoneTemplate[] = [
  {
    id: 'sidewalk_walkers',
    archetype: 'Street Walker',
    behaviorType: 'loop_walk',
    walkSpeed: 1.2,
    activeHours: [8, 21],
    weatherBehavior: 'avoid_rain',
    count: 2,
  },
  {
    id: 'plaza_idlers',
    archetype: 'Plaza Idler',
    behaviorType: 'idle_stand',
    walkSpeed: 1,
    activeHours: [9, 20],
    weatherBehavior: 'shelter_in_rain',
    count: 1,
  },
  {
    id: 'freight_workers',
    archetype: 'Freight Worker',
    behaviorType: 'visit_spot',
    walkSpeed: 1.1,
    activeHours: [6, 18],
    weatherBehavior: 'work_rain_or_clear',
    count: 2,
  },
  {
    id: 'bench_sitters',
    archetype: 'Bench Sitter',
    behaviorType: 'sit',
    walkSpeed: 1,
    activeHours: [9, 20],
    weatherBehavior: 'avoid_rain',
    count: 2,
  },
  {
    id: 'shop_queue',
    archetype: 'Shop Customer',
    behaviorType: 'queue',
    walkSpeed: 1,
    activeHours: [8, 19],
    weatherBehavior: 'shelter_in_rain',
    count: 2,
  },
]

/**
 * Building-front detail policies: props emitted beside a building's DOOR
 * when a lot/freeLot sets `details: true`. Positions are door-relative —
 * `out` = distance from the wall face (must clear the prop's footprint +
 * the 0.5 validation margin), `along` = lateral offset from the door
 * center (never 0: the door stays clear). One policy per building
 * template; sectors get storefront life without bespoke prop lists.
 */
export const FRONT_DETAIL_POLICIES: Record<
  string,
  { type: string; out: number; along: number; rotation?: number }[]
> = {
  small_shop: [
    { type: 'signboard', out: 1.3, along: 2.1 },
    { type: 'flower_pot', out: 1.1, along: -2.1 },
  ],
  // Tables only: the door strip stays clear for shop queues.
  cafe_shopfront: [
    { type: 'table_set', out: 1.9, along: 2.9 },
    { type: 'table_set', out: 1.9, along: -2.9 },
  ],
  office_tower: [
    { type: 'street_planter', out: 1.5, along: 2.6 },
    { type: 'street_planter', out: 1.5, along: -2.6 },
  ],
  mixed_use_block: [
    { type: 'signboard', out: 1.3, along: 2.4 },
    { type: 'street_planter', out: 1.5, along: -2.6 },
  ],
  townhouse: [
    { type: 'flower_pot', out: 1.1, along: 1.9 },
    { type: 'flower_pot', out: 1.1, along: -1.9 },
  ],
  residential_house: [{ type: 'flower_pot', out: 1.1, along: 1.6 }],
  kiosk_pavilion: [
    { type: 'signboard', out: 1.3, along: 1.4 },
    { type: 'trash_can', out: 1.2, along: -1.5 },
  ],
  warehouse: [
    { type: 'crate', out: 1.6, along: 3.2 },
    { type: 'pallet', out: 1.2, along: -3.2 },
  ],
  depot: [{ type: 'barrel', out: 1.3, along: 2.6 }],
}

export function getRoadTemplate(id: string): RoadTemplate | undefined {
  return ROAD_TEMPLATES.find((t) => t.id === id)
}
export function getBuildingTemplate(id: string): BuildingTemplate | undefined {
  return BUILDING_TEMPLATES.find((t) => t.id === id)
}
export function getLotTemplate(id: string): LotTemplate | undefined {
  return LOT_TEMPLATES.find((t) => t.id === id)
}
export function getPropScatterTemplate(id: string): PropScatterTemplate | undefined {
  return PROP_SCATTER_TEMPLATES.find((t) => t.id === id)
}
export function getCitizenZoneTemplate(id: string): CitizenZoneTemplate | undefined {
  return CITIZEN_ZONE_TEMPLATES.find((t) => t.id === id)
}
