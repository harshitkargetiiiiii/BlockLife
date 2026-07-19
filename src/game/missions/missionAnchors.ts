import type { Vec3 } from '../world/worldTypes'
import type { MissionAnchor } from './missionTypes'
import { sectorCoordToId, worldToSectorCoord } from '../world/sectors/worldGrid'

/**
 * Authored mission anchors — the SINGLE source of truth for mission world
 * locations. Mission definitions, the marker renderer, mission interactables,
 * the phone map and the tests all reference these by id; no downstream system
 * re-hardcodes a position. Each anchor's `sectorId` is derived from its
 * position (never typed by hand, so it can't drift from the world grid), and
 * `missionValidation` proves every anchor lands in a registered sector, on
 * accessible ground, clear of solids and traffic lanes.
 *
 * Positions were chosen on known-good open ground: the central plaza (Job
 * Board / courier depot), the Waterfront and Main Street North authored plazas,
 * and a clear apron in the Industrial Yard south strip for the fixer's garage.
 */

function anchor(
  id: string,
  kind: MissionAnchor['kind'],
  position: Vec3,
  radius: number,
  label: string,
): MissionAnchor {
  const coord = worldToSectorCoord(position[0], position[2])
  return {
    id,
    kind,
    position,
    radius,
    sectorId: sectorCoordToId(coord),
    label,
    sourceRef: { file: 'src/game/missions/missionAnchors.ts', symbol: id },
  }
}

export const MISSION_ANCHORS: readonly MissionAnchor[] = [
  // --- City Courier (lawful) — central plaza depot + two district drops ---
  // Depot sits on the open plaza SOUTH-WEST of the Nook Offices (clear ground,
  // reachable on foot), near the Job Board it reports back to.
  anchor('courier_depot', 'pickup', [8, 0, -2], 3, 'Courier Depot'),
  anchor('courier_waterfront', 'delivery', [2, 0, -304], 5, 'Waterfront Drop'),
  anchor('courier_mainstreet', 'delivery', [136, 0, -324], 5, 'Main St North Drop'),
  anchor('courier_return', 'return', [11, 0, -1.5], 3, 'Job Board'),
  // --- Hot Cargo (criminal) — Industrial Yard fixer / vehicle handoff ---
  // At the far (west) end of the yard, past the warehouse row and clear of the
  // service lane, so a boosted car can be driven right up to the garage.
  anchor('hotcargo_garage', 'garage', [-182, 0, -238], 6, "Fixer's Garage"),
  // --- Corner Take (criminal robbery wrapper) — markers only ---
  // The convenience store front on Main St North, and the same fixer for the
  // secure step. The mission OBSERVES the robbery; these anchors just point.
  anchor('cornertake_store', 'meeting', [132, 0, -318], 3, 'Main St Convenience'),
  anchor('cornertake_secure', 'garage', [-182, 0, -238], 6, "Fixer's Garage"),
  // --- Fast Exit (Robbery Pursuit & Getaway Polish v1) ---
  // A staging apron on the Main St North frontage, a short walk from the store
  // entrance (the police containment focus), where the getaway car is parked
  // before the hit. Generous radius so a stopped car reads as "in the bay".
  anchor('fastexit_staging', 'meeting', [140, 0, -322], 5, 'Getaway Staging'),
  // --- Shelf Run (Personal Economy, Inventory & Shopping v1) ---
  // A supply depot in the Industrial Yard (beside the fixer's garage apron) and
  // the Main St Convenience shopfront it stocks. Lawful commerce, not crime.
  anchor('shelfrun_depot', 'pickup', [-176, 0, -232], 3, 'Supply Depot'),
  anchor('shelfrun_store', 'delivery', [132, 0, -318], 4, 'Main St Convenience'),
]

const BY_ID: Record<string, MissionAnchor> = Object.fromEntries(
  MISSION_ANCHORS.map((a) => [a.id, a]),
)

export function getMissionAnchor(id: string): MissionAnchor | undefined {
  return BY_ID[id]
}

/** Planar (x,z) distance from a world point to an anchor centre. */
export function distanceToAnchor(anchorId: string, x: number, z: number): number {
  const a = BY_ID[anchorId]
  if (!a) return Infinity
  return Math.hypot(x - a.position[0], z - a.position[2])
}

/** True when (x,z) is inside the anchor's radius. */
export function isInsideAnchor(anchorId: string, x: number, z: number): boolean {
  const a = BY_ID[anchorId]
  if (!a) return false
  return distanceToAnchor(anchorId, x, z) <= a.radius
}
