import { describe, expect, it } from 'vitest'
import type { Footprint2D, OrientedBox2D } from './entityTypes'
import {
  type Occupant,
  personSpacingDisplacement,
  pushCircleOutOfAabb,
  pushCircleOutOfOrientedBox,
  resolveOccupant,
} from './occupancy'

const box: Footprint2D = { minX: -1, maxX: 1, minZ: -1, maxZ: 1 }
const opts = { dt: 1 / 60 }

function inAabb(x: number, z: number, r: number, b: Footprint2D): boolean {
  const cx = Math.max(b.minX, Math.min(x, b.maxX))
  const cz = Math.max(b.minZ, Math.min(z, b.maxZ))
  const dx = x - cx
  const dz = z - cz
  return dx * dx + dz * dz < r * r - 1e-9
}

describe('pushCircleOutOfAabb', () => {
  it('leaves a circle fully outside untouched', () => {
    expect(pushCircleOutOfAabb(5, 5, 0.35, box)).toEqual([5, 5])
  })

  it('pushes an overlapping circle to exactly touching', () => {
    const [x, z] = pushCircleOutOfAabb(1.2, 0, 0.35, box) // penetrating +x face
    expect(x).toBeCloseTo(1.35, 5)
    expect(z).toBe(0)
    expect(inAabb(x, z, 0.35, box)).toBe(false)
  })

  it('exits along the least-penetration axis when the centre is inside', () => {
    // Centre near the +x face → should exit +x, not through a far face.
    const [x, z] = pushCircleOutOfAabb(0.8, 0, 0.35, box)
    expect(x).toBeCloseTo(1.35, 5)
    expect(z).toBe(0)
  })
})

describe('pushCircleOutOfOrientedBox', () => {
  const axis: OrientedBox2D = { x: 0, z: 0, halfLength: 2, halfWidth: 1, headingY: 0 }

  it('reduces to an AABB when heading is 0', () => {
    const [x] = pushCircleOutOfOrientedBox(1.1, 0, 0.35, axis) // +x = width face
    expect(x).toBeCloseTo(1.35, 5)
  })

  it('excludes a point that is only inside once rotation is considered', () => {
    // Rotate the long (length=2) axis to lie along x. A point at (1.5,0) is now
    // inside the long side (was outside the width side before rotation).
    const rot: OrientedBox2D = { x: 0, z: 0, halfLength: 2, halfWidth: 1, headingY: Math.PI / 2 }
    const [x, z] = pushCircleOutOfOrientedBox(1.5, 0, 0.35, rot)
    // Must be pushed clear of the oriented footprint.
    const cos = Math.cos(rot.headingY)
    const sin = Math.sin(rot.headingY)
    const lx = x * cos - z * sin
    const lz = x * sin + z * cos
    expect(inAabb(lx, lz, 0.35, { minX: -1, maxX: 1, minZ: -2, maxZ: 2 })).toBe(false)
  })
})

describe('personSpacingDisplacement (movement priority)', () => {
  const near = (moving: boolean): Occupant => ({ id: 'o', x: 0.4, z: 0, radius: 0.35, moving })

  it('two movers each take half the correction', () => {
    const self: Occupant = { id: 's', x: 0, z: 0, radius: 0.35, moving: true }
    const [dx] = personSpacingDisplacement(self, [near(true)], { dt: 1 })
    // overlap = 0.7 - 0.4 = 0.3; half = 0.15, pushing self in -x
    expect(dx).toBeCloseTo(-0.15, 5)
  })

  it('a mover yields fully around a stationary person (default)', () => {
    const self: Occupant = { id: 's', x: 0, z: 0, radius: 0.35, moving: true }
    const [dx] = personSpacingDisplacement(self, [near(false)], { dt: 1 })
    expect(dx).toBeCloseTo(-0.3, 5) // full overlap
  })

  it('a mover does NOT yield around an idler when yieldAroundStationary is false (trip-safe)', () => {
    const self: Occupant = { id: 's', x: 0, z: 0, radius: 0.35, moving: true }
    // The live BlockLife path uses this so a walker can reach a destination that
    // legitimately sits beside an idle citizen without being stranded.
    expect(
      personSpacingDisplacement(self, [near(false)], { dt: 1, yieldAroundStationary: false }),
    ).toEqual([0, 0])
  })

  it('a stationary person is NOT shoved by a passing mover', () => {
    const self: Occupant = { id: 's', x: 0, z: 0, radius: 0.35, moving: false }
    expect(personSpacingDisplacement(self, [near(true)], { dt: 1 })).toEqual([0, 0])
  })

  it('two stationary overlapping people are repaired symmetrically (half each)', () => {
    const self: Occupant = { id: 's', x: 0, z: 0, radius: 0.35, moving: false }
    const [dx] = personSpacingDisplacement(self, [near(false)], { dt: 1 })
    expect(dx).toBeCloseTo(-0.15, 5)
  })

  it('caps the total nudge below walk speed in a dense cluster', () => {
    const self: Occupant = { id: 's', x: 0, z: 0, radius: 0.35, moving: true }
    const crowd: Occupant[] = [
      { id: 'a', x: 0.1, z: 0, radius: 0.35, moving: true },
      { id: 'b', x: -0.1, z: 0.05, radius: 0.35, moving: true },
      { id: 'c', x: 0, z: 0.1, radius: 0.35, moving: true },
    ]
    const [dx, dz] = personSpacingDisplacement(self, crowd, { dt: 1 / 60, maxSpacingPerSecond: 1.2 })
    expect(Math.hypot(dx, dz)).toBeLessThanOrEqual(1.2 / 60 + 1e-9)
  })
})

describe('resolveOccupant (full ordered contract)', () => {
  const self: Occupant = { id: 's', x: 0, z: 0, radius: 0.35, moving: true }

  it('never leaves a person inside a vehicle footprint', () => {
    const veh: OrientedBox2D = { x: 0, z: 0, halfLength: 2, halfWidth: 1, headingY: 0 }
    const [x, z] = resolveOccupant(self, [], [veh], [], opts)
    const lx = x
    const lz = z
    expect(inAabb(lx, lz, 0.35, { minX: -1, maxX: 1, minZ: -2, maxZ: 2 })).toBe(false)
  })

  it('never leaves a person inside a solid — the mandatory final clamp', () => {
    // A person spacing push would shove self INTO a wall; the final solid clamp
    // must still evict them.
    const wall: Footprint2D = { minX: -0.3, maxX: 5, minZ: -5, maxZ: 5 }
    const pusher: Occupant = { id: 'p', x: -0.5, z: 0, radius: 0.35, moving: false }
    const [x, z] = resolveOccupant({ ...self, moving: true }, [pusher], [], [wall], opts)
    expect(inAabb(x, z, 0.35, wall)).toBe(false)
  })

  it('resolves vehicle THEN solid so a car push cannot end inside a wall', () => {
    const veh: OrientedBox2D = { x: 0.5, z: 0, halfLength: 1, halfWidth: 1, headingY: 0 }
    const wall: Footprint2D = { minX: -5, maxX: -0.5, minZ: -5, maxZ: 5 }
    const [x, z] = resolveOccupant(self, [], [veh], [wall], opts)
    expect(inAabb(x, z, 0.35, wall)).toBe(false)
  })

  it('is deterministic and returns a finite position', () => {
    const veh: OrientedBox2D = { x: 0.2, z: 0.1, halfLength: 2, halfWidth: 1, headingY: 0.6 }
    const run = () => resolveOccupant(self, [], [veh], [box], opts)
    const a = run()
    const b = run()
    expect(a).toEqual(b)
    expect(Number.isFinite(a[0]) && Number.isFinite(a[1])).toBe(true)
  })
})
