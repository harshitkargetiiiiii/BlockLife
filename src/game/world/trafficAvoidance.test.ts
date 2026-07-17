import { describe, expect, it } from 'vitest'
import {
  blockVelocityTowardCircle,
  isObstacleAhead,
  isObstacleNear,
  pushOutOfCircle,
} from './trafficAvoidance'

describe('trafficAvoidance', () => {
  it('isObstacleNear detects obstacles inside the radius only', () => {
    expect(isObstacleNear({ x: 0, z: 0 }, [{ x: 1, z: 1 }], 2)).toBe(true)
    expect(isObstacleNear({ x: 0, z: 0 }, [{ x: 3, z: 3 }], 2)).toBe(false)
    expect(isObstacleNear({ x: 0, z: 0 }, [], 2)).toBe(false)
  })

  it('isObstacleAhead only brakes for obstacles in front of the car', () => {
    // Car at origin heading +z (heading angle 0).
    const ahead = { x: 0, z: 3 }
    const behind = { x: 0, z: -3 }
    expect(isObstacleAhead({ x: 0, z: 0 }, 0, [ahead], 3, 1.5)).toBe(true)
    expect(isObstacleAhead({ x: 0, z: 0 }, 0, [behind], 3, 1.5)).toBe(false)
    // Same obstacle, car heading -z (heading angle PI): roles swap.
    expect(isObstacleAhead({ x: 0, z: 0 }, Math.PI, [behind], 3, 1.5)).toBe(true)
    expect(isObstacleAhead({ x: 0, z: 0 }, Math.PI, [ahead], 3, 1.5)).toBe(false)
  })

  it('blockVelocityTowardCircle removes only the inward component', () => {
    // Standing just east of a car, walking due west (straight at it).
    const blocked = blockVelocityTowardCircle(
      { x: 1.5, z: 0 },
      { x: -4, z: 0 },
      { x: 0, z: 0 },
      2,
    )
    expect(blocked.x).toBeCloseTo(0)
    expect(blocked.z).toBeCloseTo(0)
    // Walking away is untouched.
    const away = blockVelocityTowardCircle({ x: 1.5, z: 0 }, { x: 4, z: 0 }, { x: 0, z: 0 }, 2)
    expect(away).toEqual({ x: 4, z: 0 })
    // Outside the radius: untouched.
    const far = blockVelocityTowardCircle({ x: 5, z: 0 }, { x: -4, z: 0 }, { x: 0, z: 0 }, 2)
    expect(far).toEqual({ x: -4, z: 0 })
    // Sliding tangentially keeps the tangent component.
    const slide = blockVelocityTowardCircle(
      { x: 1.5, z: 0 },
      { x: -3, z: 3 },
      { x: 0, z: 0 },
      2,
    )
    expect(slide.x).toBeCloseTo(0)
    expect(slide.z).toBeCloseTo(3)
  })

  it('pushOutOfCircle nudges inside points out, capped per step', () => {
    expect(pushOutOfCircle({ x: 5, z: 0 }, { x: 0, z: 0 }, 2, 1)).toBeNull()
    const pushed = pushOutOfCircle({ x: 1, z: 0 }, { x: 0, z: 0 }, 2, 10)
    expect(pushed).toEqual({ x: 2, z: 0 })
    const capped = pushOutOfCircle({ x: 1, z: 0 }, { x: 0, z: 0 }, 2, 0.25)
    expect(capped!.x).toBeCloseTo(1.25)
    // Dead center still resolves to a stable direction.
    const center = pushOutOfCircle({ x: 0, z: 0 }, { x: 0, z: 0 }, 2, 0.5)
    expect(center!.x).toBeCloseTo(0.5)
  })
})
