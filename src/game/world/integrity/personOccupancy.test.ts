import { beforeEach, describe, expect, it } from 'vitest'
import type { Vec2 } from '../worldTypes'
import { registry } from '../runtimeRegistry'
import { collectSolidFootprints } from '../solidFootprints'
import { findClearPlayerSpawn, getNearbySolids, resetLiveObstacles } from './liveObstacles'
import { pushCircleOutOfOrientedBox } from './occupancy'
import { resolvePersonOccupancy } from './personOccupancy'
import { trafficRuntime } from '../../traffic/trafficRuntime'
import type { OrientedBox2D } from './entityTypes'

function toBox(s: ReturnType<typeof collectSolidFootprints>[number]): OrientedBox2D {
  return { x: s.position.x, z: s.position.z, halfLength: s.halfLength, halfWidth: s.halfWidth, headingY: s.heading }
}
function insideBox(x: number, z: number, r: number, box: OrientedBox2D): boolean {
  const [nx, nz] = pushCircleOutOfOrientedBox(x, z, r, box)
  return nx !== x || nz !== z
}

describe('live obstacles + person occupancy', () => {
  beforeEach(() => {
    resetLiveObstacles()
    registry.npcPositions.clear()
    registry.movingPersonIds.clear()
    trafficRuntime.cars.clear()
    registry.frameCount = 1
    registry.playerPosition.set(9999, 0, 9999)
  })

  it('getNearbySolids finds a solid at its centre and nothing in open space', () => {
    const solid = collectSolidFootprints()[0]
    const near: OrientedBox2D[] = []
    getNearbySolids(solid.position.x, solid.position.z, 1, near)
    expect(near.length).toBeGreaterThan(0)
    const far: OrientedBox2D[] = []
    getNearbySolids(99999, 99999, 1, far)
    expect(far.length).toBe(0)
  })

  it('MANDATORY solid clamp ejects a person from a building footprint', () => {
    const building = collectSolidFootprints().find((s) => s.source === 'building')!
    const box = toBox(building)
    const pos: Vec2 = [building.position.x, building.position.z] // dead centre
    expect(insideBox(pos[0], pos[1], 0.36, box)).toBe(true) // starts embedded
    resolvePersonOccupancy(pos, 'p', 1 / 60, false)
    expect(insideBox(pos[0], pos[1], 0.36, box)).toBe(false) // clamped out
  })

  it('leaves a person in open space untouched (no phantom pushes)', () => {
    // A point far from every solid, no neighbours, no cars, player parked away.
    const pos: Vec2 = [99999, 99999]
    resolvePersonOccupancy(pos, 'p', 1 / 60, true)
    expect(pos).toEqual([99999, 99999])
  })

  it('SKIPS the vehicle/solid clamps for an on-path walker (trusts its route)', () => {
    // An on-path walker (onPath=true) already avoids cars via the pedestrian
    // crossing logic and follows a route validated clear of solids, so the hard
    // clamps are skipped — clamping every frame would fight its crossings/trip.
    const building = collectSolidFootprints().find((s) => s.source === 'building')!
    const pos: Vec2 = [building.position.x, building.position.z] // dead centre
    resolvePersonOccupancy(pos, 'p', 1 / 60, true, /* onPath */ true)
    expect(pos).toEqual([building.position.x, building.position.z]) // NOT clamped
  })

  it('pushes a person off the on-foot player', () => {
    registry.playerPosition.set(0, 0, 0)
    const pos: Vec2 = [0.3, 0] // standing on the player
    resolvePersonOccupancy(pos, 'p', 1 / 60, false)
    expect(Math.hypot(pos[0], pos[1])).toBeGreaterThan(0.8) // pushed clear (~0.85)
  })

  it('HARD vehicle clamp ejects a person standing on a car', () => {
    // A car in open space (far from any solid) so only the vehicle clamp acts.
    trafficRuntime.cars.set('car1', { id: 'car1', x: 5000, z: 5000, heading: 0.7, speed: 3 } as never)
    const box: OrientedBox2D = { x: 5000, z: 5000, halfLength: 1.95, halfWidth: 1.0, headingY: 0.7 }
    const pos: Vec2 = [5000, 5000] // dead centre of the car
    resolvePersonOccupancy(pos, 'p', 1 / 60, false)
    expect(insideBox(pos[0], pos[1], 0.36, box)).toBe(false) // clamped off the car
  })

  it('findClearPlayerSpawn clears a spawn embedded in a building', () => {
    const building = collectSolidFootprints().find((s) => s.source === 'building')!
    const box = toBox(building)
    const [x, z] = findClearPlayerSpawn(building.position.x, building.position.z)
    expect(insideBox(x, z, 0.5, box)).toBe(false) // spawn nudged out of the solid
  })

  it('findClearPlayerSpawn clears a spawn on top of a citizen', () => {
    registry.npcPositions.set('c', { x: 6000, z: 6000 } as never)
    const [x, z] = findClearPlayerSpawn(6000, 6000)
    expect(Math.hypot(x - 6000, z - 6000)).toBeGreaterThan(0.7) // not on the citizen
  })
})
