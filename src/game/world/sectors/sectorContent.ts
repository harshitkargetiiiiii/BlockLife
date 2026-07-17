import { AMBIENT_CARS, BUILDINGS, FOOD_TRUCK, JOB_KIOSK, PARK, PROPS } from '../cityLayout'
import { NPC_DEFS } from '../../../data/npcs'
import { STATIC_INTERACTABLES } from '../../../data/interactables'
import { AMBIENT_CITIZENS } from '../../citizens/ambientCitizenData'
import { getRoadGraph, pointAtProgress } from '../../traffic/routing/roadGraphBuilder'
import { CROSSWALKS } from '../../traffic/trafficData'
import type { SectorId } from './worldGrid'
import { worldToSectorId } from './worldGrid'
import { isAuthoredSector, getSectorDefinition } from './sectorRegistry'

/**
 * Content ownership: every world entity resolves to exactly one PRIMARY
 * sector, DERIVED from the same position data that drives rendering,
 * colliders and occupancy — ownership can never drift from geometry.
 * Cross-boundary entities (long road segments) additionally list every
 * touched sector. Explicit declared-owner overrides live in OWNER_OVERRIDES.
 *
 * These maps are built once and frozen; validation runs in unit tests so an
 * unowned or dangling id fails the build, not a play session.
 */

/** Declared owners for entities whose position alone would mislead. */
const OWNER_OVERRIDES: Record<string, SectorId> = {
  // (none yet — gateway content resolves by position)
}

export interface SectorContentIndex {
  /** entity id → primary sector id (buildings, props, citizens, npcs, …). */
  owners: Map<string, SectorId>
  /** sector id → owned entity ids by category. */
  byCategory: Map<SectorId, Map<string, string[]>>
  /** road segment id → primary + touched sector metadata. */
  segments: Map<
    string,
    { primarySectorId: SectorId; touchedSectorIds: SectorId[]; boundaryCrossing: boolean }
  >
}

function assign(
  index: SectorContentIndex,
  category: string,
  id: string,
  x: number,
  z: number,
): void {
  const sector = OWNER_OVERRIDES[id] ?? worldToSectorId(x, z)
  // The same entity may surface through two data sources (e.g. the food
  // truck is a landmark AND an interactable) — same-sector repeats are the
  // same ownership; conflicting sectors are a validation error.
  const existing = index.owners.get(id)
  if (existing !== undefined) {
    if (existing !== sector) {
      index.owners.set(`${id}!conflict`, sector) // surfaces in validation
    }
    return
  }
  index.owners.set(id, sector)
  let cats = index.byCategory.get(sector)
  if (!cats) {
    cats = new Map()
    index.byCategory.set(sector, cats)
  }
  const list = cats.get(category) ?? []
  list.push(id)
  cats.set(category, list)
}

let cached: SectorContentIndex | null = null

export function buildSectorContentIndex(): SectorContentIndex {
  const index: SectorContentIndex = {
    owners: new Map(),
    byCategory: new Map(),
    segments: new Map(),
  }

  for (const b of BUILDINGS) assign(index, 'building', b.id, b.position[0], b.position[1])
  for (const p of PROPS) assign(index, 'prop', p.id, p.position[0], p.position[1])
  assign(index, 'landmark', FOOD_TRUCK.id, FOOD_TRUCK.position[0], FOOD_TRUCK.position[1])
  assign(index, 'landmark', JOB_KIOSK.id, JOB_KIOSK.position[0], JOB_KIOSK.position[1])
  assign(index, 'landmark', 'park_pond', PARK.pond.center[0], PARK.pond.center[1])

  // Named NPCs: primary sector = first routine anchor (their home beat).
  for (const npc of NPC_DEFS) {
    const anchor = npc.routine[0]?.points[0] ?? [0, 0]
    assign(index, 'namedNpc', npc.id, anchor[0], anchor[1])
  }
  for (const citizen of AMBIENT_CITIZENS) {
    assign(index, 'citizen', citizen.id, citizen.position[0], citizen.position[1])
  }
  // Ambient cars: home sector = graph spawn anchor (routed) or loop start.
  const graph = getRoadGraph()
  for (const car of AMBIENT_CARS) {
    const spawn = car.routeSpawnId ? graph.spawnPoints.get(car.routeSpawnId) : undefined
    if (spawn) {
      const seg = graph.segments.get(spawn.segmentId)!
      const [x, z] = pointAtProgress(seg, spawn.progress)
      assign(index, 'ambientVehicle', car.id, x, z)
    } else {
      assign(index, 'ambientVehicle', car.id, 0, 0) // loop cars live in s0_0
    }
  }
  for (const zone of CROSSWALKS) assign(index, 'crossing', zone.id, zone.center[0], zone.center[1])
  for (const def of STATIC_INTERACTABLES) {
    // Some interactables anchor to runtime entities and carry no static
    // position — those resolve through their entity's owner instead.
    if (!def.position) continue
    assign(index, 'interaction', def.id, def.position[0], def.position[2])
  }

  // Road segments: primary by midpoint, touched by endpoint+midpoint cells.
  for (const [id, seg] of graph.segments) {
    const mid = pointAtProgress(seg, 0.5)
    const primary = worldToSectorId(mid[0], mid[1])
    const touched = new Set<SectorId>([primary])
    touched.add(worldToSectorId(seg.points[0][0], seg.points[0][1]))
    const last = seg.points[seg.points.length - 1]
    touched.add(worldToSectorId(last[0], last[1]))
    index.segments.set(id, {
      primarySectorId: primary,
      touchedSectorIds: [...touched].sort(),
      boundaryCrossing: touched.size > 1,
    })
  }

  return index
}

export function getSectorContentIndex(): SectorContentIndex {
  if (!cached) cached = buildSectorContentIndex()
  return cached
}

export function getSectorForContent(id: string): SectorId | undefined {
  return getSectorContentIndex().owners.get(id)
}

export function getSectorForRoadSegment(segmentId: string) {
  return getSectorContentIndex().segments.get(segmentId)
}

export function getSectorContentSummary(sectorId: SectorId): Record<string, number> {
  const cats = getSectorContentIndex().byCategory.get(sectorId)
  const out: Record<string, number> = {}
  if (!cats) return out
  for (const [category, ids] of cats) out[category] = ids.length
  return out
}

export function getOwnedIds(sectorId: SectorId, category: string): string[] {
  return getSectorContentIndex().byCategory.get(sectorId)?.get(category) ?? []
}

/** Full ownership validation — run by unit tests on every build. */
export function validateSectorOwnership(): string[] {
  const errors: string[] = []
  const index = getSectorContentIndex()

  for (const [id, sector] of index.owners) {
    if (!isAuthoredSector(sector)) {
      errors.push(`${id}: owner sector ${sector} is not in the registry`)
    }
  }
  for (const [segmentId, meta] of index.segments) {
    for (const sector of meta.touchedSectorIds) {
      if (!isAuthoredSector(sector)) {
        errors.push(`segment ${segmentId}: touches unauthored sector ${sector}`)
      }
    }
    if (!meta.touchedSectorIds.includes(meta.primarySectorId)) {
      errors.push(`segment ${segmentId}: primary sector missing from touched list`)
    }
  }
  // Cross-source ownership conflicts (same id resolving to two sectors).
  for (const id of index.owners.keys()) {
    if (id.endsWith('!conflict')) {
      errors.push(`${id.replace('!conflict', '')}: conflicting sector ownership`)
    }
  }
  // District claims: every sector owning content declares itself on the map
  // or is a known backdrop shelf.
  for (const sectorId of index.byCategory.keys()) {
    const def = getSectorDefinition(sectorId)
    if (!def) errors.push(`content assigned to unknown sector ${sectorId}`)
  }
  return errors
}
