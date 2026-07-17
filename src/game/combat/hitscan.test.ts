import { describe, expect, it } from 'vitest'
import { BUILDINGS } from '../world/cityLayout'
import { invalidateBlockerCache } from '../crime/lineOfSight'
import { resolveHitscan, type HitscanTarget } from './hitscan'

function target(id: string, position: [number, number], kind: 'citizen' | 'police' = 'citizen'): HitscanTarget {
  return { id, position, radius: 0.5, kind }
}

// Open ground far outside the city so no real building/prop is on the ray —
// isolates the ray-circle geometry. Wall-blocking is covered separately.
const OX = 1000
const OZ = 1000

describe('hitscan', () => {
  it('hits a target straight ahead and reports the entry distance', () => {
    const r = resolveHitscan([OX, OZ], [0, 1], 34, [target('a', [OX, OZ + 20])])
    expect(r.hit).toBe(true)
    expect(r.targetId).toBe('a')
    expect(r.distance).toBeCloseTo(19.5, 1)
    expect(r.blockedByWall).toBe(false)
  })

  it('misses an off-axis target', () => {
    const r = resolveHitscan([OX, OZ], [0, 1], 34, [target('a', [OX + 8, OZ + 20])])
    expect(r.hit).toBe(false)
  })

  it('does not reach beyond the weapon range', () => {
    const r = resolveHitscan([OX, OZ], [0, 1], 10, [target('a', [OX, OZ + 20])])
    expect(r.hit).toBe(false)
    expect(r.distance).toBe(10)
  })

  it('strikes the nearest of several in-line targets', () => {
    const r = resolveHitscan([OX, OZ], [0, 1], 40, [
      target('far', [OX, OZ + 30]),
      target('near', [OX, OZ + 15]),
    ])
    expect(r.hit).toBe(true)
    expect(r.targetId).toBe('near')
  })

  it('a building blocks the shot (LOS)', () => {
    invalidateBlockerCache()
    const b = BUILDINGS[0]
    const [bx, bz] = b.position
    const halfW = b.size[0] / 2
    // Fire from well left of the building, straight through it (+x) at a
    // target hidden on the far side.
    const origin: [number, number] = [bx - halfW - 6, bz]
    const hidden = target('behind', [bx + halfW + 3, bz])
    const r = resolveHitscan(origin, [1, 0], 40, [hidden])
    expect(r.hit).toBe(false)
    expect(r.blockedByWall).toBe(true)
  })
})
