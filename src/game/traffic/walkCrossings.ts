import type { CrosswalkZone } from './trafficTypes'
import { COMPILED_SECTORS } from '../world/authoring/compiledSectors'
import type { CompiledWalkCrossing } from '../world/authoring/authoringTypes'

/**
 * Unsignalled painted crosswalks authored on kit roads. Registered as
 * standard CrosswalkZones: pedestrians use the safety etiquette (cross when
 * no car threatens — no walk indicator governs them), and cars run the
 * unsignalled-street rules (courtesy yield to waiting pedestrians with
 * bounded patience + unconditional stop for occupied zones). Always loaded,
 * like the road graph and the intersection registry.
 */

export const WALK_CROSSINGS: CompiledWalkCrossing[] = COMPILED_SECTORS.flatMap(
  (c) => c.walkCrossings,
)

export const WALK_CROSSING_ZONES: CrosswalkZone[] = WALK_CROSSINGS.map((c) => ({
  id: c.id,
  center: c.center,
  size: [c.halfExtents[0] * 2, c.halfExtents[1] * 2],
  waitSpots: c.waitSpots.map((s) => [...s] as [number, number]),
  connectedSidewalkNodeIds: [],
  affectedLaneIds: [],
}))

const BY_ID = new Map(WALK_CROSSING_ZONES.map((z) => [z.id, z]))

export function getWalkCrossingZone(id: string): CrosswalkZone | undefined {
  return BY_ID.get(id)
}
