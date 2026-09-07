import { PROPS } from './cityLayout'
import type { PropType } from './worldTypes'

/**
 * Issue #47 Wave 4 — which approved vehicle BODY each authored parked placement renders.
 *
 * This module is PURELY VISUAL and adds no entity of any kind. The parked cars and trucks are
 * authored PROPS: `cityLayout.ts` and the district-authoring kit own every id, position,
 * rotation and streaming membership; `propSolidity.ts` owns their collision; `propPlacement.ts`
 * owns the visual envelope each body is fitted inside. Nothing here is a vehicle class — there is
 * no `VehicleDef`, no collider, no seat, no tuning, no ownership record and no save field, and
 * the drivable one-shell model is untouched. All this decides is which of two approved GLB bodies
 * a given placement draws, with `CarMesh` / `TruckMesh` still the fallback underneath.
 *
 * ## The mapping rule
 *
 * Issue #47 asks for a "deterministic placement-id mapping" that is also "visually balanced" with
 * "no crowd of identical bodies in one camera view". A plain `hash(id) % poolSize` satisfies the
 * first and fails the second: measured against the shipped placements it puts identical bodies
 * 5.9 m apart in the central lot and repeats one van three times across the industrial yard,
 * because a hash knows nothing about where a placement stands.
 *
 * So the rule is a deterministic SPATIAL sweep instead of a hash. Placements of a type are
 * processed in ascending id order — a total, stable order that does not depend on array position
 * — and each takes the pool body whose nearest already-assigned instance is FARTHEST away, with
 * the pool's own order breaking ties. That is a pure function of authored data: same inputs,
 * same assignment, every session, on every machine, before and after streaming.
 *
 * The property it buys is asserted in `wave4Contract.test.ts`, not assumed here: no two
 * placements within `PARKED_BODY_MIN_SEPARATION` share a body, and each pool member is used a
 * balanced number of times. (Perfect separation is not always reachable and the gate does not
 * pretend otherwise: the central lot has three placements inside a 9 m triangle, so with two
 * approved car bodies one repeat there is forced by geometry. The gate's threshold is the
 * distance at which two identical bodies read as cloned, not the width of the whole frame.)
 */

/** The approved Wave-4 body pool for each authored parked prop type, in declaration order. */
export const PARKED_BODY_POOLS: Readonly<Record<'parked_car' | 'parked_truck', readonly string[]>> = {
  parked_car: ['vehicle_parked_hatchback_01', 'vehicle_parked_pickup_01'],
  parked_truck: ['vehicle_parked_delivery_van_01', 'vehicle_parked_box_truck_01'],
}

/** Every asset id this module can return — the Wave-4 parked bodies, flattened. */
export const PARKED_BODY_ASSET_IDS: readonly string[] = [
  ...PARKED_BODY_POOLS.parked_car,
  ...PARKED_BODY_POOLS.parked_truck,
]

/**
 * Below this distance (world units) two identical parked bodies read as a copy-paste rather than
 * as two cars that happen to be the same model. Two car lengths: the shipped `parked_car`
 * envelope is 4 m long, so 8 m is "one clear gap between them".
 */
export const PARKED_BODY_MIN_SEPARATION = 8

export type ParkedPropType = keyof typeof PARKED_BODY_POOLS

export function isParkedPropType(type: PropType): type is ParkedPropType {
  return type === 'parked_car' || type === 'parked_truck'
}

export interface ParkedPlacement {
  id: string
  position: readonly [number, number]
}

/**
 * The pure rule. Exported so the contract test can re-derive the shipped assignment from
 * `cityLayout` instead of trusting the memoized map below, and so a future authored placement is
 * covered by construction rather than by editing a table.
 */
export function assignParkedBodies(
  placements: readonly ParkedPlacement[],
  pool: readonly string[],
): Map<string, string> {
  const out = new Map<string, string>()
  if (pool.length === 0) return out
  const placed: { position: readonly [number, number]; body: string }[] = []
  const ordered = [...placements].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
  for (const p of ordered) {
    let best = pool[0]
    let bestNearest = -1
    for (const body of pool) {
      let nearest = Number.POSITIVE_INFINITY
      for (const other of placed) {
        if (other.body !== body) continue
        nearest = Math.min(nearest, Math.hypot(other.position[0] - p.position[0], other.position[1] - p.position[1]))
      }
      // An unused body is the best possible choice; `Infinity` compares correctly against any
      // finite distance, so no special case is needed.
      if (nearest > bestNearest) {
        bestNearest = nearest
        best = body
      }
    }
    out.set(p.id, best)
    placed.push({ position: p.position, body: best })
  }
  return out
}

function buildAssignment(): Map<string, string> {
  const out = new Map<string, string>()
  for (const type of Object.keys(PARKED_BODY_POOLS) as ParkedPropType[]) {
    const placements = PROPS.filter((p) => p.type === type).map((p) => ({
      id: p.id,
      position: p.position as readonly [number, number],
    }))
    for (const [id, body] of assignParkedBodies(placements, PARKED_BODY_POOLS[type])) out.set(id, body)
  }
  return out
}

/**
 * Computed once at module load from authored constants (29 placements → a few hundred distance
 * comparisons), so `Props.tsx` reads it, never recomputes it, and never touches it per frame.
 */
const ASSIGNMENT: ReadonlyMap<string, string> = buildAssignment()

/** The shipped placement → body map. Read-only; exposed for tests and DEV tooling. */
export function parkedBodyAssignment(): ReadonlyMap<string, string> {
  return ASSIGNMENT
}

/**
 * The approved body a parked placement renders, or `undefined` for a placement this wave does
 * not cover — in which case the caller keeps the procedural mesh, exactly as before.
 */
export function parkedBodyAssetId(placementId: string): string | undefined {
  return ASSIGNMENT.get(placementId)
}
