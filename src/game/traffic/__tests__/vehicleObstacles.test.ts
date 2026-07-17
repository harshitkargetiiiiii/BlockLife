import { describe, expect, it } from 'vitest'
import {
  areVehicleFootprintsOverlapping,
  getVehicleObstacleAhead,
  hasEmergencyVehicleContact,
  CAR_HALF_LENGTH,
  CAR_HALF_WIDTH,
  type VehicleFootprint,
} from '../vehicleObstacles'

function car(overrides: Partial<VehicleFootprint>): VehicleFootprint {
  return {
    id: 'car',
    kind: 'ambient',
    position: { x: 0, z: 0 },
    heading: 0,
    halfLength: CAR_HALF_LENGTH,
    halfWidth: CAR_HALF_WIDTH,
    speed: 0,
    ...overrides,
  }
}

const opts = { lookAhead: 9, laneHalfWidth: 1.5, ownHalfLength: CAR_HALF_LENGTH }

describe('getVehicleObstacleAhead', () => {
  it('detects the driven car ahead in the same lane, measured to its near edge', () => {
    const driven = car({ id: 'driven', kind: 'driven', position: { x: 0, z: 7 } })
    const hit = getVehicleObstacleAhead({ x: 0, z: 0 }, 0, [driven], opts)
    expect(hit).not.toBeNull()
    expect(hit!.kind).toBe('driven')
    expect(hit!.distance).toBeCloseTo(7 - CAR_HALF_LENGTH)
  })

  it('ignores the driven car behind or far outside the corridor', () => {
    expect(
      getVehicleObstacleAhead(
        { x: 0, z: 0 },
        0,
        [car({ kind: 'driven', position: { x: 0, z: -7 } })],
        opts,
      ),
    ).toBeNull()
    expect(
      getVehicleObstacleAhead(
        { x: 0, z: 0 },
        0,
        [car({ kind: 'driven', position: { x: 6, z: 5 } })],
        opts,
      ),
    ).toBeNull()
  })

  it('sees a driven car parked ACROSS the lane by its true length', () => {
    // Sideways car (heading 90°): its half-LENGTH becomes lateral extent, so
    // even offset 2.5 from the corridor center it still blocks the lane.
    const sideways = car({ kind: 'driven', position: { x: 2.5, z: 6 }, heading: Math.PI / 2 })
    expect(getVehicleObstacleAhead({ x: 0, z: 0 }, 0, [sideways], opts)).not.toBeNull()
    // The same offset with a parallel car is outside the corridor.
    const parallel = car({ kind: 'driven', position: { x: 2.9, z: 6 }, heading: 0 })
    expect(getVehicleObstacleAhead({ x: 0, z: 0 }, 0, [parallel], opts)).toBeNull()
  })

  it('skips oncoming/perpendicular ambient cars (emergency check covers those)', () => {
    const oncoming = car({ position: { x: 0, z: 6 }, heading: Math.PI })
    expect(getVehicleObstacleAhead({ x: 0, z: 0 }, 0, [oncoming], opts)).toBeNull()
    const driven = car({ kind: 'driven', position: { x: 0, z: 6 }, heading: Math.PI })
    expect(getVehicleObstacleAhead({ x: 0, z: 0 }, 0, [driven], opts)).not.toBeNull()
  })

  it('breaks corner deadlocks: lower id ignores a stopped diagonal ambient blocker', () => {
    // Two cars converging on a turn, both stopped, each diagonally "ahead"
    // of the other — without a tiebreak they wait on each other forever.
    const diagonal = car({ id: 'car_b', position: { x: 2.5, z: 5 }, heading: Math.PI / 4, speed: 0 })
    // Winner (lower id) ignores it and proceeds…
    expect(
      getVehicleObstacleAhead({ x: 0, z: 0 }, 0, [diagonal], { ...opts, selfId: 'car_a' }),
    ).toBeNull()
    // …the loser keeps waiting…
    expect(
      getVehicleObstacleAhead({ x: 0, z: 0 }, 0, [diagonal], { ...opts, selfId: 'car_c' }),
    ).not.toBeNull()
    // …and a MOVING diagonal car is never ignored by anyone.
    const rolling = car({ id: 'car_b', position: { x: 2.5, z: 5 }, heading: Math.PI / 4, speed: 3 })
    expect(
      getVehicleObstacleAhead({ x: 0, z: 0 }, 0, [rolling], { ...opts, selfId: 'car_a' }),
    ).not.toBeNull()
    // Same-lane queues are untouched: a stopped parallel car ahead still blocks.
    const queued = car({ id: 'car_b', position: { x: 0, z: 6 }, heading: 0, speed: 0 })
    expect(
      getVehicleObstacleAhead({ x: 0, z: 0 }, 0, [queued], { ...opts, selfId: 'car_a' }),
    ).not.toBeNull()
  })
})

describe('footprint overlap (SAT)', () => {
  it('front/rear: overlapping when closer than two half-lengths', () => {
    const a = car({ id: 'a' })
    expect(areVehicleFootprintsOverlapping(a, car({ id: 'b', position: { x: 0, z: 3.5 } }))).toBe(true)
    expect(areVehicleFootprintsOverlapping(a, car({ id: 'b', position: { x: 0, z: 4.2 } }))).toBe(false)
  })

  it('side-by-side: overlapping when closer than two half-widths', () => {
    const a = car({ id: 'a' })
    expect(areVehicleFootprintsOverlapping(a, car({ id: 'b', position: { x: 1.8, z: 0 } }))).toBe(true)
    expect(areVehicleFootprintsOverlapping(a, car({ id: 'b', position: { x: 2.2, z: 0 } }))).toBe(false)
  })

  it('rotated footprints use their true oriented extents', () => {
    const a = car({ id: 'a' })
    // A perpendicular car at x=2.6: its half-length (1.95) reaches across.
    const t = car({ id: 'b', position: { x: 2.6, z: 0 }, heading: Math.PI / 2 })
    expect(areVehicleFootprintsOverlapping(a, t)).toBe(true)
    expect(
      areVehicleFootprintsOverlapping(a, car({ id: 'b', position: { x: 4.2, z: 0 }, heading: Math.PI / 2 })),
    ).toBe(false)
  })

  it('emergency contact ignores self and respects the inflation margin', () => {
    const self = car({ id: 'self' })
    expect(hasEmergencyVehicleContact(self, [self])).toBe(false)
    expect(
      hasEmergencyVehicleContact(self, [car({ id: 'b', position: { x: 0, z: 4.0 } })]),
    ).toBe(true) // 4.0 < 3.9 + inflation
    expect(
      hasEmergencyVehicleContact(self, [car({ id: 'b', position: { x: 0, z: 4.5 } })]),
    ).toBe(false)
  })

  it('emergency contact is directional: rear-bumper contact never freezes the car', () => {
    const self = car({ id: 'self' }) // heading +z
    // Same touching distance, but BEHIND the midline: driving forward clears
    // it, so it must not freeze (this was the permanent corner deadlock).
    expect(
      hasEmergencyVehicleContact(self, [car({ id: 'b', position: { x: 0, z: -4.0 } })]),
    ).toBe(false)
    // The corner scenario: a perpendicular car touching the rear flank.
    const flank = car({ id: 'b', position: { x: -2.5, z: -1.5 }, heading: Math.PI / 2 })
    expect(hasEmergencyVehicleContact(self, [flank])).toBe(false)
    // The same car ahead of the midline still freezes.
    const ahead = car({ id: 'b', position: { x: -2.5, z: 1.5 }, heading: Math.PI / 2 })
    expect(hasEmergencyVehicleContact(self, [ahead])).toBe(true)
  })
})
