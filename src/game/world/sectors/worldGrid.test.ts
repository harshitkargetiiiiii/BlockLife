import { describe, expect, it } from 'vitest'
import {
  GRID_ORIGIN_X,
  GRID_ORIGIN_Z,
  SECTOR_SIZE,
  getNeighborSectorIds,
  getSectorBounds,
  getSectorDistance,
  getSectorsIntersectingBounds,
  sectorCoordToId,
  sectorIdToCoord,
  worldToSectorCoord,
  worldToSectorId,
} from './worldGrid'
import { CITY_BOUNDS } from '../cityLayout'

describe('world sector grid', () => {
  it('the entire existing city resolves to cell (0,0) — no content splits', () => {
    for (const [x, z] of [
      [CITY_BOUNDS.minX, CITY_BOUNDS.minZ],
      [CITY_BOUNDS.maxX, CITY_BOUNDS.maxZ],
      [0, 0],
      [-70, 62],
      [66, -60],
    ]) {
      expect(worldToSectorId(x, z)).toBe('s0_0')
    }
  })

  it('converts positive and negative positions deterministically', () => {
    expect(worldToSectorCoord(0, 0)).toEqual({ sx: 0, sz: 0 })
    expect(worldToSectorCoord(-73, 0)).toEqual({ sx: -1, sz: 0 })
    expect(worldToSectorCoord(0, -73)).toEqual({ sx: 0, sz: -1 })
    expect(worldToSectorCoord(-217, -217)).toEqual({ sx: -2, sz: -2 })
    expect(worldToSectorCoord(216, 216)).toEqual({ sx: 2, sz: 2 })
  })

  it('exact boundaries belong to the higher cell (half-open, no epsilon)', () => {
    expect(worldToSectorId(GRID_ORIGIN_X + SECTOR_SIZE, 0)).toBe('s1_0')
    expect(worldToSectorId(GRID_ORIGIN_X + SECTOR_SIZE - 1e-9, 0)).toBe('s0_0')
    expect(worldToSectorId(0, GRID_ORIGIN_Z)).toBe('s0_0')
    expect(worldToSectorId(0, GRID_ORIGIN_Z - 1e-9)).toBe('s0_-1')
  })

  it('id round-trips for negative and positive coords', () => {
    for (const coord of [
      { sx: 0, sz: 0 },
      { sx: -1, sz: 0 },
      { sx: 3, sz: -7 },
      { sx: -12, sz: -1 },
    ]) {
      expect(sectorIdToCoord(sectorCoordToId(coord))).toEqual(coord)
    }
    expect(() => sectorIdToCoord('bogus')).toThrow()
  })

  it('bounds are exact cell rectangles', () => {
    expect(getSectorBounds({ sx: 0, sz: 0 })).toEqual({
      minX: -72,
      maxX: 72,
      minZ: -72,
      maxZ: 72,
    })
    expect(getSectorBounds({ sx: 0, sz: -1 })).toEqual({
      minX: -72,
      maxX: 72,
      minZ: -216,
      maxZ: -72,
    })
  })

  it('neighbor rings are deterministic and complete', () => {
    const ring1 = getNeighborSectorIds('s0_0', 1)
    expect(ring1).toHaveLength(8)
    expect(ring1).toEqual([
      's-1_-1',
      's0_-1',
      's1_-1',
      's-1_0',
      's1_0',
      's-1_1',
      's0_1',
      's1_1',
    ])
    expect(getNeighborSectorIds('s0_0', 2)).toHaveLength(24)
  })

  it('sector distance is the Chebyshev ring metric', () => {
    expect(getSectorDistance('s0_0', 's0_0')).toBe(0)
    expect(getSectorDistance('s0_0', 's1_-1')).toBe(1)
    expect(getSectorDistance('s0_0', 's3_-2')).toBe(3)
  })

  it('bounds intersection finds every touched cell', () => {
    // A camera-sized box straddling the north boundary of the city cell.
    const cells = getSectorsIntersectingBounds({ minX: -30, maxX: 30, minZ: -100, maxZ: -50 })
    expect(cells).toEqual(['s0_-1', 's0_0'])
    // A box exactly on a cell (edge-on-gridline must not leak a cell).
    expect(getSectorsIntersectingBounds({ minX: -72, maxX: 72, minZ: -72, maxZ: 72 })).toEqual([
      's0_0',
    ])
  })
})
