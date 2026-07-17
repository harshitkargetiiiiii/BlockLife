import { computeSurfaceDetails, type SurfaceDetail, type SurfaceRect } from './surfaceDetails'
import { COMPILED_SECTORS } from '../authoring/compiledSectors'
import { BUILDINGS, GATEWAY, PARK, getRoadRects } from '../cityLayout'

/**
 * Per-sector surface-detail sets, computed once at module load.
 *
 * Kit sectors derive everything from their compiled content (roads,
 * sidewalk surfaces, plazas, walled-area grass, water and building boxes
 * to avoid). The two legacy sectors get hand-scoped inputs from the same
 * cityLayout constants that drive their rendering — one validated source
 * of geometry, no drift.
 */

const buildingBox = (b: { position: [number, number] | number[]; size: number[] }): SurfaceRect => ({
  minX: b.position[0] - b.size[0] / 2 - 0.6,
  maxX: b.position[0] + b.size[0] / 2 + 0.6,
  minZ: b.position[1] - b.size[2] / 2 - 0.6,
  maxZ: b.position[1] + b.size[2] / 2 + 0.6,
})

const CACHE = new Map<string, SurfaceDetail[]>()

for (const compiled of COMPILED_SECTORS) {
  const sidewalks = compiled.surfaces.filter((s) => s.kind === 'sidewalk').map((s) => s.rect)
  const plazas = compiled.surfaces.filter((s) => s.kind === 'plaza').map((s) => s.rect)
  const grass: SurfaceRect[] = [compiled.spec.area]
  const avoid: SurfaceRect[] = [
    ...compiled.buildings.map((b) => buildingBox(b)),
    ...compiled.waterRects,
    // Prop-heavy zones stay unpatched so decals never peek through props.
    ...compiled.spec.propZones.map((z) => z.bounds),
  ]
  CACHE.set(
    compiled.sectorId,
    computeSurfaceDetails({
      id: compiled.sectorId,
      roads: compiled.roadRects,
      sidewalks,
      plazas,
      grass,
      avoid,
      // Industrial Yard: dashed loading-zone paint along the dock frontage.
      zonePaint:
        compiled.sectorId === 's-1_-2'
          ? [{ from: [-168, -237.6], to: [-92, -237.6], dash: 2.2, width: 0.32 }]
          : undefined,
    }),
  )
}

// Legacy central city: manholes/patches on its own road rects + park lawn
// variation (the pond is avoided with a generous square).
const legacyRoads = getRoadRects().filter((r) => !/^s-?\d/.test(r.id))
CACHE.set(
  's0_0',
  computeSurfaceDetails({
    id: 's0_0',
    roads: legacyRoads,
    sidewalks: [],
    grass: [
      { minX: PARK.center[0] - PARK.size[0] / 2, maxX: PARK.center[0] + PARK.size[0] / 2, minZ: PARK.center[1] - PARK.size[1] / 2, maxZ: PARK.center[1] + PARK.size[1] / 2 },
    ],
    avoid: [
      { minX: PARK.pond.center[0] - PARK.pond.radius - 1, maxX: PARK.pond.center[0] + PARK.pond.radius + 1, minZ: PARK.pond.center[1] - PARK.pond.radius - 1, maxZ: PARK.pond.center[1] + PARK.pond.radius + 1 },
      ...BUILDINGS.filter((b) => !/^s-?\d/.test(b.id)).map((b) => buildingBox(b)),
    ],
  }),
)

// Downtown Gateway: avenue details + plaza paving bands + lawn variation.
CACHE.set(
  's0_-1',
  computeSurfaceDetails({
    id: 's0_-1',
    roads: [GATEWAY.road],
    sidewalks: [],
    plazas: [GATEWAY.plaza],
    grass: [GATEWAY.area],
    avoid: [
      GATEWAY.road,
      GATEWAY.plaza,
      ...BUILDINGS.filter((b) => b.id.startsWith('building_gate')).map((b) => buildingBox(b)),
    ],
  }),
)

export function getSurfaceDetailsForSector(sectorId: string): SurfaceDetail[] {
  return CACHE.get(sectorId) ?? []
}

/** Totals for the debug panel / report. */
export function getSurfaceDetailTotals(): { sectors: number; details: number } {
  let details = 0
  for (const list of CACHE.values()) details += list.length
  return { sectors: CACHE.size, details }
}
