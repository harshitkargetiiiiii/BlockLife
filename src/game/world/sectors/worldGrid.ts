import type { Vec2 } from '../worldTypes'

/**
 * Large City Foundation v1 — world sector grid.
 *
 * The world is divided into fixed 144×144 cells on a grid anchored at
 * (-72, -72), chosen after measurement (see docs/LARGE_CITY_FOUNDATION.md):
 * - the whole existing six-block city (x −70..66, z −60..62) fits exactly
 *   inside cell (0,0) with zero content splitting
 * - one cell ≈ one authored neighborhood — the natural growth unit
 * - the orthographic camera footprint (~70×55 world units) fits inside one
 *   cell, so a one-ring warm zone always covers everything visible
 * - max vehicle speed (~15 u/s driven) crosses half a cell in ~5 s, ample
 *   time for neighbor prewarming
 *
 * Pure math only: no camera, no render state, no randomness. Cells are
 * half-open ([min, max) on both axes) so exact-boundary positions resolve
 * deterministically to the higher cell.
 *
 * Floating origin: not needed in v1. Float32 world transforms stay
 * sub-centimeter accurate to ~30,000 units from origin (~200 sectors out);
 * revisit only if the authored city approaches that radius.
 */

export const SECTOR_SIZE = 144
export const GRID_ORIGIN_X = -72
export const GRID_ORIGIN_Z = -72

export interface SectorCoord {
  sx: number
  sz: number
}

export type SectorId = string

export interface WorldBounds {
  minX: number
  maxX: number
  minZ: number
  maxZ: number
}

export function worldToSectorCoord(x: number, z: number): SectorCoord {
  return {
    sx: Math.floor((x - GRID_ORIGIN_X) / SECTOR_SIZE),
    sz: Math.floor((z - GRID_ORIGIN_Z) / SECTOR_SIZE),
  }
}

export function sectorCoordToId(coord: SectorCoord): SectorId {
  return `s${coord.sx}_${coord.sz}`
}

export function worldToSectorId(x: number, z: number): SectorId {
  return sectorCoordToId(worldToSectorCoord(x, z))
}

const SECTOR_ID_PATTERN = /^s(-?\d+)_(-?\d+)$/

export function sectorIdToCoord(id: SectorId): SectorCoord {
  const match = SECTOR_ID_PATTERN.exec(id)
  if (!match) throw new Error(`invalid sector id "${id}"`)
  return { sx: Number(match[1]), sz: Number(match[2]) }
}

/** North-west (min-x, min-z) corner of the cell. */
export function getSectorOrigin(coord: SectorCoord): Vec2 {
  return [GRID_ORIGIN_X + coord.sx * SECTOR_SIZE, GRID_ORIGIN_Z + coord.sz * SECTOR_SIZE]
}

export function getSectorBounds(coord: SectorCoord): WorldBounds {
  const [minX, minZ] = getSectorOrigin(coord)
  return { minX, maxX: minX + SECTOR_SIZE, minZ, maxZ: minZ + SECTOR_SIZE }
}

export function getSectorCenter(coord: SectorCoord): Vec2 {
  const [minX, minZ] = getSectorOrigin(coord)
  return [minX + SECTOR_SIZE / 2, minZ + SECTOR_SIZE / 2]
}

/**
 * Ids of all cells within `ring` steps (Chebyshev) of the given sector,
 * excluding itself, in deterministic row-major order.
 */
export function getNeighborSectorIds(id: SectorId, ring = 1): SectorId[] {
  const { sx, sz } = sectorIdToCoord(id)
  const out: SectorId[] = []
  for (let dz = -ring; dz <= ring; dz++) {
    for (let dx = -ring; dx <= ring; dx++) {
      if (dx === 0 && dz === 0) continue
      out.push(sectorCoordToId({ sx: sx + dx, sz: sz + dz }))
    }
  }
  return out
}

/** Chebyshev ring distance between two sectors (0 = same cell). */
export function getSectorDistance(a: SectorId, b: SectorId): number {
  const ca = sectorIdToCoord(a)
  const cb = sectorIdToCoord(b)
  return Math.max(Math.abs(ca.sx - cb.sx), Math.abs(ca.sz - cb.sz))
}

/** All sector ids whose cells intersect the given world bounds. */
export function getSectorsIntersectingBounds(bounds: WorldBounds): SectorId[] {
  const min = worldToSectorCoord(bounds.minX, bounds.minZ)
  // Half-open cells: a bounds edge exactly on a grid line does NOT reach
  // into the next cell, so back max off by an epsilon-free integer check.
  const maxSx = Math.floor((bounds.maxX - GRID_ORIGIN_X) / SECTOR_SIZE - Number.EPSILON)
  const maxSz = Math.floor((bounds.maxZ - GRID_ORIGIN_Z) / SECTOR_SIZE - Number.EPSILON)
  const out: SectorId[] = []
  for (let sz = min.sz; sz <= maxSz; sz++) {
    for (let sx = min.sx; sx <= maxSx; sx++) {
      out.push(sectorCoordToId({ sx, sz }))
    }
  }
  return out
}
