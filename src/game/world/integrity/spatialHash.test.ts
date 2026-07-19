import { describe, expect, it } from 'vitest'
import { SpatialHash } from './spatialHash'

describe('SpatialHash', () => {
  it('finds neighbours within radius and excludes self + far entries', () => {
    const h = new SpatialHash(4)
    h.insert('a', 0, 0)
    h.insert('b', 1, 0) // within
    h.insert('c', 0, 1.5) // within
    h.insert('far', 50, 50) // outside
    const ids = h.queryNeighbours(0, 0, 2, 'a').map((e) => e.id).sort()
    expect(ids).toEqual(['b', 'c'])
  })

  it('respects an exact radius boundary (inclusive)', () => {
    const h = new SpatialHash(4)
    h.insert('edge', 2, 0)
    expect(h.queryNeighbours(0, 0, 2).map((e) => e.id)).toEqual(['edge'])
    expect(h.queryNeighbours(0, 0, 1.99)).toEqual([])
  })

  it('finds neighbours across cell boundaries', () => {
    const h = new SpatialHash(1) // tiny cells force cross-cell fan-out
    h.insert('a', 0.9, 0.9)
    h.insert('b', 1.1, 1.1)
    expect(h.queryNeighbours(0.9, 0.9, 1, 'a').map((e) => e.id)).toEqual(['b'])
  })

  it('is deterministic in result order (insertion order within scan)', () => {
    const build = () => {
      const h = new SpatialHash(4)
      h.insert('x1', 0.1, 0)
      h.insert('x2', 0.2, 0)
      h.insert('x3', 0.3, 0)
      return h.queryNeighbours(0, 0, 5).map((e) => e.id)
    }
    expect(build()).toEqual(build())
  })

  it('handles negative coordinates without key collisions', () => {
    const h = new SpatialHash(4)
    h.insert('neg', -100, -100)
    h.insert('pos', 100, 100)
    expect(h.queryNeighbours(-100, -100, 3).map((e) => e.id)).toEqual(['neg'])
    expect(h.queryNeighbours(100, 100, 3).map((e) => e.id)).toEqual(['pos'])
  })

  it('clear() empties the index and size() counts entries', () => {
    const h = new SpatialHash()
    h.insert('a', 0, 0)
    h.insert('b', 1, 1)
    expect(h.size).toBe(2)
    h.clear()
    expect(h.size).toBe(0)
    expect(h.queryNeighbours(0, 0, 100)).toEqual([])
  })
})
