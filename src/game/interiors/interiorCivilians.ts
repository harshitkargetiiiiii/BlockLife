import type { Vec2 } from '../world/worldTypes'
import { STORE_INTERIORS, type InteriorDef } from './interiorRegistry'
import { getRobberyForInterior } from '../criminalActivities/activityDefinitions'
import type { RobberyActivityDefinition } from '../criminalActivities/activityTypes'
import {
  customerHomes,
  customerReaction,
  exitAnchor,
  hideSpots,
  stepCivilian,
  type CivilianActor,
  type InteriorLayout,
} from './interiorCivilianLogic'

/**
 * Module-singleton runtime for the routed store civilians (same two-tier pattern
 * as the crowd/traffic runtimes: ids + positions + scalars only, mutated in a
 * useFrame, never React state, so it survives interior remount and StrictMode
 * double-invoke without duplicating actors). The pure behaviour lives in
 * interiorCivilianLogic; this owns the per-interior actor set + lazy idempotent
 * init + reset, and derives every layout from the interior + robbery definitions
 * (one source of truth, no re-typed geometry).
 */

export function layoutFor(interior: InteriorDef, def: RobberyActivityDefinition): InteriorLayout {
  return {
    origin: interior.origin,
    halfWidth: interior.size.width / 2,
    halfDepth: interior.size.depth / 2,
    register: def.registerPosition,
    shelves: def.losBlockers,
  }
}

/** Nearest hide spot to a home post (stable — homes are authored constants). */
function nearestHide(home: Vec2, spots: Vec2[]): Vec2 {
  let best = spots[0]
  let bestD = Infinity
  for (const s of spots) {
    const d = Math.hypot(s[0] - home[0], s[1] - home[1])
    if (d < bestD) {
      bestD = d
      best = s
    }
  }
  return best
}

function buildActors(interior: InteriorDef, def: RobberyActivityDefinition): CivilianActor[] {
  const layout = layoutFor(interior, def)
  const exit = exitAnchor(layout)
  const spots = hideSpots(layout)
  const actors: CivilianActor[] = []

  // Cashier: reaction is driven live by the robbery decision (fled → flee to the
  // door, otherwise freeze at the register with hands up), so it's a placeholder
  // here and refreshed each step from the active robbery's cashierPhase.
  actors.push({
    id: `${interior.id}:cashier`,
    role: 'cashier',
    reaction: 'freeze',
    home: def.cashierPosition,
    safe: exit,
    pos: [def.cashierPosition[0], def.cashierPosition[1]],
    heading: 0,
    crouch: 0,
    arrived: true,
    reported: false,
  })

  // Customers: STABLE seeded personality (flee out / hide in cover / freeze).
  customerHomes(layout).forEach((home, i) => {
    const id = `${interior.id}:cust${i}`
    const reaction = customerReaction(id, i)
    actors.push({
      id,
      role: 'customer',
      reaction,
      home,
      safe: reaction === 'flee' ? exit : nearestHide(home, spots),
      pos: [home[0], home[1]],
      heading: Math.PI,
      crouch: 0,
      arrived: true,
      reported: false,
    })
  })
  return actors
}

interface CivilianRuntime {
  byInterior: Map<string, CivilianActor[]>
}

/** Lazily initialised, idempotent — safe under StrictMode double-invoke. */
export const interiorCiviliansRuntime: CivilianRuntime = { byInterior: new Map() }

/** Get (or lazily build) the actors for an interior. Idempotent. */
export function getCivilians(interior: InteriorDef, def: RobberyActivityDefinition): CivilianActor[] {
  let actors = interiorCiviliansRuntime.byInterior.get(interior.id)
  if (!actors) {
    actors = buildActors(interior, def)
    interiorCiviliansRuntime.byInterior.set(interior.id, actors)
  }
  return actors
}

/** Live-refresh the cashier's reaction from the robbery's cashier phase. */
export function cashierReactionFor(cashierPhase: string | undefined): CivilianActor['reaction'] {
  return cashierPhase === 'fled' ? 'flee' : 'freeze'
}

/** Did any civilian in this store reach safety and (idempotently) report? */
export function anyCivilianReported(interiorId: string): boolean {
  const actors = interiorCiviliansRuntime.byInterior.get(interiorId)
  return actors ? actors.some((a) => a.reported) : false
}

/** Reset all civilians to their homes (resetGame / dev + test API). */
export function resetInteriorCivilians(): void {
  interiorCiviliansRuntime.byInterior.clear()
}

// Re-export the pure step so the renderer drives actors without reaching in.
export { stepCivilian }

/** All robbable store interiors that have civilians (for debug/inspection). */
export function storeInteriorsWithCivilians(): { interior: InteriorDef; def: RobberyActivityDefinition }[] {
  const out: { interior: InteriorDef; def: RobberyActivityDefinition }[] = []
  for (const interior of STORE_INTERIORS) {
    const def = getRobberyForInterior(interior.id)
    if (def) out.push({ interior, def })
  }
  return out
}
