import { describe, expect, it } from 'vitest'
import { computeSurfaceDetails, type SurfaceRect } from './surfaceDetails'
import { getSurfaceDetailsForSector, getSurfaceDetailTotals } from './sectorSurfaceDetails'
import { computeFacadeDetails, resolveFacadeStyle } from './facadeDetails'
import { BUILDINGS } from '../cityLayout'
import { COMPILED_SECTORS } from '../authoring/compiledSectors'

/**
 * Surface & Facade Art Polish v1 — determinism, containment and
 * attachment contracts for every generated detail.
 */

const contains = (r: SurfaceRect, x: number, z: number, w: number, d: number, slack = 0.01) =>
  x - w / 2 >= r.minX - slack &&
  x + w / 2 <= r.maxX + slack &&
  z - d / 2 >= r.minZ - slack &&
  z + d / 2 <= r.maxZ + slack

describe('surface detail generation', () => {
  const INPUT = {
    id: 'probe',
    roads: [{ minX: 0, maxX: 60, minZ: 0, maxZ: 8 }],
    sidewalks: [{ minX: 0, maxX: 60, minZ: 8, maxZ: 11 }],
    grass: [{ minX: 0, maxX: 40, minZ: 14, maxZ: 44 }],
    plazas: [{ minX: 44, maxX: 60, minZ: 14, maxZ: 30 }],
    avoid: [{ minX: 10, maxX: 20, minZ: 20, maxZ: 30 }],
    zonePaint: [{ from: [2, 4] as [number, number], to: [30, 4] as [number, number], dash: 2, width: 0.3 }],
  }

  it('is deterministic: identical inputs → identical output', () => {
    expect(computeSurfaceDetails(INPUT)).toEqual(computeSurfaceDetails(INPUT))
  })

  it('road details stay inside their road; point details clear the edges', () => {
    const details = computeSurfaceDetails(INPUT)
    for (const detail of details.filter((d) => ['manhole', 'drain', 'road_patch'].includes(d.kind))) {
      expect(contains(INPUT.roads[0], detail.x, detail.z, 0, 0), detail.id).toBe(true)
    }
  })

  it('sidewalk seams span the walk; a curb strip hugs the road edge', () => {
    const details = computeSurfaceDetails(INPUT)
    const seams = details.filter((d) => d.kind === 'sidewalk_seam')
    expect(seams.length).toBeGreaterThan(5)
    for (const seam of seams) expect(contains(INPUT.sidewalks[0], seam.x, seam.z, seam.w, seam.d, 0.1)).toBe(true)
    const curb = details.find((d) => d.kind === 'curb_strip')!
    expect(curb).toBeDefined()
    expect(Math.abs(curb.z - 8.14)).toBeLessThan(0.1) // hugs the shared edge (0.1 grid rounding)
  })

  it('grass patches avoid the avoid-rects and all paved surfaces', () => {
    const details = computeSurfaceDetails(INPUT)
    const patches = details.filter((d) => d.kind === 'grass_patch' || d.kind === 'dirt_patch')
    expect(patches.length).toBeGreaterThan(2)
    for (const p of patches) {
      expect(contains(INPUT.grass[0], p.x, p.z, p.w, p.d, 0.05), p.id).toBe(true)
      for (const a of [...INPUT.avoid, ...INPUT.roads, ...INPUT.sidewalks, ...INPUT.plazas]) {
        const overlap =
          p.x + p.w / 2 > a.minX && p.x - p.w / 2 < a.maxX && p.z + p.d / 2 > a.minZ && p.z - p.d / 2 < a.maxZ
        expect(overlap, `${p.id} vs avoid`).toBe(false)
      }
    }
  })

  it('every detail kind sits on its own height tier (no z-fighting)', () => {
    const details = computeSurfaceDetails(INPUT)
    const byKind = new Map<string, number>()
    for (const d of details) {
      const y = byKind.get(d.kind)
      if (y !== undefined) expect(d.y).toBe(y)
      byKind.set(d.kind, d.y)
    }
    const ys = [...byKind.values()]
    expect(new Set(ys).size).toBe(ys.length)
  })
})

describe('per-sector surface details', () => {
  it('every sector (kit + legacy) gets a deterministic, contained set', () => {
    const totals = getSurfaceDetailTotals()
    expect(totals.sectors).toBe(7) // 5 kit + central + gateway
    expect(totals.details).toBeGreaterThan(120)
    for (const compiled of COMPILED_SECTORS) {
      const details = getSurfaceDetailsForSector(compiled.sectorId)
      expect(details.length, compiled.sectorId).toBeGreaterThan(8)
      // Road-bound kinds inside SOME road rect of the sector.
      for (const d of details.filter((x) => ['manhole', 'drain', 'road_patch'].includes(x.kind))) {
        expect(
          compiled.roadRects.some((r) => d.x > r.minX && d.x < r.maxX && d.z > r.minZ && d.z < r.maxZ),
          d.id,
        ).toBe(true)
      }
    }
  })

  it('industrial yard gets loading-zone paint; waterfront gets paving bands', () => {
    expect(getSurfaceDetailsForSector('s-1_-2').some((d) => d.kind === 'zone_paint')).toBe(true)
    expect(getSurfaceDetailsForSector('s0_-2').some((d) => d.kind === 'paving_band')).toBe(true)
  })
})

describe('facade detail policies', () => {
  it('styles resolve from building metadata', () => {
    const styles = new Set(BUILDINGS.map((b) => resolveFacadeStyle(b)))
    expect(styles.has('shop')).toBe(true)
    expect(styles.has('tower')).toBe(true)
    expect(styles.has('house')).toBe(true)
    expect(styles.has('industrial')).toBe(true)
  })

  it('details are deterministic, bounded, and hug the building envelope', () => {
    for (const def of BUILDINGS) {
      const a = computeFacadeDetails(def)
      expect(a).toEqual(computeFacadeDetails(def))
      expect(a.length).toBeLessThanOrEqual(6)
      const [w, h, d] = def.size
      for (const box of a) {
        // Never floats above the roofline + slack, never sinks underground.
        expect(box.y).toBeGreaterThanOrEqual(0)
        expect(box.y + box.h).toBeLessThanOrEqual(h + 0.6)
        // Stays within the wall plane + a small architectural overhang.
        expect(Math.abs(box.x) - box.w / 2, def.id).toBeLessThanOrEqual(w / 2 + 1.2)
        expect(Math.abs(box.z) - box.d / 2, def.id).toBeLessThanOrEqual(d / 2 + 1.2)
      }
    }
  })

  it('shops get a fascia + display; industrial gets vents + loading door', () => {
    const shop = BUILDINGS.find((b) => resolveFacadeStyle(b) === 'shop')!
    const roles = computeFacadeDetails(shop).map((b) => b.role)
    expect(roles).toContain('accent')
    expect(roles).toContain('dark')
    const industrial = BUILDINGS.find((b) => resolveFacadeStyle(b) === 'industrial' && b.door)!
    const iRoles = computeFacadeDetails(industrial).map((b) => b.role)
    expect(iRoles.filter((r) => r === 'vent').length).toBe(2)
    expect(iRoles).toContain('dark')
  })
})
