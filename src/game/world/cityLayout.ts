import type { AmbientCarDef, BuildingDef, PropDef, Vec2 } from './worldTypes'
import { COMPILED_SECTORS } from './authoring/compiledSectors'

/**
 * One dense city block.
 *
 * Coordinate system: y is up. The ring road centerline sits at ±26 with a
 * half-width of 3 (asphalt covers 23..29). The inner sidewalk ring covers
 * 21..23 and the outer ring 29..31. Everything inside |x|,|z| < 21 is the
 * plaza with buildings, the park corner (south-west) and the parking lot
 * (south-east).
 */

export const ROAD_CENTER = 26
export const ROAD_HALF_WIDTH = 3
export const SIDEWALK_INNER = 22 // centerline of inner sidewalk ring
export const SIDEWALK_OUTER = 30

/**
 * City Expansion v2: six blocks on one aligned street grid.
 * - Central Block (commercial): the original ring (unchanged coordinates).
 * - Residential Street: north, east-west street at z = -45 (connector x = 12).
 *   Extended east to x = 44, where it T-junctions into the industrial road.
 * - Residential West: north-south street at x = -48 (connector z = 6, west).
 * - Residential South: east-west street at z = 48 (connector x = -12, south).
 * - Industrial / Market Strip: east, north-south road at x = 48 (connector z = 6).
 * - Industrial North: the same x = 48 road continued north to z = -52 —
 *   warehouses and freight along the extension, like a real arterial.
 */
export const CITY_BOUNDS = { minX: -70, maxX: 66, minZ: -60, maxZ: 62 }

/** @deprecated kept for the central ring's local math; use CITY_BOUNDS for world extents. */
export const WORLD_BOUND = 34

export type DistrictId =
  | 'central'
  | 'residential'
  | 'residential_west'
  | 'residential_south'
  | 'industrial'
  | 'industrial_north'
  | 'downtown_gateway'
  | 'waterfront_north'
  | 'downtown_north'
  | 'residential_east'
  | 'industrial_west'

/** Coarse district classification for debug/tests/phone map. */
export function getDistrict(x: number, z: number): DistrictId {
  // Expansion pack districts (north of the gateway, east of Main Street).
  if (z < -216) {
    if (x < -72) return 'industrial_west'
    if (x > 72) return 'downtown_north'
    return 'waterfront_north'
  }
  if (x > 216 && z < -60) return 'residential_east'
  if (z < -60) return 'downtown_gateway'
  if (x > 36 && z < -20) return 'industrial_north'
  if (x < -36) return 'residential_west'
  if (z > 36) return 'residential_south'
  if (z < -36) return 'residential'
  if (x > 36) return 'industrial'
  return 'central'
}

/**
 * Downtown Gateway (Large City Foundation v1 expansion sector, cell s0_-1):
 * the freight arterial continues north past the old city edge into a small
 * downtown block — a two-lane avenue, a paved plaza and five tall
 * mixed-use buildings. Authoring contract proof: pure data + one sector
 * component pair + SegmentSpec road extension.
 */
export const GATEWAY = {
  /** Avenue asphalt (extends past the Main Street junction at z = -96/-100). */
  road: { minX: 44, maxX: 52, minZ: -102, maxZ: -48 },
  /** Paved plaza pad east of the avenue. */
  plaza: { minX: 54, maxX: 70, minZ: -92, maxZ: -76 },
  /** Playable perimeter (walls trace this, gap at the corridor mouth). */
  area: { minX: 26, maxX: 72, minZ: -118, maxZ: -60 },
  /** City-wall corridor gap (must match CityColliders' north wall split). */
  corridorMinX: 40,
  corridorMaxX: 56,
}

/** Residential street geometry (asphalt z from -48 to -42, ends into the industrial road). */
export const RESIDENTIAL = {
  roadCenterZ: -45,
  roadHalfWidth: 3,
  roadMinX: -20,
  roadMaxX: 44,
  /**
   * Where the housing lots end. The ROAD continues east to the freight
   * junction, but lawns and the garden fence stop with the houses — a fence
   * doesn't run onto an industrial corner in a real neighborhood.
   */
  lotMaxX: 30,
  crosswalkX: -2,
}

/** Residential West geometry (asphalt x from -51 to -45). */
export const RESIDENTIAL_WEST = {
  roadCenterX: -48,
  roadHalfWidth: 3,
  roadMinZ: -20,
  roadMaxZ: 20,
  crosswalkZ: -8,
}

/** Residential South geometry (asphalt z from 45 to 51). */
export const RESIDENTIAL_SOUTH = {
  roadCenterZ: 48,
  roadHalfWidth: 3,
  roadMinX: -20,
  roadMaxX: 20,
  crosswalkX: 6,
}

/** Industrial strip geometry (asphalt x from 44 to 52 — wider for trucks). */
export const INDUSTRIAL = {
  roadCenterX: 48,
  roadHalfWidth: 4,
  roadMinZ: -16,
  roadMaxZ: 26,
  crosswalkZ: 12,
}

/** Industrial North: the freight extension of the same arterial road. */
export const INDUSTRIAL_NORTH = {
  roadCenterX: 48,
  roadHalfWidth: 4,
  roadMinZ: -52,
  roadMaxZ: -16,
}

/** Connector roads joining each block to the central ring. */
export const CONNECTORS = {
  north: { centerX: 12, halfWidth: 3, fromZ: -42, toZ: -23 },
  east: { centerZ: 6, halfWidth: 3, fromX: 29, toX: 44 },
  west: { centerZ: 6, halfWidth: 3, fromX: -45, toX: -29 },
  south: { centerX: -12, halfWidth: 3, fromZ: 29, toZ: 45 },
}

/** Axis-aligned asphalt rectangle (for placement validation + spawn rules). */
export interface RoadRect {
  id: string
  minX: number
  maxX: number
  minZ: number
  maxZ: number
}

/**
 * Every asphalt surface in the city, derived from the same constants that
 * drive rendering — placement validators and citizen spawn rules read this,
 * so geometry and rules can never drift apart.
 */
export function getRoadRects(): RoadRect[] {
  const R = ROAD_CENTER
  const HW = ROAD_HALF_WIDTH
  return [
    { id: 'ring_north', minX: -(R + HW), maxX: R + HW, minZ: -R - HW, maxZ: -R + HW },
    { id: 'ring_south', minX: -(R + HW), maxX: R + HW, minZ: R - HW, maxZ: R + HW },
    { id: 'ring_west', minX: -R - HW, maxX: -R + HW, minZ: -(R - HW), maxZ: R - HW },
    { id: 'ring_east', minX: R - HW, maxX: R + HW, minZ: -(R - HW), maxZ: R - HW },
    {
      id: 'residential_street',
      minX: RESIDENTIAL.roadMinX,
      maxX: RESIDENTIAL.roadMaxX,
      minZ: RESIDENTIAL.roadCenterZ - RESIDENTIAL.roadHalfWidth,
      maxZ: RESIDENTIAL.roadCenterZ + RESIDENTIAL.roadHalfWidth,
    },
    {
      id: 'residential_west_street',
      minX: RESIDENTIAL_WEST.roadCenterX - RESIDENTIAL_WEST.roadHalfWidth,
      maxX: RESIDENTIAL_WEST.roadCenterX + RESIDENTIAL_WEST.roadHalfWidth,
      minZ: RESIDENTIAL_WEST.roadMinZ,
      maxZ: RESIDENTIAL_WEST.roadMaxZ,
    },
    {
      id: 'residential_south_street',
      minX: RESIDENTIAL_SOUTH.roadMinX,
      maxX: RESIDENTIAL_SOUTH.roadMaxX,
      minZ: RESIDENTIAL_SOUTH.roadCenterZ - RESIDENTIAL_SOUTH.roadHalfWidth,
      maxZ: RESIDENTIAL_SOUTH.roadCenterZ + RESIDENTIAL_SOUTH.roadHalfWidth,
    },
    {
      id: 'industrial_road',
      minX: INDUSTRIAL.roadCenterX - INDUSTRIAL.roadHalfWidth,
      maxX: INDUSTRIAL.roadCenterX + INDUSTRIAL.roadHalfWidth,
      minZ: INDUSTRIAL.roadMinZ,
      maxZ: INDUSTRIAL.roadMaxZ,
    },
    {
      id: 'industrial_north_road',
      minX: INDUSTRIAL_NORTH.roadCenterX - INDUSTRIAL_NORTH.roadHalfWidth,
      maxX: INDUSTRIAL_NORTH.roadCenterX + INDUSTRIAL_NORTH.roadHalfWidth,
      minZ: INDUSTRIAL_NORTH.roadMinZ,
      maxZ: INDUSTRIAL_NORTH.roadMaxZ,
    },
    {
      id: 'connector_north',
      minX: CONNECTORS.north.centerX - CONNECTORS.north.halfWidth,
      maxX: CONNECTORS.north.centerX + CONNECTORS.north.halfWidth,
      minZ: CONNECTORS.north.fromZ,
      maxZ: CONNECTORS.north.toZ,
    },
    {
      id: 'connector_east',
      minX: CONNECTORS.east.fromX,
      maxX: CONNECTORS.east.toX,
      minZ: CONNECTORS.east.centerZ - CONNECTORS.east.halfWidth,
      maxZ: CONNECTORS.east.centerZ + CONNECTORS.east.halfWidth,
    },
    {
      id: 'connector_west',
      minX: CONNECTORS.west.fromX,
      maxX: CONNECTORS.west.toX,
      minZ: CONNECTORS.west.centerZ - CONNECTORS.west.halfWidth,
      maxZ: CONNECTORS.west.centerZ + CONNECTORS.west.halfWidth,
    },
    {
      id: 'connector_south',
      minX: CONNECTORS.south.centerX - CONNECTORS.south.halfWidth,
      maxX: CONNECTORS.south.centerX + CONNECTORS.south.halfWidth,
      minZ: CONNECTORS.south.fromZ,
      maxZ: CONNECTORS.south.toZ,
    },
    {
      id: 'gateway_avenue',
      minX: GATEWAY.road.minX,
      maxX: GATEWAY.road.maxX,
      minZ: GATEWAY.road.minZ,
      maxZ: GATEWAY.road.maxZ,
    },
    // Kit-compiled roads (Main Street East).
    ...COMPILED_SECTORS.flatMap((c) => c.roadRects),
  ]
}

export const CAR_SPAWN: [number, number, number] = [10.5, 0.8, 14]
export const CAR_SPAWN_ROTATION_Y = Math.PI // facing north (-z)

export const BUILDINGS: BuildingDef[] = [
  {
    id: 'building_apartment_01',
    position: [-14.5, -14.5],
    size: [9, 7.5, 9],
    color: '#d98862',
    roofColor: '#a05a3c',
    label: 'Sunrise Apartments',
    labelColor: '#ffd9a0',
    door: 'south',
    accentColor: '#f2b263',
  },
  {
    id: 'building_gym_01',
    position: [14.5, -14.5],
    size: [9, 6.5, 9],
    color: '#e0684b',
    roofColor: '#9c3f2c',
    label: 'Block Gym',
    labelColor: '#ffe9b0',
    door: 'south',
    accentColor: '#ffd166',
  },
  {
    id: 'building_office_01',
    position: [16.5, -1],
    size: [7, 9.5, 7],
    color: '#6f8fb8',
    roofColor: '#46608a',
    label: 'Nook Offices',
    labelColor: '#cfe3ff',
    door: 'west',
    accentColor: '#9fc2ec',
  },
  {
    id: 'building_cafe_01',
    position: [-16.5, -3],
    size: [6, 5, 6],
    color: '#f2e3c6',
    roofColor: '#c4a276',
    label: 'Corner Café',
    labelColor: '#ffdf9e',
    door: 'east',
    accentColor: '#e07a5f',
  },
  {
    id: 'building_shop_01',
    position: [-5, -17.5],
    size: [6, 5, 6],
    color: '#e3b448',
    roofColor: '#a87f2c',
    label: 'Mini Mart',
    labelColor: '#fff3c9',
    door: 'south',
    accentColor: '#5f9ea0',
  },
  {
    id: 'building_shop_02',
    position: [3.5, -17.5],
    size: [7, 6, 6],
    color: '#a3b18a',
    roofColor: '#6f7d58',
    label: 'Book Nook',
    labelColor: '#e8f0d8',
    door: 'south',
    accentColor: '#d9825f',
  },
  {
    id: 'building_house_01',
    position: [0.5, 15],
    size: [5.5, 4.5, 5.5],
    color: '#a06b9a',
    roofColor: '#6d4468',
    door: 'north',
    accentColor: '#e8c9e4',
  },
  // Backdrop buildings outside the play area add depth to the diorama.
  // (Towers 02/03 moved out past the new districts in City Expansion v1.)
  {
    id: 'building_tower_01',
    position: [-76, -14],
    size: [10, 15, 9],
    color: '#8fa8c8',
    roofColor: '#5c7294',
  },
  {
    id: 'building_tower_02',
    position: [72, -12],
    size: [9, 13, 9],
    color: '#c8a88f',
    roofColor: '#93755d',
  },
  {
    id: 'building_tower_03',
    position: [-8, -66],
    size: [11, 11, 9],
    color: '#9aa5b1',
    roofColor: '#68737f',
  },
  // Distant silhouettes past the districts — the city continues off-map.
  {
    id: 'building_tower_04',
    position: [80, -35],
    size: [14, 17, 10],
    color: '#7f93ad',
    roofColor: '#54637a',
  },
  {
    id: 'building_tower_05',
    position: [-76, 10],
    size: [8, 9, 8],
    color: '#b3a08c',
    roofColor: '#7d6e5d',
  },
  {
    id: 'building_tower_06',
    position: [-10, 70],
    size: [11, 12, 9],
    color: '#a89bb3',
    roofColor: '#73687f',
  },

  // ---- Residential Street (north district) ----
  {
    id: 'building_house_r1',
    position: [-14, -54],
    size: [5, 4, 5],
    color: '#e8b4a2',
    roofColor: '#a5705c',
    door: 'south',
    accentColor: '#f2d5a0',
  },
  {
    id: 'building_house_r2',
    position: [-6, -54.5],
    size: [5.5, 4.5, 5.5],
    color: '#bcd0a2',
    roofColor: '#7d9460',
    door: 'south',
    accentColor: '#e07a5f',
  },
  {
    id: 'building_house_r3',
    position: [2, -54],
    size: [5, 4.2, 5],
    color: '#a2c4d0',
    roofColor: '#5f8391',
    door: 'south',
    accentColor: '#ffd166',
  },
  {
    id: 'building_house_r4',
    position: [10, -54.5],
    size: [5.5, 4, 5.5],
    color: '#d9c39a',
    roofColor: '#9b8455',
    door: 'south',
    accentColor: '#8fb8a8',
  },
  // Future-use landmark: visual only, no interactable entry.
  {
    id: 'building_townhomes_01',
    position: [20, -54],
    size: [7, 6, 7],
    color: '#c98a6a',
    roofColor: '#8a5a42',
    label: 'Townhomes — coming soon',
    labelColor: '#ffd9a0',
    door: 'south',
    accentColor: '#f2b263',
  },
  {
    id: 'building_house_r5',
    position: [-14, -38],
    size: [5, 4, 5],
    color: '#c9a2c4',
    roofColor: '#8a5f85',
    door: 'north',
    accentColor: '#bcd0a2',
  },

  // ---- Industrial / Market Strip (east district) ----
  // Future-use landmarks: visual only, no interactable entries.
  {
    id: 'building_warehouse_01',
    position: [60, -6],
    size: [10, 7, 9],
    color: '#8d939c',
    roofColor: '#5c6068',
    label: 'Warehouse — coming soon',
    labelColor: '#cfd6e0',
    door: 'west',
    accentColor: '#d1495b',
    windows: false,
  },
  {
    id: 'building_garage_01',
    position: [59.5, 8],
    size: [8, 5.5, 7],
    color: '#6e7b8a',
    roofColor: '#48525e',
    label: 'Garage — coming soon',
    labelColor: '#cfd6e0',
    door: 'west',
    accentColor: '#e3b448',
    windows: false,
  },
  {
    id: 'building_market_01',
    position: [39, 15],
    size: [6, 4.5, 6],
    color: '#e0975f',
    roofColor: '#9c6238',
    label: 'Market Row',
    labelColor: '#ffe9b0',
    door: 'east',
    accentColor: '#5f9ea0',
  },
  {
    id: 'building_market_02',
    position: [39, 22],
    size: [6, 5, 6],
    color: '#9ea86a',
    roofColor: '#6a7340',
    door: 'east',
    accentColor: '#d9825f',
  },

  // ---- Residential West (City Expansion v2): quiet lane, homes both sides ----
  {
    id: 'building_house_w1',
    position: [-57, -14],
    size: [5, 4, 5],
    color: '#d9a5b5',
    roofColor: '#96687a',
    door: 'east',
    accentColor: '#f2d5a0',
  },
  {
    id: 'building_house_w2',
    position: [-57, -5],
    size: [5.5, 4.5, 5.5],
    color: '#a2c4d0',
    roofColor: '#5f8391',
    door: 'east',
    accentColor: '#e07a5f',
  },
  {
    id: 'building_house_w3',
    position: [-57, 4],
    size: [5, 4.2, 5],
    color: '#d9c39a',
    roofColor: '#9b8455',
    door: 'east',
    accentColor: '#8fb8a8',
  },
  {
    id: 'building_house_w4',
    position: [-57, 13],
    size: [5.5, 4, 5.5],
    color: '#bcd0a2',
    roofColor: '#7d9460',
    door: 'east',
    accentColor: '#ffd166',
  },
  {
    id: 'building_house_w5',
    position: [-40, -14],
    size: [5, 4, 5],
    color: '#e8b4a2',
    roofColor: '#a5705c',
    door: 'west',
    accentColor: '#bcd0a2',
  },
  {
    id: 'building_commons_w1',
    position: [-40, -3],
    size: [6, 5, 6],
    color: '#f2e3c6',
    roofColor: '#c4a276',
    label: 'West Commons',
    labelColor: '#ffdf9e',
    door: 'west',
    accentColor: '#5f9ea0',
  },
  {
    id: 'building_house_w6',
    position: [-40, 14],
    size: [5.5, 4.3, 5.5],
    color: '#c9a2c4',
    roofColor: '#8a5f85',
    door: 'west',
    accentColor: '#e8c9e4',
  },

  // ---- Residential South (City Expansion v2): sunny row homes ----
  {
    id: 'building_house_s1',
    position: [-20, 41],
    size: [5, 4, 5],
    color: '#a3b18a',
    roofColor: '#6f7d58',
    door: 'south',
    accentColor: '#ffd166',
  },
  {
    id: 'building_house_s2',
    position: [-4, 41],
    size: [5.5, 4.2, 5.5],
    color: '#e8b4a2',
    roofColor: '#a5705c',
    door: 'south',
    accentColor: '#8fb8a8',
  },
  {
    id: 'building_house_s3',
    position: [5, 41],
    size: [5, 4, 5],
    color: '#a2c4d0',
    roofColor: '#5f8391',
    door: 'south',
    accentColor: '#f2d5a0',
  },
  {
    id: 'building_house_s4',
    position: [14, 41],
    size: [5.5, 4.5, 5.5],
    color: '#d9c39a',
    roofColor: '#9b8455',
    door: 'south',
    accentColor: '#e07a5f',
  },
  {
    id: 'building_house_s5',
    position: [-14, 55.5],
    size: [5, 4, 5],
    color: '#c9a2c4',
    roofColor: '#8a5f85',
    door: 'north',
    accentColor: '#bcd0a2',
  },
  {
    id: 'building_house_s6',
    position: [-5, 55.5],
    size: [5.5, 4, 5.5],
    color: '#bcd0a2',
    roofColor: '#7d9460',
    door: 'north',
    accentColor: '#d9825f',
  },
  {
    id: 'building_deli_s1',
    position: [6, 55.5],
    size: [6, 5, 6],
    color: '#e3b448',
    roofColor: '#a87f2c',
    label: 'South Deli',
    labelColor: '#fff3c9',
    door: 'north',
    accentColor: '#5f9ea0',
  },
  {
    id: 'building_house_s7',
    position: [15, 55.5],
    size: [5, 4.2, 5],
    color: '#d9a5b5',
    roofColor: '#96687a',
    door: 'north',
    accentColor: '#a2c4d0',
  },

  // ---- Industrial North (City Expansion v2): freight along the arterial ----
  {
    id: 'building_warehouse_n1',
    position: [59.5, -28],
    size: [10, 7.5, 9],
    color: '#8d939c',
    roofColor: '#5c6068',
    label: 'North Freight',
    labelColor: '#cfd6e0',
    door: 'west',
    accentColor: '#e3b448',
    windows: false,
  },
  {
    id: 'building_warehouse_n2',
    position: [59.5, -42],
    size: [10, 6.5, 9],
    color: '#7a8290',
    roofColor: '#4d545e',
    door: 'west',
    accentColor: '#d1495b',
    windows: false,
  },
  {
    id: 'building_factory_n1',
    position: [38.5, -27],
    size: [9, 8, 8],
    color: '#9c8d7c',
    roofColor: '#6b5f52',
    label: 'Blockworks Factory',
    labelColor: '#f0e3d0',
    door: 'east',
    accentColor: '#e0975f',
    windows: false,
  },
  {
    id: 'building_depot_n1',
    position: [38.5, -36.5],
    size: [8, 5.5, 7],
    color: '#6e7b8a',
    roofColor: '#48525e',
    door: 'east',
    accentColor: '#5faf7f',
    windows: false,
  },

  // ---- Downtown Gateway (Large City Foundation v1, sector s0_-1) ----
  {
    id: 'building_gate_tower_01',
    position: [34, -80],
    size: [8, 12, 8],
    color: '#7f93ad',
    roofColor: '#54637a',
    label: 'Meridian Tower',
    labelColor: '#cfe3ff',
    door: 'east',
    accentColor: '#9fc2ec',
  },
  {
    id: 'building_gate_tower_02',
    position: [34, -94],
    size: [8, 14, 8],
    color: '#8fa8c8',
    roofColor: '#5c7294',
    door: 'east',
    accentColor: '#cfe3ff',
  },
  {
    id: 'building_gate_offices_01',
    position: [62, -80],
    size: [9, 11, 8],
    color: '#a89bb3',
    roofColor: '#73687f',
    label: 'Gateway Offices',
    labelColor: '#e8dff2',
    door: 'west',
    accentColor: '#d9a5b5',
  },
  {
    id: 'building_gate_hotel_01',
    position: [63, -110],
    size: [9, 13, 8],
    color: '#c8a88f',
    roofColor: '#93755d',
    label: 'Hotel — coming soon',
    labelColor: '#ffe9b0',
    door: 'west',
    accentColor: '#e0975f',
  },
  {
    id: 'building_gate_retail_01',
    position: [33, -104],
    size: [6, 5, 6],
    color: '#e3b448',
    roofColor: '#a87f2c',
    label: 'Avenue Deli',
    labelColor: '#fff3c9',
    door: 'east',
    accentColor: '#5f9ea0',
  },

  // ---- Main Street East (District Authoring Kit proof, sector s1_-1) ----
  // Compiled from templates in authoring/sectors/mainStreetEast.ts.
  ...COMPILED_SECTORS.flatMap((c) => c.buildings as BuildingDef[]),
]

export const FOOD_TRUCK = {
  id: 'food_truck_01',
  position: [1.5, -6.5] as Vec2,
  rotationY: 0, // serving window faces south (+z)
  bodyColor: '#f4845f',
  trimColor: '#ffd166',
}

export const JOB_KIOSK = {
  id: 'prop_job_kiosk_01',
  position: [12, -4.5] as Vec2,
  rotationY: Math.PI / 2, // faces west
  color: '#5f9ea0',
}

export const PARK = {
  center: [-12.5, 12.5] as Vec2,
  size: [15, 15] as Vec2,
  pond: { center: [-15, 15] as Vec2, radius: 2.4 },
}

export const PARKING_LOT = {
  center: [13, 14] as Vec2,
  size: [13, 11] as Vec2,
}

export const PROPS: PropDef[] = [
  // Street lamps around the inner sidewalk ring + one in the park.
  { id: 'prop_street_lamp_01', type: 'street_lamp', position: [-22, -22] },
  { id: 'prop_street_lamp_02', type: 'street_lamp', position: [-5.9, -22.6] },
  { id: 'prop_street_lamp_03', type: 'street_lamp', position: [22, -22] },
  { id: 'prop_street_lamp_04', type: 'street_lamp', position: [22, 0] },
  { id: 'prop_street_lamp_05', type: 'street_lamp', position: [22, 22] },
  { id: 'prop_street_lamp_06', type: 'street_lamp', position: [0, 22] },
  { id: 'prop_street_lamp_07', type: 'street_lamp', position: [-22, 22] },
  { id: 'prop_street_lamp_08', type: 'street_lamp', position: [-21.2, -3.4] },
  { id: 'prop_street_lamp_09', type: 'street_lamp', position: [-6.5, 6.5] },
  // Street trees on the sidewalks.
  { id: 'prop_tree_01', type: 'tree', position: [-11, -21.5] },
  { id: 'prop_tree_02', type: 'tree', position: [11, -21.5] },
  { id: 'prop_tree_03', type: 'tree', position: [21.5, -11] },
  { id: 'prop_tree_04', type: 'tree', position: [21.5, 11] },
  { id: 'prop_tree_05', type: 'tree', position: [-21.5, -11] },
  { id: 'prop_tree_06', type: 'tree', position: [11, 21.5] },
  // Park trees sway gently. Kept ≥ 2.5 units off Leo's inner patrol ring
  // (±19.5) so his delivery loop never clips through foliage.
  { id: 'prop_park_tree_01', type: 'park_tree', position: [-9, 8] },
  { id: 'prop_park_tree_02', type: 'park_tree', position: [-17, 9] },
  { id: 'prop_park_tree_03', type: 'park_tree', position: [-9.4, 17.6] },
  { id: 'prop_park_tree_04', type: 'park_tree', position: [-19, 18.6] },
  { id: 'prop_park_tree_05', type: 'park_tree', position: [-7, 12.5] },
  // Benches.
  { id: 'prop_bench_01', type: 'bench', position: [-7.6, 10.5], rotationY: Math.PI / 2 },
  { id: 'prop_bench_02', type: 'bench', position: [-11.8, 5.6], rotationY: Math.PI },
  { id: 'prop_bench_03', type: 'bench', position: [5, -3], rotationY: -Math.PI / 2 },
  // Trash cans.
  { id: 'prop_trash_can_01', type: 'trash_can', position: [-1.9, -4.7] },
  { id: 'prop_trash_can_02', type: 'trash_can', position: [11, -7.5] },
  { id: 'prop_trash_can_03', type: 'trash_can', position: [-8, 6.8] },
  // Small flavor props.
  { id: 'prop_hydrant_01', type: 'hydrant', position: [-21.5, -6], color: '#d1495b' },
  { id: 'prop_planter_01', type: 'planter', position: [-12.7, -6.2] },
  { id: 'prop_planter_02', type: 'planter', position: [-12.7, 0.2] },
  // Parked cars in the lot (visual + collider, not drivable).
  { id: 'vehicle_parked_car_01', type: 'parked_car', position: [16, 11.5], rotationY: -Math.PI / 2, color: '#7a9cc6' },
  { id: 'vehicle_parked_car_02', type: 'parked_car', position: [16, 16.5], rotationY: -Math.PI / 2, color: '#c65f5f' },
  // ---- Decorative GLB street props (Quaternius). No colliders. ----
  // Bollards flank the crosswalk ends.
  { id: 'prop_bollard_01', type: 'bollard', position: [-1.7, -22.5] },
  { id: 'prop_bollard_02', type: 'bollard', position: [1.7, -22.5] },
  { id: 'prop_bollard_03', type: 'bollard', position: [-1.7, -29.5] },
  { id: 'prop_bollard_04', type: 'bollard', position: [1.7, -29.5] },
  { id: 'prop_bollard_05', type: 'bollard', position: [-22.5, -1.7] },
  { id: 'prop_bollard_06', type: 'bollard', position: [-22.5, 1.7] },
  // Ground AC units hug the GLB buildings' service walls.
  { id: 'prop_ac_unit_01', type: 'ac_unit', position: [18.9, -13.5], rotationY: Math.PI / 2 },
  { id: 'prop_ac_unit_02', type: 'ac_unit', position: [-19.4, -12.3], rotationY: -Math.PI / 2 },
  { id: 'prop_ac_unit_03', type: 'ac_unit', position: [15.6, -5.15], rotationY: Math.PI },
  // Concrete planters dress the shop fronts.
  { id: 'prop_street_planter_01', type: 'street_planter', position: [-7.2, -13.8] },
  { id: 'prop_street_planter_02', type: 'street_planter', position: [0.8, -13.8] },
  { id: 'prop_street_planter_03', type: 'street_planter', position: [6.4, -13.8] },
  // Manholes + drains on the asphalt (previously flat procedural circles).
  { id: 'prop_manhole_01', type: 'manhole', position: [8, -26] },
  { id: 'prop_manhole_02', type: 'manhole', position: [-12, 26] },
  { id: 'prop_manhole_03', type: 'manhole', position: [26, 6] },
  { id: 'prop_drain_01', type: 'drain', position: [2.3, -23.7] },
  { id: 'prop_drain_02', type: 'drain', position: [-23.7, 2.3] },

  // ---- Residential Street props: cozy, calm, tree-lined ----
  { id: 'prop_street_lamp_r1', type: 'street_lamp', position: [-19.4, -41] },
  { id: 'prop_street_lamp_r2', type: 'street_lamp', position: [0.5, -50.4] },
  { id: 'prop_street_lamp_r3', type: 'street_lamp', position: [23.5, -40.8] },
  { id: 'prop_street_lamp_r4', type: 'street_lamp', position: [26, -49.5] },
  { id: 'prop_tree_r1', type: 'tree', position: [-18, -50] },
  { id: 'prop_tree_r2', type: 'tree', position: [-10, -50.2] },
  { id: 'prop_tree_r3', type: 'tree', position: [6, -50] },
  { id: 'prop_tree_r4', type: 'tree', position: [-18, -40.6] },
  { id: 'prop_tree_r5', type: 'tree', position: [8.4, -40.7] },
  { id: 'prop_tree_r6', type: 'tree', position: [26, -40.6] },
  { id: 'prop_bench_r1', type: 'bench', position: [0.2, -39.9], rotationY: Math.PI },
  { id: 'prop_trash_can_r1', type: 'trash_can', position: [3.2, -39.7] },
  { id: 'prop_planter_r1', type: 'street_planter', position: [-8.3, -50.5] },
  { id: 'prop_planter_r2', type: 'street_planter', position: [13.5, -50.5] },
  { id: 'prop_mailbox_r1', type: 'utility_box', position: [-4.2, -50.7], color: '#4a7fd4' },
  { id: 'prop_utility_r2', type: 'utility_box', position: [16.5, -40.8], color: '#6f7d58' },
  // Curb parking along the south side of the street.
  { id: 'vehicle_parked_car_r1', type: 'parked_car', position: [-9.4, -41.4], rotationY: Math.PI / 2, color: '#b8a06a' },
  { id: 'vehicle_parked_car_r2', type: 'parked_car', position: [20, -41.2], rotationY: -Math.PI / 2, color: '#7a9cc6' },
  // Stop signs guard the residential crosswalk (both approaches).
  { id: 'prop_stop_sign_r1', type: 'stop_sign', position: [-6.8, -48.9], rotationY: Math.PI / 2 },
  { id: 'prop_stop_sign_r2', type: 'stop_sign', position: [2.8, -41.1], rotationY: -Math.PI / 2 },

  // ---- Industrial / Market Strip props: asphalt, cones, utility ----
  { id: 'prop_street_lamp_i1', type: 'street_lamp', position: [43, -2] },
  { id: 'prop_street_lamp_i2', type: 'street_lamp', position: [53, 4] },
  { id: 'prop_street_lamp_i3', type: 'street_lamp', position: [43, 24] },
  { id: 'prop_cone_i1', type: 'cone', position: [52.6, -0.5] },
  { id: 'prop_cone_i2', type: 'cone', position: [52.6, -12.4] },
  { id: 'prop_cone_i3', type: 'cone', position: [53, -13.5] },
  { id: 'prop_cone_i4', type: 'cone', position: [43.5, 25.2] },
  { id: 'prop_bollard_i1', type: 'bollard', position: [43.4, 10.4] },
  { id: 'prop_bollard_i2', type: 'bollard', position: [43.4, 13.6] },
  { id: 'prop_bollard_i3', type: 'bollard', position: [52.6, 10.4] },
  { id: 'prop_bollard_i4', type: 'bollard', position: [52.6, 13.6] },
  { id: 'prop_manhole_i1', type: 'manhole', position: [47, -8] },
  { id: 'prop_drain_i1', type: 'drain', position: [45.6, 18] },
  { id: 'prop_utility_i1', type: 'utility_box', position: [42.6, 1.9], color: '#48525e' },
  { id: 'prop_utility_i2', type: 'utility_box', position: [53.2, 16.5], color: '#8a5a3c' },
  { id: 'prop_trash_can_i1', type: 'trash_can', position: [43.6, 21.6] },
  // Delivery van pulled up past the market row (kept off the shopper's stroll).
  { id: 'vehicle_parked_car_i1', type: 'parked_car', position: [42.2, 27.6], rotationY: 0.15, color: '#c9c9c9' },

  // ---- City Life Density v1: parked vehicles ----
  { id: 'vehicle_parked_car_c3', type: 'parked_car', position: [10.5, 18.5], rotationY: -Math.PI / 2, color: '#a3b18a' },
  { id: 'vehicle_parked_car_c4', type: 'parked_car', position: [7.8, -8.2], rotationY: 0.3, color: '#d9a5b5' },
  { id: 'vehicle_parked_car_r3', type: 'parked_car', position: [-15.6, -41.7], rotationY: Math.PI / 2, color: '#e0c25e' },
  { id: 'vehicle_parked_car_r4', type: 'parked_car', position: [12, -48.8], rotationY: -Math.PI / 2, color: '#5f9ea0' },
  { id: 'vehicle_parked_truck_i1', type: 'parked_truck', position: [53.6, -7.6], rotationY: 0, color: '#c9803d' },
  { id: 'vehicle_parked_car_i2', type: 'parked_car', position: [55, -14], rotationY: 0, color: '#6a8fd4' },

  // ---- City Life Density v1: storefront + entrance details ----
  { id: 'prop_signboard_cafe', type: 'signboard', position: [-13.2, -3.6], rotationY: Math.PI / 2 },
  { id: 'prop_signboard_truck', type: 'signboard', position: [3.6, -3.2], rotationY: -0.4 },
  { id: 'prop_signboard_market', type: 'signboard', position: [42.4, 13.4], rotationY: -Math.PI / 2 },
  { id: 'prop_table_set_cafe', type: 'table_set', position: [-11.6, -4.8] },
  { id: 'prop_table_set_plaza', type: 'table_set', position: [6, -5.8] },
  { id: 'prop_flower_pot_gym1', type: 'flower_pot', position: [12.6, -9.7] },
  { id: 'prop_flower_pot_gym2', type: 'flower_pot', position: [15.4, -9.7] },
  { id: 'prop_flower_pot_pl1', type: 'flower_pot', position: [-5, 3.5] },
  { id: 'prop_flower_pot_pl2', type: 'flower_pot', position: [6.5, 2.5] },
  { id: 'prop_crate_mart', type: 'crate', position: [-9.3, -14.2] },
  { id: 'prop_flower_pot_h1', type: 'flower_pot', position: [-14.9, -51.2] },
  { id: 'prop_flower_pot_h3', type: 'flower_pot', position: [3, -51.2] },
  { id: 'prop_porch_light_h2', type: 'porch_light', position: [-6, -51.6] },
  { id: 'prop_porch_light_h4', type: 'porch_light', position: [10, -51.9] },
  { id: 'prop_porch_light_th', type: 'porch_light', position: [20, -50.4] },

  // ---- City Life Density v1: industrial clutter ----
  { id: 'prop_pallet_w1', type: 'pallet', position: [53.6, -11.6] },
  { id: 'prop_pallet_w2', type: 'pallet', position: [54.3, -3.4], rotationY: 0.5 },
  { id: 'prop_crate_w1', type: 'crate', position: [53.0, -11.2] },
  { id: 'prop_crate_w2', type: 'crate', position: [53.8, -0.6], rotationY: 0.9 },
  { id: 'prop_barrel_g1', type: 'barrel', position: [56.8, 2.6] },
  { id: 'prop_barrel_g2', type: 'barrel', position: [55.9, 3.2] },
  { id: 'prop_dumpster_m1', type: 'dumpster', position: [36.5, 26.8], rotationY: Math.PI / 2 },
  { id: 'prop_crate_m1', type: 'crate', position: [38.2, 26.9] },

  // ---- Residential West props (City Expansion v2) ----
  { id: 'prop_street_lamp_w1', type: 'street_lamp', position: [-53.3, -13] },
  { id: 'prop_street_lamp_w2', type: 'street_lamp', position: [-42.7, -6.5] },
  { id: 'prop_street_lamp_w3', type: 'street_lamp', position: [-53.3, 17.5] },
  { id: 'prop_tree_w1', type: 'tree', position: [-53, -10] },
  { id: 'prop_tree_w2', type: 'tree', position: [-56.2, -0.5] },
  { id: 'prop_tree_w3', type: 'tree', position: [-42.4, 10.5] },
  { id: 'prop_flower_pot_w1', type: 'flower_pot', position: [-53.9, -13] },
  { id: 'prop_flower_pot_w2', type: 'flower_pot', position: [-54.1, 6.9] },
  { id: 'prop_hydrant_w1', type: 'hydrant', position: [-42.8, -17.6], color: '#d1495b' },
  { id: 'prop_bench_w1', type: 'bench', position: [-42.6, -8.6], rotationY: -Math.PI / 2 },
  { id: 'vehicle_parked_car_w1', type: 'parked_car', position: [-56.1, -9.8], rotationY: Math.PI / 2, color: '#b8a06a' },
  { id: 'vehicle_parked_car_w2', type: 'parked_car', position: [-56.1, 8.4], rotationY: Math.PI / 2, color: '#7a9cc6' },

  // ---- Residential South props (City Expansion v2) ----
  { id: 'prop_street_lamp_s1', type: 'street_lamp', position: [9.5, 43.6] },
  { id: 'prop_street_lamp_s2', type: 'street_lamp', position: [-9.9, 52.7] },
  { id: 'prop_street_lamp_s3', type: 'street_lamp', position: [13, 52.75] },
  { id: 'prop_tree_s1', type: 'tree', position: [-17.6, 55.2] },
  { id: 'prop_tree_s2', type: 'tree', position: [0, 43.2] },
  { id: 'prop_tree_s3', type: 'tree', position: [2.6, 54.6] },
  { id: 'prop_flower_pot_s1', type: 'flower_pot', position: [-11.2, 53.0] },
  { id: 'prop_signboard_deli', type: 'signboard', position: [10.4, 53.6], rotationY: Math.PI / 2 },
  { id: 'prop_bench_s1', type: 'bench', position: [18.2, 43.5], rotationY: Math.PI },
  { id: 'prop_trash_can_s1', type: 'trash_can', position: [19.9, 41.8] },
  { id: 'vehicle_parked_car_s1', type: 'parked_car', position: [-19, 52.3], rotationY: -Math.PI / 2, color: '#e0c25e' },
  { id: 'vehicle_parked_car_s2', type: 'parked_car', position: [19.6, 51.9], rotationY: -Math.PI / 2, color: '#5f9ea0' },

  // ---- Industrial North props (City Expansion v2) ----
  { id: 'prop_street_lamp_n1', type: 'street_lamp', position: [43, -22] },
  { id: 'prop_street_lamp_n2', type: 'street_lamp', position: [53, -34.8] },
  { id: 'prop_street_lamp_n3', type: 'street_lamp', position: [43, -49.8] },
  { id: 'prop_cone_n1', type: 'cone', position: [52.8, -20] },
  { id: 'prop_cone_n2', type: 'cone', position: [52.8, -23] },
  { id: 'prop_crate_n1', type: 'crate', position: [53.6, -25.2] },
  { id: 'prop_pallet_n1', type: 'pallet', position: [53.7, -34.2] },
  { id: 'prop_barrel_n1', type: 'barrel', position: [54.0, -44] },
  { id: 'prop_crate_n2', type: 'crate', position: [43.0, -34.6] },
  { id: 'prop_utility_n1', type: 'utility_box', position: [43, -51.5], color: '#48525e' },
  { id: 'vehicle_parked_truck_n1', type: 'parked_truck', position: [54.4, -35], rotationY: 0, color: '#8a9bb0' },
  { id: 'vehicle_parked_car_n1', type: 'parked_car', position: [54.6, -20.8], rotationY: 0, color: '#c9c9c9' },

  // ---- Downtown Gateway props (sector s0_-1) ----
  { id: 'prop_street_lamp_g1', type: 'street_lamp', position: [43, -78] },
  { id: 'prop_street_lamp_g2', type: 'street_lamp', position: [53, -90] },
  { id: 'prop_street_lamp_g3', type: 'street_lamp', position: [43, -100] },
  { id: 'prop_street_planter_g1', type: 'street_planter', position: [54.5, -79] },
  { id: 'prop_street_planter_g2', type: 'street_planter', position: [54.5, -85] },
  { id: 'prop_bench_g1', type: 'bench', position: [57, -88.5], rotationY: Math.PI },
  { id: 'prop_trash_can_g1', type: 'trash_can', position: [59.5, -88.8] },
  { id: 'prop_cone_g1', type: 'cone', position: [43.4, -95] },
  { id: 'prop_tree_g1', type: 'tree', position: [30, -86] },
  { id: 'prop_tree_g2', type: 'tree', position: [68.5, -88] },
  // Polish pass: furniture in the plaza's FREE north strip (Gateway
  // Offices occupies the south half, x 57.5..66.5 z -84..-76).
  { id: 'prop_bench_g2', type: 'bench', position: [63.5, -86], rotationY: Math.PI },
  { id: 'prop_bench_g3', type: 'bench', position: [68, -90.5], rotationY: Math.PI / 2 },
  { id: 'prop_street_planter_g3', type: 'street_planter', position: [54.8, -90.8] },
  { id: 'prop_street_planter_g4', type: 'street_planter', position: [69.2, -85.2] },
  { id: 'prop_signboard_g1', type: 'signboard', position: [56, -80] },
  { id: 'prop_table_set_g1', type: 'table_set', position: [61.5, -89.8] },
  { id: 'prop_street_lamp_g4', type: 'street_lamp', position: [69, -87.8] },
  { id: 'prop_street_lamp_g5', type: 'street_lamp', position: [36, -88] },
  { id: 'prop_tree_g3', type: 'tree', position: [33, -108] },
  { id: 'prop_tree_g4', type: 'tree', position: [56, -104] },
  { id: 'prop_flower_pot_g1', type: 'flower_pot', position: [58.8, -91] },
  { id: 'prop_trash_can_g2', type: 'trash_can', position: [66.2, -88.3] },

  // ---- Main Street East props (kit-compiled seeded scatter) ----
  ...COMPILED_SECTORS.flatMap((c) => c.props as PropDef[]),

  // ---- Backdrop filler trees just outside the play area ----
  { id: 'prop_tree_bg1', type: 'tree', position: [-26, -61.5] },
  { id: 'prop_tree_bg2', type: 'tree', position: [4, -62] },
  { id: 'prop_tree_bg3', type: 'tree', position: [14, -61.5] },
  { id: 'prop_tree_bg4', type: 'tree', position: [30, -62] },
  { id: 'prop_tree_bg5', type: 'tree', position: [68, 20] },
  { id: 'prop_tree_bg6', type: 'tree', position: [68, 0] },
  { id: 'prop_tree_bg7', type: 'tree', position: [68, -20] },
]

// Lane geometry (waypoints, limits, braking envelopes) lives in
// src/game/traffic/trafficData.ts; cars reference lanes by id.
//
// Cross-District Routing v1 fleet mix (8 cars): 4 crossDistrict (50%),
// 3 localLoop (37.5%), 1 throughTraffic (12.5%). Cars WITHOUT a routeMode
// keep their legacy loop exactly as before; routed cars spawn at graph
// anchors (their laneId/startIndex remain as home-lane metadata).
export const AMBIENT_CARS: AmbientCarDef[] = [
  {
    id: 'vehicle_ambient_car_01',
    color: '#d46a6a',
    laneId: 'lane_inner_cw',
    speedFactor: 1,
    startIndex: 0,
    routeMode: 'crossDistrict',
    routeSpawnId: 'spawn_ring_north',
    vehicleClass: 'sedan',
  },
  {
    id: 'vehicle_ambient_car_02',
    color: '#e0c25e',
    laneId: 'lane_inner_cw',
    speedFactor: 0.84,
    startIndex: 2,
    vehicleClass: 'compact',
  },
  {
    id: 'vehicle_ambient_car_03',
    color: '#6a8fd4',
    laneId: 'lane_outer_ccw',
    // Index 2, not 1: the outer-ring corner at index 1 sits within a car
    // length of the inner ring's index-2 corner — spawning there overlaps.
    startIndex: 2,
    speedFactor: 1,
    routeMode: 'crossDistrict',
    routeSpawnId: 'spawn_ring_east',
    vehicleClass: 'sedan',
  },
  // City Expansion v1: one calm car per new district loop.
  {
    id: 'vehicle_ambient_car_04',
    color: '#9a86c9',
    laneId: 'lane_residential',
    speedFactor: 1,
    startIndex: 0,
    vehicleClass: 'compact',
  },
  {
    id: 'vehicle_ambient_car_05',
    color: '#5faf7f',
    laneId: 'lane_industrial',
    speedFactor: 1,
    startIndex: 0,
    routeMode: 'crossDistrict',
    routeSpawnId: 'spawn_market',
    vehicleClass: 'van',
  },
  // City Expansion v2: one calm car per new block.
  {
    id: 'vehicle_ambient_car_06',
    color: '#c98a6a',
    laneId: 'lane_residential_west',
    speedFactor: 1,
    startIndex: 0,
    vehicleClass: 'compact',
  },
  {
    id: 'vehicle_ambient_car_07',
    color: '#8fb8a8',
    laneId: 'lane_residential_south',
    speedFactor: 0.92,
    startIndex: 1,
    routeMode: 'crossDistrict',
    routeSpawnId: 'spawn_southside',
    vehicleClass: 'sedan',
  },
  {
    id: 'vehicle_ambient_car_08',
    color: '#a86f6f',
    laneId: 'lane_industrial_north',
    speedFactor: 1,
    startIndex: 0,
    routeMode: 'throughTraffic',
    routeSpawnId: 'spawn_freight',
    vehicleClass: 'truck',
  },
]
