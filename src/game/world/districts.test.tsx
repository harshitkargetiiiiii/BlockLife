import { describe, expect, it } from 'vitest'
import ReactThreeTestRenderer from '@react-three/test-renderer'
import { vi } from 'vitest'
import { CITY_BOUNDS, getDistrict } from './cityLayout'
import { isPointClear } from './collisionQuery'
import {
  CROSSWALKS,
  LANES_BY_ID,
  ROAD_LANES,
  SIDEWALK_PATHS,
  STOP_LINES,
  STOP_SIGNS,
  TRAFFIC_SIGNAL,
} from '../traffic/trafficData'
import { pointInZone } from '../traffic/crosswalkUtils'
import { TEST_LOCATIONS } from '../test/gameTestApi'
import { CityBlock } from './CityBlock'

// jsdom can't fetch GLBs; fall back to procedural everywhere.
vi.mock('@react-three/drei', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useGLTF: () => {
    throw new Error('no GLB loading in unit tests')
  },
}))
vi.spyOn(console, 'warn').mockImplementation(() => {})
vi.spyOn(console, 'error').mockImplementation(() => {})

describe('city expansion data', () => {
  it('classifies districts by position (six blocks in v2)', () => {
    expect(getDistrict(0, 0)).toBe('central')
    expect(getDistrict(-2, -45)).toBe('residential')
    expect(getDistrict(48, 6)).toBe('industrial')
    expect(getDistrict(30, -50)).toBe('residential') // north wins over east
    // City Expansion v2 blocks:
    expect(getDistrict(-48, 0)).toBe('residential_west')
    expect(getDistrict(0, 48)).toBe('residential_south')
    expect(getDistrict(48, -30)).toBe('industrial_north')
    expect(getDistrict(59.5, -42)).toBe('industrial_north') // freight warehouses
  })

  it('road lanes are well-formed and inside the city bounds', () => {
    expect(ROAD_LANES.map((l) => l.id)).toEqual([
      'lane_inner_cw',
      'lane_outer_ccw',
      'lane_residential',
      'lane_industrial',
      'lane_residential_west',
      'lane_residential_south',
      'lane_industrial_north',
    ])
    for (const lane of ROAD_LANES) {
      expect(lane.waypoints.length).toBeGreaterThanOrEqual(2)
      expect(lane.speedLimit).toBeGreaterThan(0)
      expect(lane.stopDistance).toBeLessThan(lane.slowDistance)
      for (const [x, z] of lane.waypoints) {
        expect(x).toBeGreaterThan(CITY_BOUNDS.minX)
        expect(x).toBeLessThan(CITY_BOUNDS.maxX)
        expect(z).toBeGreaterThan(CITY_BOUNDS.minZ)
        expect(z).toBeLessThan(CITY_BOUNDS.maxZ)
      }
    }
  })

  it('crosswalks have unique ids, valid lanes and wait spots outside the zone', () => {
    const ids = CROSSWALKS.map((c) => c.id)
    expect(new Set(ids).size).toBe(ids.length)
    expect(ids).toContain('crosswalk_residential')
    expect(ids).toContain('crosswalk_industrial')
    for (const cw of CROSSWALKS) {
      for (const laneId of cw.affectedLaneIds) {
        expect(LANES_BY_ID[laneId], `${cw.id} references ${laneId}`).toBeDefined()
      }
      for (const spot of cw.waitSpots) {
        expect(
          pointInZone({ x: spot[0], z: spot[1] }, cw),
          `${cw.id} wait spot inside its own zone`,
        ).toBe(false)
      }
    }
  })

  it('stop signs and signal stop lines reference real lanes', () => {
    for (const sign of STOP_SIGNS) {
      expect(LANES_BY_ID[sign.laneId]).toBeDefined()
      expect(sign.holdSeconds).toBeGreaterThan(0)
    }
    for (const line of STOP_LINES) {
      expect(LANES_BY_ID[line.laneId]).toBeDefined()
    }
    // The shared signal now also governs the industrial strip.
    expect(TRAFFIC_SIGNAL.controlledLaneIds).toContain('lane_industrial')
    expect(TRAFFIC_SIGNAL.controlledCrosswalkIds).toContain('crosswalk_industrial')
  })

  it('sidewalk paths cover both new districts', () => {
    const ids = SIDEWALK_PATHS.map((p) => p.id)
    expect(ids).toContain('sidewalk_residential_loop')
    expect(ids).toContain('sidewalk_industrial_loop')
  })

  it('every named test location exists, is in-bounds and stands clear', () => {
    const names = Object.keys(TEST_LOCATIONS)
    for (const name of [
      'central_plaza',
      'residential_street',
      'residential_crosswalk',
      'industrial_strip',
      'warehouse_or_garage',
      'long_road_test',
      'traffic_light_test',
      'parking_lot_test',
      'residential_west_street',
      'residential_south_street',
      'industrial_north_strip',
    ]) {
      expect(names, `missing test location ${name}`).toContain(name)
      const [x, , z] = TEST_LOCATIONS[name]
      expect(isPointClear(x, z, 0.4), `${name} at ${x},${z} is blocked`).toBe(true)
    }
  })
})

describe('district visuals (R3F)', () => {
  it('CityBlock renders the new district landmarks and street furniture', async () => {
    const renderer = await ReactThreeTestRenderer.create(<CityBlock />)
    for (const name of [
      'district-residential',
      'district-industrial',
      'district-connector-north',
      'district-connector-east',
      'district-residential-west',
      'district-residential-south',
      'district-industrial-north',
      'district-connector-west',
      'district-connector-south',
      'building_townhomes_01',
      'building_warehouse_01',
      'building_garage_01',
      'building_house_r1',
      'building_market_01',
      'building_house_w1',
      'building_house_s1',
      'building_warehouse_n1',
      'building_factory_n1',
      'building_commons_w1',
      'building_deli_s1',
      'loading-zone',
    ]) {
      expect(
        renderer.scene.findAll((n) => n.props.name === name).length,
        `expected ${name}`,
      ).toBeGreaterThan(0)
    }
    // Stop signs + third traffic light are present.
    expect(
      renderer.scene.findAll((n) => String(n.props.name ?? '').startsWith('prop_stop_sign'))
        .length,
    ).toBe(2)
    expect(renderer.scene.findAll((n) => n.props.name === 'traffic-light').length).toBe(3)
    await renderer.unmount()
  })
})
