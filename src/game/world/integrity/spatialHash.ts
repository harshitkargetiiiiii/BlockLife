/**
 * Uniform-grid spatial hash for bounded neighbour queries. The occupancy
 * resolver and anomaly detector use this so neither ever does an all-pairs
 * O(n²) pass over the whole city each frame (see performance requirements).
 *
 * Pure + deterministic: rebuild each tick from the registry's deterministic
 * iteration order, then query. Cell scan order is fixed (nested min→max loops)
 * and within-cell order is insertion order, so results are reproducible for a
 * paused snapshot.
 */

export interface SpatialEntry {
  id: string
  x: number
  z: number
}

/** Packs a signed cell coordinate pair into one integer key. */
function cellKey(cx: number, cz: number): number {
  // City coordinates stay within a few thousand units; at any sane cell size
  // the cell index is well within ±32768, so a 16-bit pack is collision-free.
  return ((cx + 0x8000) << 16) | (cz + 0x8000)
}

export class SpatialHash {
  private readonly cell: number
  private readonly cells = new Map<number, SpatialEntry[]>()

  constructor(cellSize = 4) {
    this.cell = cellSize > 0 ? cellSize : 4
  }

  clear(): void {
    this.cells.clear()
  }

  get size(): number {
    let n = 0
    for (const arr of this.cells.values()) n += arr.length
    return n
  }

  insert(id: string, x: number, z: number): void {
    const cx = Math.floor(x / this.cell)
    const cz = Math.floor(z / this.cell)
    const k = cellKey(cx, cz)
    const arr = this.cells.get(k)
    if (arr) arr.push({ id, x, z })
    else this.cells.set(k, [{ id, x, z }])
  }

  /**
   * Entries whose centre is within `radius` of (x,z), excluding `selfId`.
   * Reuses `out` (cleared first) so hot callers avoid per-query allocation.
   * Bounded by the cell fan-out (⌈radius/cell⌉ rings), never the whole city.
   */
  queryNeighbours(
    x: number,
    z: number,
    radius: number,
    selfId?: string,
    out: SpatialEntry[] = [],
  ): SpatialEntry[] {
    out.length = 0
    const r2 = radius * radius
    const minCx = Math.floor((x - radius) / this.cell)
    const maxCx = Math.floor((x + radius) / this.cell)
    const minCz = Math.floor((z - radius) / this.cell)
    const maxCz = Math.floor((z + radius) / this.cell)
    for (let cx = minCx; cx <= maxCx; cx++) {
      for (let cz = minCz; cz <= maxCz; cz++) {
        const arr = this.cells.get(cellKey(cx, cz))
        if (!arr) continue
        for (const e of arr) {
          if (e.id === selfId) continue
          const dx = e.x - x
          const dz = e.z - z
          if (dx * dx + dz * dz <= r2) out.push(e)
        }
      }
    }
    return out
  }
}
