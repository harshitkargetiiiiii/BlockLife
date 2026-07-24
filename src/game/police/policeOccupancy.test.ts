import { beforeEach, describe, expect, it } from 'vitest'
import type { Vec2 } from '../world/worldTypes'
import { registry } from '../world/runtimeRegistry'
import { collectSolidFootprints } from '../world/solidFootprints'
import { resetLiveObstacles } from '../world/integrity/liveObstacles'
import { pushCircleOutOfOrientedBox } from '../world/integrity/occupancy'
import type { OrientedBox2D } from '../world/integrity/entityTypes'
import { trafficRuntime } from '../traffic/trafficRuntime'
import { policeRuntime } from './policeRuntime'
import type { PoliceUnit } from './policeTypes'
import { resolvePoliceOccupancy } from './policeOccupancy'

function officer(id: string, x: number, z: number): PoliceUnit {
  return {
    id,
    kind: 'officer',
    state: 'pursuing_on_foot',
    incidentId: 'inc',
    target: null,
    position: [x, z],
    heading: 0,
    health: 100,
    spawnedAt: 0,
    seesSuspect: true,
    arrestTimer: 0,
    timeSinceSeen: 0,
    lastShotAt: 0,
  }
}
function insideBox(x: number, z: number, r: number, box: OrientedBox2D): boolean {
  const [nx, nz] = pushCircleOutOfOrientedBox(x, z, r, box)
  return nx !== x || nz !== z
}
const dist = (a: Vec2, b: Vec2) => Math.hypot(a[0] - b[0], a[1] - b[1])

describe('resolvePoliceOccupancy — officers routed through the shared occupancy contract', () => {
  beforeEach(() => {
    resetLiveObstacles()
    policeRuntime.units.clear()
    registry.npcPositions.clear()
    registry.movingPersonIds.clear()
    trafficRuntime.cars.clear()
    registry.frameCount = 1
    registry.playerPosition.set(9999, 0, 9999)
  })

  it('does nothing with no officers (and never throws)', () => {
    expect(() => resolvePoliceOccupancy(0.05)).not.toThrow()
  })

  it('separates a converging cluster of officers (police↔police)', () => {
    // Two officers stacked on one suspect point in open space, far from solids.
    policeRuntime.units.set('police_0', officer('police_0', 5000, 5000))
    policeRuntime.units.set('police_1', officer('police_1', 5000.1, 5000))
    for (let i = 0; i < 40; i++) resolvePoliceOccupancy(0.05)
    const a = policeRuntime.units.get('police_0')!.position
    const b = policeRuntime.units.get('police_1')!.position
    expect(dist(a, b)).toBeGreaterThan(0.6) // opened toward the 0.72 personal space
  })

  it('clamps an officer embedded in a building out of it (solid clamp)', () => {
    const building = collectSolidFootprints().find((s) => s.source === 'building')!
    const box: OrientedBox2D = {
      x: building.position.x,
      z: building.position.z,
      halfLength: building.halfLength,
      halfWidth: building.halfWidth,
      headingY: building.heading,
    }
    policeRuntime.units.set('police_0', officer('police_0', building.position.x, building.position.z))
    resolvePoliceOccupancy(0.05)
    const p = policeRuntime.units.get('police_0')!.position
    expect(insideBox(p[0], p[1], 0.36, box)).toBe(false)
  })

  it('clamps an officer standing on a car off it (vehicle clamp, off-path)', () => {
    trafficRuntime.cars.set('car1', { id: 'car1', x: 6000, z: 6000, heading: 0.4, speed: 2 } as never)
    const box: OrientedBox2D = { x: 6000, z: 6000, halfLength: 1.95, halfWidth: 1.0, headingY: 0.4 }
    policeRuntime.units.set('police_0', officer('police_0', 6000, 6000))
    resolvePoliceOccupancy(0.05)
    const p = policeRuntime.units.get('police_0')!.position
    expect(insideBox(p[0], p[1], 0.36, box)).toBe(false)
  })

  it('pushes an officer off a co-located citizen (shared spacing vs npcPositions)', () => {
    registry.npcPositions.set('cit_x', { x: 7000, z: 7000 } as never)
    registry.movingPersonIds.add('cit_x')
    policeRuntime.units.set('police_0', officer('police_0', 7000.05, 7000))
    for (let i = 0; i < 40; i++) resolvePoliceOccupancy(0.05)
    const p = policeRuntime.units.get('police_0')!.position
    expect(dist(p, [7000, 7000])).toBeGreaterThan(0.5) // officer yielded away from the citizen
  })
})
