import { describe, expect, it } from 'vitest'
import { approach, dampFactor, lerpAngle, shortestAngleDelta } from './math'

describe('math utils', () => {
  it('shortestAngleDelta wraps across the PI boundary', () => {
    expect(shortestAngleDelta(Math.PI * 0.9, -Math.PI * 0.9)).toBeCloseTo(Math.PI * 0.2)
    expect(shortestAngleDelta(-Math.PI * 0.9, Math.PI * 0.9)).toBeCloseTo(-Math.PI * 0.2)
    expect(shortestAngleDelta(0, 1)).toBeCloseTo(1)
  })

  it('lerpAngle moves along the shortest arc and clamps t', () => {
    expect(lerpAngle(0, Math.PI / 2, 0.5)).toBeCloseTo(Math.PI / 4)
    expect(lerpAngle(0, Math.PI / 2, 5)).toBeCloseTo(Math.PI / 2)
    expect(lerpAngle(Math.PI * 0.9, -Math.PI * 0.9, 1)).toBeCloseTo(Math.PI * 1.1)
  })

  it('dampFactor grows with dt and stays in [0, 1)', () => {
    expect(dampFactor(5, 0.016)).toBeGreaterThan(0)
    expect(dampFactor(5, 0.016)).toBeLessThan(dampFactor(5, 0.1))
    expect(dampFactor(5, 10)).toBeLessThanOrEqual(1)
  })

  it('approach never overshoots', () => {
    expect(approach(0, 10, 3)).toBe(3)
    expect(approach(9, 10, 3)).toBe(10)
    expect(approach(10, 0, 4)).toBe(6)
  })
})
