import { describe, expect, it } from 'vitest'
import { findClearExitPosition, isPointClear, STATIC_FOOTPRINTS } from './collisionQuery'
import { BUILDINGS, CAR_SPAWN, CAR_SPAWN_ROTATION_Y, CITY_BOUNDS } from './cityLayout'

describe('collisionQuery', () => {
  it('derives one footprint per building plus trucks/kiosk/parked cars', () => {
    expect(STATIC_FOOTPRINTS.length).toBeGreaterThanOrEqual(BUILDINGS.length + 2)
  })

  it('open plaza is clear, building interiors are not', () => {
    expect(isPointClear(0, 0)).toBe(true)
    const gym = BUILDINGS.find((b) => b.id === 'building_gym_01')!
    expect(isPointClear(gym.position[0], gym.position[1])).toBe(false)
  })

  it('points outside the world walls are not clear', () => {
    expect(isPointClear(CITY_BOUNDS.maxX + 2, 0)).toBe(false)
    expect(isPointClear(CITY_BOUNDS.minX - 2, 0)).toBe(false)
    expect(isPointClear(0, CITY_BOUNDS.minZ - 2)).toBe(false)
    // The new districts are inside the walls.
    expect(isPointClear(0, -45)).toBe(true) // residential road
    expect(isPointClear(48, 4)).toBe(true) // industrial strip
  })

  it('exit from the parking spawn lands in a clear spot', () => {
    const [x, z] = findClearExitPosition(CAR_SPAWN[0], CAR_SPAWN[2], CAR_SPAWN_ROTATION_Y)
    expect(isPointClear(x, z)).toBe(true)
  })

  it('skips a blocked side and picks the next clear candidate', () => {
    // Car parked right against the gym's west wall, facing north: the east
    // side (+x, passenger) is clear, but park it so that side is the wall.
    const gym = BUILDINGS.find((b) => b.id === 'building_gym_01')!
    const westWallX = gym.position[0] - gym.size[0] / 2
    // Facing north (heading PI): right side points to -x... place the car so
    // its first candidate (right side) is inside the gym.
    const carX = westWallX - 1.4
    const carZ = gym.position[1]
    const heading = 0 // facing +z, right side = +x → into the gym wall
    const [x, z] = findClearExitPosition(carX, carZ, heading)
    expect(isPointClear(x, z)).toBe(true)
    expect(x).toBeLessThan(carX + 2) // did not exit into the wall side
  })
})
