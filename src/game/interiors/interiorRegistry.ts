import type { Vec2 } from '../world/worldTypes'
import { worldToSectorId } from '../world/sectors/worldGrid'
import {
  APARTMENT_SPAWN,
  APARTMENT_STREET_EXIT,
  INTERIOR_ORIGIN as APARTMENT_ORIGIN,
} from './apartmentLayout'

/**
 * Reusable interior registry (Store Robbery v1). Generalises the apartment-only
 * model just far enough to host a small set of interiors — the apartment plus
 * two robbable stores — WITHOUT rewriting the proven approach: every interior is
 * a self-contained room parked far outside CITY_BOUNDS, always mounted (cheap
 * static geometry), entered/left by a teleport + a `location` flag. The city
 * simulation keeps running while you are inside.
 *
 * A def holds ids, positions and scalars only. Old saves are unaffected: the
 * apartment entry reuses the exact original constants, and `location` still
 * defaults to 'city'.
 */

export type InteriorKind = 'apartment' | 'store'

export interface InteriorDef {
  id: string
  kind: InteriorKind
  /** Far-off-grid room origin (x,z). Unique per interior. */
  origin: Vec2
  /** Player spawn just inside, absolute world coords. */
  spawn: [number, number, number]
  /** Where the player pops out in the city on exit. */
  streetExit: [number, number, number]
  /** Sector owning the street exit (derived — streaming/teleport readiness). */
  streetSectorId: string
  /** Interior room inner size (x width, z depth). */
  size: { width: number; depth: number }
  /**
   * While inside, block wanted DECAY (the crime director reads this) so a store
   * can never be used to melt a pursuit. The apartment forbids entry while
   * wanted, so its value is moot; stores set true (you may enter while wanted).
   */
  suppressesWantedDecay: boolean
}

// Interiors are parked well outside CITY_BOUNDS and each other. The apartment
// keeps its original [200,200]; stores sit further out on distinct axes.
const STORE_MAINST_ORIGIN: Vec2 = [260, 205]
const STORE_KIOSK_ORIGIN: Vec2 = [205, 265]

function interior(
  def: Omit<InteriorDef, 'streetSectorId'> & { streetExit: [number, number, number] },
): InteriorDef {
  return { ...def, streetSectorId: worldToSectorId(def.streetExit[0], def.streetExit[2]) }
}

/** Convenience-store interior spawn/register geometry, derived from its origin. */
export const STORE_MAINST_INTERIOR = {
  origin: STORE_MAINST_ORIGIN,
  spawn: [STORE_MAINST_ORIGIN[0], 1.2, STORE_MAINST_ORIGIN[1] + 3.6] as [number, number, number],
  register: [STORE_MAINST_ORIGIN[0] - 1.4, STORE_MAINST_ORIGIN[1] - 2.0] as Vec2,
  cashier: [STORE_MAINST_ORIGIN[0] - 1.4, STORE_MAINST_ORIGIN[1] - 3.0] as Vec2,
}

export const STORE_KIOSK_INTERIOR = {
  origin: STORE_KIOSK_ORIGIN,
  spawn: [STORE_KIOSK_ORIGIN[0], 1.2, STORE_KIOSK_ORIGIN[1] + 2.4] as [number, number, number],
  register: [STORE_KIOSK_ORIGIN[0], STORE_KIOSK_ORIGIN[1] - 1.4] as Vec2,
  cashier: [STORE_KIOSK_ORIGIN[0], STORE_KIOSK_ORIGIN[1] - 2.2] as Vec2,
}

export const INTERIORS: readonly InteriorDef[] = [
  interior({
    id: 'apartment',
    kind: 'apartment',
    origin: APARTMENT_ORIGIN,
    spawn: APARTMENT_SPAWN,
    streetExit: APARTMENT_STREET_EXIT,
    size: { width: 11, depth: 9 },
    suppressesWantedDecay: false,
  }),
  interior({
    id: 'store_mainst',
    kind: 'store',
    origin: STORE_MAINST_ORIGIN,
    spawn: STORE_MAINST_INTERIOR.spawn,
    // Main Street North sidewalk, just outside the store front.
    streetExit: [132, 1.2, -318],
    size: { width: 10, depth: 9 },
    suppressesWantedDecay: true,
  }),
  interior({
    id: 'store_kiosk',
    kind: 'store',
    origin: STORE_KIOSK_ORIGIN,
    spawn: STORE_KIOSK_INTERIOR.spawn,
    // Waterfront promenade, beside the kiosk booth.
    streetExit: [8, 1.2, -298],
    size: { width: 6, depth: 5 },
    suppressesWantedDecay: true,
  }),
]

const BY_ID: Record<string, InteriorDef> = Object.fromEntries(INTERIORS.map((i) => [i.id, i]))

export function getInterior(id: string): InteriorDef | undefined {
  return BY_ID[id]
}

/** Store interiors only (the robbable ones). */
export const STORE_INTERIORS: readonly InteriorDef[] = INTERIORS.filter((i) => i.kind === 'store')
