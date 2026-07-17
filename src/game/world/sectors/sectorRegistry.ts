import type { WorldBounds, SectorCoord, SectorId } from './worldGrid'
import { getSectorBounds, sectorCoordToId, sectorIdToCoord, worldToSectorId } from './worldGrid'

/**
 * Immutable registry of AUTHORED sectors. A sector is a streaming unit; a
 * district is a semantic gameplay region — one district may span sectors
 * and one sector may hold transition space between districts. Sector ids
 * are grid-derived (`s{sx}_{sz}`) and never encode gameplay meaning.
 *
 * Growth contract: a new neighborhood = one new SectorDefinition + content
 * authored into the existing data arrays (BUILDINGS/PROPS/…, positions
 * inside the cell) + a visual/collider component pair registered in
 * SectorManager + optional road-graph SegmentSpecs. Validation in
 * sectorContent.ts enforces ownership completeness.
 */

export type SimulationTier = 'full' | 'reduced' | 'dormant' | 'unloaded'

export type SectorKind =
  | 'urban'
  | 'residential'
  | 'industrial'
  | 'commercial'
  | 'park'
  | 'waterfront'
  | 'suburban'
  | 'transition'

export interface SectorDefinition {
  id: SectorId
  coord: SectorCoord
  name: string
  /** Semantic districts whose space intersects this sector. */
  districtIds: string[]
  kind: SectorKind
  bounds: WorldBounds
  streaming: {
    /** Never unloads (reserved; not used by any v1 sector). */
    alwaysLoaded?: boolean
    unloadDelayMs?: number
    priority?: number
  }
  simulation: {
    supportsDormantCitizens: boolean
    supportsDormantTraffic: boolean
  }
  map: {
    label: string
    /** Only labeled sectors draw on the phone map. */
    showOnMap: boolean
    order?: number
  }
  version: number
}

function defineSector(
  coord: SectorCoord,
  spec: Omit<SectorDefinition, 'id' | 'coord' | 'bounds'>,
): SectorDefinition {
  return { id: sectorCoordToId(coord), coord, bounds: getSectorBounds(coord), ...spec }
}

export const SECTOR_REGISTRY_VERSION = 1

/**
 * v1 authored sectors:
 * - s0_0: the entire existing six-block city (144×144 cell, zero splits)
 * - s-1_0 / s1_0: backdrop-tower shelves (visual dressing outside the walls)
 * - s0_-1: Downtown Gateway — the expansion proof sector
 */
export const SECTOR_DEFINITIONS: readonly SectorDefinition[] = [
  defineSector(
    { sx: 0, sz: 0 },
    {
      name: 'Central Neighborhood',
      districtIds: [
        'central',
        'residential',
        'residential_west',
        'residential_south',
        'industrial',
        'industrial_north',
      ],
      kind: 'urban',
      streaming: { priority: 10, unloadDelayMs: 4000 },
      simulation: { supportsDormantCitizens: true, supportsDormantTraffic: true },
      map: { label: 'City Center', showOnMap: true, order: 0 },
      version: 1,
    },
  ),
  defineSector(
    { sx: -1, sz: 0 },
    {
      name: 'West Backdrop',
      districtIds: [],
      kind: 'transition',
      streaming: { priority: 1, unloadDelayMs: 2000 },
      simulation: { supportsDormantCitizens: false, supportsDormantTraffic: false },
      map: { label: '', showOnMap: false },
      version: 1,
    },
  ),
  defineSector(
    { sx: 1, sz: 0 },
    {
      name: 'East Backdrop',
      districtIds: [],
      kind: 'transition',
      streaming: { priority: 1, unloadDelayMs: 2000 },
      simulation: { supportsDormantCitizens: false, supportsDormantTraffic: false },
      map: { label: '', showOnMap: false },
      version: 1,
    },
  ),
  defineSector(
    { sx: 0, sz: -1 },
    {
      name: 'Downtown Gateway',
      districtIds: ['downtown_gateway'],
      kind: 'commercial',
      streaming: { priority: 5, unloadDelayMs: 4000 },
      simulation: { supportsDormantCitizens: true, supportsDormantTraffic: true },
      map: { label: 'Downtown Gateway', showOnMap: true, order: 1 },
      version: 1,
    },
  ),
  defineSector(
    { sx: 1, sz: -1 },
    {
      name: 'Main Street East',
      districtIds: ['downtown_gateway'],
      kind: 'commercial',
      streaming: { priority: 4, unloadDelayMs: 4000 },
      simulation: { supportsDormantCitizens: true, supportsDormantTraffic: true },
      map: { label: 'Main Street', showOnMap: true, order: 2 },
      version: 1,
    },
  ),
  // --- City Expansion Content Pack v1 (all kit-compiled) ---
  defineSector(
    { sx: 0, sz: -2 },
    {
      name: 'Waterfront Gateway',
      districtIds: ['waterfront_north'],
      kind: 'waterfront',
      streaming: { priority: 4, unloadDelayMs: 4000 },
      simulation: { supportsDormantCitizens: true, supportsDormantTraffic: true },
      map: { label: 'Waterfront', showOnMap: true, order: 3 },
      version: 1,
    },
  ),
  defineSector(
    { sx: 1, sz: -2 },
    {
      name: 'Main Street North',
      districtIds: ['downtown_north'],
      kind: 'commercial',
      streaming: { priority: 3, unloadDelayMs: 4000 },
      simulation: { supportsDormantCitizens: true, supportsDormantTraffic: true },
      map: { label: 'Main St North', showOnMap: true, order: 4 },
      version: 1,
    },
  ),
  defineSector(
    { sx: 2, sz: -1 },
    {
      name: 'Residential East',
      districtIds: ['residential_east'],
      kind: 'residential',
      streaming: { priority: 3, unloadDelayMs: 4000 },
      simulation: { supportsDormantCitizens: true, supportsDormantTraffic: true },
      map: { label: 'Residential East', showOnMap: true, order: 5 },
      version: 1,
    },
  ),
  defineSector(
    { sx: -1, sz: -2 },
    {
      name: 'Industrial Yard',
      districtIds: ['industrial_west'],
      kind: 'industrial',
      streaming: { priority: 3, unloadDelayMs: 4000 },
      simulation: { supportsDormantCitizens: true, supportsDormantTraffic: true },
      map: { label: 'Industrial Yard', showOnMap: true, order: 6 },
      version: 1,
    },
  ),
]

const BY_ID = new Map(SECTOR_DEFINITIONS.map((d) => [d.id, d]))

export function getSectorDefinition(id: SectorId): SectorDefinition | undefined {
  return BY_ID.get(id)
}

export function getAllSectorIds(): SectorId[] {
  return SECTOR_DEFINITIONS.map((d) => d.id)
}

/** Authored sector containing the position, or undefined in unauthored void. */
export function getSectorAtWorldPosition(x: number, z: number): SectorDefinition | undefined {
  return BY_ID.get(worldToSectorId(x, z))
}

export function getSectorsForDistrict(districtId: string): SectorDefinition[] {
  return SECTOR_DEFINITIONS.filter((d) => d.districtIds.includes(districtId))
}

/** Union bounds of every map-visible authored sector (phone map extent). */
export function getWorldMapBounds(): WorldBounds {
  const visible = SECTOR_DEFINITIONS.filter((d) => d.map.showOnMap)
  const bounds: WorldBounds = { minX: Infinity, maxX: -Infinity, minZ: Infinity, maxZ: -Infinity }
  for (const def of visible) {
    bounds.minX = Math.min(bounds.minX, def.bounds.minX)
    bounds.maxX = Math.max(bounds.maxX, def.bounds.maxX)
    bounds.minZ = Math.min(bounds.minZ, def.bounds.minZ)
    bounds.maxZ = Math.max(bounds.maxZ, def.bounds.maxZ)
  }
  return bounds
}

export function isAuthoredSector(id: SectorId): boolean {
  return BY_ID.has(id)
}

/** Registry sanity used by unit tests (unique ids/coords, valid bounds). */
export function validateSectorRegistry(): string[] {
  const errors: string[] = []
  const seenIds = new Set<string>()
  const seenCoords = new Set<string>()
  for (const def of SECTOR_DEFINITIONS) {
    if (seenIds.has(def.id)) errors.push(`duplicate sector id ${def.id}`)
    seenIds.add(def.id)
    const coordKey = `${def.coord.sx},${def.coord.sz}`
    if (seenCoords.has(coordKey)) errors.push(`duplicate sector coord ${coordKey}`)
    seenCoords.add(coordKey)
    if (def.id !== sectorCoordToId(def.coord)) errors.push(`${def.id}: id/coord mismatch`)
    const expected = getSectorBounds(sectorIdToCoord(def.id))
    if (
      def.bounds.minX !== expected.minX ||
      def.bounds.maxX !== expected.maxX ||
      def.bounds.minZ !== expected.minZ ||
      def.bounds.maxZ !== expected.maxZ
    ) {
      errors.push(`${def.id}: bounds drift from grid cell`)
    }
    if (def.map.showOnMap && !def.map.label) errors.push(`${def.id}: map-visible without label`)
  }
  return errors
}
