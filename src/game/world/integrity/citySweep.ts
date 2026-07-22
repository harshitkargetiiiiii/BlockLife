/**
 * Automated City Sweeper source (World Integrity issue §13) — GENERATES the
 * traversal targets + visual-sweep frames deterministically from the compiled
 * sector + anchor data, so a NEW district is automatically visited and
 * photographed without anyone hand-listing probes. Pure + deterministic
 * (sector-def order). Consumed by the generated E2E traversal, the generated
 * visual sweep, and the integrity soak.
 */
import type { Vec2 } from '../worldTypes'
import type { SectorId } from '../sectors/worldGrid'
import { SECTOR_DEFINITIONS, type SectorDefinition } from '../sectors/sectorRegistry'
import { getCompiledSector } from '../authoring/compiledSectors'
import { BUILDINGS } from '../cityLayout'

/**
 * A point where the district's authored CONTENT actually is — the centroid of
 * its buildings — not the geometric sector centre, which for a district whose
 * streetscape sits in one corner of its 144u sector would frame empty void.
 * Falls back to the bounds centre for a content-less backdrop.
 */
function districtContentPoint(def: SectorDefinition): Vec2 {
  const compiled = getCompiledSector(def.id)
  const positions: Vec2[] = compiled
    ? compiled.buildings.map((b) => b.position)
    : def.districtIds.includes('central')
      ? BUILDINGS.map((b) => b.position)
      : []
  if (positions.length === 0) {
    return [(def.bounds.minX + def.bounds.maxX) / 2, (def.bounds.minZ + def.bounds.maxZ) / 2]
  }
  const sx = positions.reduce((s, p) => s + p[0], 0) / positions.length
  const sz = positions.reduce((s, p) => s + p[1], 0) / positions.length
  // Clamp inside the sector: the legacy central set includes backdrop buildings
  // that pull the centroid just past the sector edge, and the frame must stay in
  // this district (kit sectors' building centroids already fall inside).
  const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(v, hi))
  return [clamp(sx, def.bounds.minX, def.bounds.maxX), clamp(sz, def.bounds.minZ, def.bounds.maxZ)]
}

export interface TraversalTarget {
  sectorId: SectorId
  displayName: string
  /** A safe sample point (teleport gates on readiness + clears it of solids). */
  x: number
  z: number
  kind: 'center' | 'citizen_anchor'
}

/** Per district: the sector centre + up to two authored citizen anchors (which
 *  sit on walkable ground). Deterministic; bounded per district. */
export function generateTraversalTargets(): TraversalTarget[] {
  const out: TraversalTarget[] = []
  for (const def of SECTOR_DEFINITIONS) {
    const [cx, cz] = districtContentPoint(def)
    out.push({ sectorId: def.id, displayName: def.name, x: cx, z: cz, kind: 'center' })
    const compiled = getCompiledSector(def.id)
    if (compiled) {
      for (const c of compiled.citizens.slice(0, 2)) {
        out.push({
          sectorId: def.id,
          displayName: def.name,
          x: c.position[0],
          z: c.position[1],
          kind: 'citizen_anchor',
        })
      }
    }
  }
  return out
}

export interface VisualSweepFrame {
  /** Stable frame id → the baseline filename (`district-<id>-overview`). */
  id: string
  sectorId: SectorId
  displayName: string
  /** Teleport point the fixed follow-camera frames from. */
  x: number
  z: number
  /** What this frame certifies (metadata, per §13). */
  certifies: string
}

/**
 * One deterministic OVERVIEW frame per authored, map-visible district — a
 * representative probe, not hundreds of screenshots (§13). Backdrops (no map
 * label) are skipped: they have no authored streetscape to certify.
 */
export function generateVisualSweepFrames(): VisualSweepFrame[] {
  return SECTOR_DEFINITIONS.filter((def) => def.map.showOnMap).map((def) => {
    const [x, z] = districtContentPoint(def)
    return {
      id: `district-${def.id}-overview`,
      sectorId: def.id,
      displayName: def.name,
      x,
      z,
      certifies: `${def.name} overview — floor + buildings + props render with valid placement`,
    }
  })
}
