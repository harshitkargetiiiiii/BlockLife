import type { RobberyActivityDefinition } from './activityTypes'
import { worldToSectorId } from '../world/sectors/worldGrid'
import { STORE_MAINST_INTERIOR, STORE_KIOSK_INTERIOR } from '../interiors/interiorRegistry'

/**
 * The two authored robbery targets. Everything robbery-specific is DATA here;
 * the runtime, engine, director, threat detector, loot and validation are all
 * generic. `sectorId` is derived from the exterior entrance position (never
 * hand-typed), so an entrance can't claim a sector it isn't in.
 *
 * Payouts are tuned against the current economy (meal ≈ $8, work shift ≈ $60,
 * City Courier $100, Hot Cargo $280): the convenience store is a mid reward, the
 * kiosk a quick small one.
 */

// Exterior entrance positions (city sidewalks) — also where police contain.
const MAINST_ENTRANCE: [number, number, number] = [132, 1.2, -318]
const KIOSK_ENTRANCE: [number, number, number] = [8, 1.2, -298]

const CONVENIENCE_STORE: RobberyActivityDefinition = {
  id: 'robbery_mainst_store',
  version: 1,
  kind: 'convenience_store',
  title: 'Main St Convenience',
  interiorId: 'store_mainst',
  cashierId: 'cashier_mainst',
  registerPosition: STORE_MAINST_INTERIOR.register,
  cashierPosition: STORE_MAINST_INTERIOR.cashier,
  // A shelf aisle on the east side: standing behind it blocks LOS to the counter.
  losBlockers: [{ x: STORE_MAINST_INTERIOR.origin[0] + 1.2, z: STORE_MAINST_INTERIOR.origin[1] - 1.5, halfW: 0.5, halfD: 1.6 }],
  threat: { holdSeconds: 1.2, range: 6, aimDotMin: 0.6 },
  cashRange: { min: 120, max: 260 },
  alarmPolicy: { kind: 'silent_delayed', delaySeconds: 12 },
  cooldownGameHours: 24,
  secureInteractableId: 'hotcargo_fixer',
  entranceInteractableId: 'store_mainst_entrance',
  entrancePosition: [MAINST_ENTRANCE[0], MAINST_ENTRANCE[2]],
  entranceHeading: Math.PI, // faces south, out toward the street
  sectorId: worldToSectorId(MAINST_ENTRANCE[0], MAINST_ENTRANCE[2]),
  seedKey: 'robbery_mainst_store',
  sourceRef: { file: 'src/game/criminalActivities/activityDefinitions.ts', symbol: 'CONVENIENCE_STORE' },
}

const WATERFRONT_KIOSK: RobberyActivityDefinition = {
  id: 'robbery_waterfront_kiosk',
  version: 1,
  kind: 'cashbox',
  title: 'Waterfront Kiosk',
  interiorId: 'store_kiosk',
  cashierId: 'cashier_kiosk',
  registerPosition: STORE_KIOSK_INTERIOR.register,
  cashierPosition: STORE_KIOSK_INTERIOR.cashier,
  // Open booth — no shelves, clear line of sight.
  losBlockers: [],
  threat: { holdSeconds: 1.0, range: 5, aimDotMin: 0.55 },
  cashRange: { min: 40, max: 100 },
  // Open-air booth: no fixed alarm, only organic witnesses can report.
  alarmPolicy: { kind: 'none' },
  cooldownGameHours: 12,
  secureInteractableId: 'hotcargo_fixer',
  entranceInteractableId: 'store_kiosk_entrance',
  entrancePosition: [KIOSK_ENTRANCE[0], KIOSK_ENTRANCE[2]],
  entranceHeading: Math.PI,
  sectorId: worldToSectorId(KIOSK_ENTRANCE[0], KIOSK_ENTRANCE[2]),
  seedKey: 'robbery_waterfront_kiosk',
  sourceRef: { file: 'src/game/criminalActivities/activityDefinitions.ts', symbol: 'WATERFRONT_KIOSK' },
}

/** Deterministic definition order (never sorted at runtime). */
export const ROBBERY_DEFINITIONS: readonly RobberyActivityDefinition[] = [
  CONVENIENCE_STORE,
  WATERFRONT_KIOSK,
]

const BY_ID: Record<string, RobberyActivityDefinition> = Object.fromEntries(
  ROBBERY_DEFINITIONS.map((d) => [d.id, d]),
)

export function getRobberyDefinition(id: string): RobberyActivityDefinition | undefined {
  return BY_ID[id]
}

/** Find the robbery hosted by a given store interior, if any. */
export function getRobberyForInterior(interiorId: string): RobberyActivityDefinition | undefined {
  return ROBBERY_DEFINITIONS.find((d) => d.interiorId === interiorId)
}

export { MAINST_ENTRANCE, KIOSK_ENTRANCE }
