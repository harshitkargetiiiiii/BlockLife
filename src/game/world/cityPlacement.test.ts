import { describe, expect, it } from 'vitest'
import {
  AMBIENT_CARS,
  BUILDINGS,
  CITY_BOUNDS,
  GATEWAY,
  getRoadRects,
  PROPS,
} from './cityLayout'
import { COMPILED_SECTORS } from './authoring/compiledSectors'
import type { BuildingDef, PropDef } from './worldTypes'
import { LANES_BY_ID } from '../traffic/trafficData'
import { CAR_HALF_LENGTH, CAR_HALF_WIDTH } from '../traffic/vehicleObstacles'

/**
 * City Expansion v2 placement rules: buildings sit on real lots, never
 * inside each other, never on asphalt — like actual infrastructure. These
 * are pure-data tests, so any future layout edit that breaks the grid
 * fails immediately.
 */

interface AABB {
  id: string
  minX: number
  maxX: number
  minZ: number
  maxZ: number
}

function buildingBox(b: BuildingDef): AABB {
  return {
    id: b.id,
    minX: b.position[0] - b.size[0] / 2,
    maxX: b.position[0] + b.size[0] / 2,
    minZ: b.position[1] - b.size[2] / 2,
    maxZ: b.position[1] + b.size[2] / 2,
  }
}

function overlaps(a: AABB, b: AABB): boolean {
  return a.minX < b.maxX && a.maxX > b.minX && a.minZ < b.maxZ && a.maxZ > b.minZ
}

function insideBounds(box: AABB): boolean {
  const inCity =
    box.minX >= CITY_BOUNDS.minX &&
    box.maxX <= CITY_BOUNDS.maxX &&
    box.minZ >= CITY_BOUNDS.minZ &&
    box.maxZ <= CITY_BOUNDS.maxZ
  // Expansion sectors extend the playable world; buildings must sit inside
  // their sector's walled area.
  const areas = [GATEWAY.area, ...COMPILED_SECTORS.map((c) => c.spec.area)]
  const inExpansion = areas.some(
    (area) =>
      box.minX >= area.minX &&
      box.maxX <= area.maxX &&
      box.minZ >= area.minZ &&
      box.maxZ <= area.maxZ,
  )
  return inCity || inExpansion
}

/** Gameplay buildings have doors; backdrop towers are label-less scenery. */
const gameplayBuildings = BUILDINGS.filter((b) => b.door !== undefined)
const boxes = BUILDINGS.map(buildingBox)
const roadRects = getRoadRects()

/** Solid props (matching CityColliders) that must never spawn inside a building. */
const SOLID_PROP_TYPES: PropDef['type'][] = [
  'street_lamp',
  'tree',
  'park_tree',
  'bench',
  'trash_can',
  'hydrant',
  'planter',
  'street_planter',
  'parked_car',
  'parked_truck',
  'bollard',
  'cone',
  'utility_box',
  'stop_sign',
  'crate',
  'barrel',
  'signboard',
  'flower_pot',
  'dumpster',
  'table_set',
]

describe('city placement (no phasing, real-infrastructure rules)', () => {
  it('has the v2 block mix: 3 residential rows, 2 industrial zones, 1 commercial core', () => {
    const houseWest = BUILDINGS.filter((b) => b.id.startsWith('building_house_w'))
    const houseSouth = BUILDINGS.filter((b) => b.id.startsWith('building_house_s'))
    const houseNorth = BUILDINGS.filter((b) => b.id.startsWith('building_house_r'))
    const freight = BUILDINGS.filter(
      (b) =>
        b.id.startsWith('building_warehouse_n') ||
        b.id.startsWith('building_factory_n') ||
        b.id.startsWith('building_depot_n'),
    )
    expect(houseWest.length).toBeGreaterThanOrEqual(5)
    expect(houseSouth.length).toBeGreaterThanOrEqual(6)
    expect(houseNorth.length).toBeGreaterThanOrEqual(5)
    expect(freight.length).toBeGreaterThanOrEqual(4)
  })

  it('building ids are unique', () => {
    const ids = BUILDINGS.map((b) => b.id)
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('no two buildings overlap anywhere in the city', () => {
    const collisions: string[] = []
    for (let i = 0; i < boxes.length; i++) {
      for (let j = i + 1; j < boxes.length; j++) {
        if (overlaps(boxes[i], boxes[j])) collisions.push(`${boxes[i].id} × ${boxes[j].id}`)
      }
    }
    expect(collisions).toEqual([])
  })

  it('no building sits on any road', () => {
    const onRoad: string[] = []
    for (const box of boxes) {
      for (const road of roadRects) {
        if (overlaps(box, road)) onRoad.push(`${box.id} on ${road.id}`)
      }
    }
    expect(onRoad).toEqual([])
  })

  it('every gameplay building is fully inside the city bounds', () => {
    const outside = gameplayBuildings
      .map(buildingBox)
      .filter((box) => !insideBounds(box))
      .map((b) => b.id)
    expect(outside).toEqual([])
  })

  it('no solid prop spawns inside a building footprint', () => {
    const trapped: string[] = []
    for (const prop of PROPS) {
      if (!SOLID_PROP_TYPES.includes(prop.type)) continue
      for (const box of boxes) {
        if (
          prop.position[0] > box.minX &&
          prop.position[0] < box.maxX &&
          prop.position[1] > box.minZ &&
          prop.position[1] < box.maxZ
        ) {
          trapped.push(`${prop.id} inside ${box.id}`)
        }
      }
    }
    expect(trapped).toEqual([])
  })

  it('parked vehicles sit off the driving asphalt', () => {
    const onRoad: string[] = []
    for (const prop of PROPS) {
      if (prop.type !== 'parked_car' && prop.type !== 'parked_truck') continue
      for (const road of roadRects) {
        if (
          prop.position[0] > road.minX &&
          prop.position[0] < road.maxX &&
          prop.position[1] > road.minZ &&
          prop.position[1] < road.maxZ
        ) {
          onRoad.push(`${prop.id} on ${road.id}`)
        }
      }
    }
    expect(onRoad).toEqual([])
  })

  it('ambient cars spawn on valid lanes with no overlapping footprints', () => {
    const spawns = AMBIENT_CARS.map((def) => {
      const lane = LANES_BY_ID[def.laneId]
      expect(lane, `lane ${def.laneId} for ${def.id}`).toBeDefined()
      const [x, z] = lane.waypoints[def.startIndex]
      return { id: def.id, x, z }
    })
    // Conservative circle check (radius = car half-diagonal): any two spawn
    // centers closer than a car length could interpenetrate on frame one.
    const minGap = Math.hypot(CAR_HALF_LENGTH, CAR_HALF_WIDTH) * 2
    const tooClose: string[] = []
    for (let i = 0; i < spawns.length; i++) {
      for (let j = i + 1; j < spawns.length; j++) {
        const d = Math.hypot(spawns[i].x - spawns[j].x, spawns[i].z - spawns[j].z)
        if (d < minGap) tooClose.push(`${spawns[i].id} × ${spawns[j].id} (${d.toFixed(1)})`)
      }
    }
    expect(tooClose).toEqual([])
  })

  it('roads form a connected grid (every non-ring road touches another road)', () => {
    for (const road of roadRects) {
      if (road.id.startsWith('ring_')) continue
      const touchesAnother = roadRects.some(
        (other) =>
          other.id !== road.id &&
          road.minX <= other.maxX &&
          road.maxX >= other.minX &&
          road.minZ <= other.maxZ &&
          road.maxZ >= other.minZ,
      )
      expect(touchesAnother, `${road.id} is disconnected from the grid`).toBe(true)
    }
  })
})
