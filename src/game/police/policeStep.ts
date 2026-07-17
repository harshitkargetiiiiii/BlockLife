import type { Vec2, Vec3 } from '../world/worldTypes'
import {
  clearWanted,
  getWantedLevel,
  policeLostSight,
  policeSighting,
  wantedRuntime,
} from '../crime/wantedRuntime'
import { createRng, hashString } from '../traffic/routing/routeRng'
import { emitDamage } from '../combat/damageRuntime'
import { stepDispatch } from './dispatchDirector'
import {
  activeCounts,
  policeRuntime,
  recordArrest,
  spawnPoliceOfficer,
} from './policeRuntime'
import { stepPoliceUnit } from './policeAI'
import type { CameraBox } from './policeSpawns'
import { POLICE_CAPS } from './policeTypes'
import { planDismounts } from './policeDismount'
import {
  clearPoliceRoute,
  nextPoliceWaypoint,
  planPoliceRoute,
  POLICE_CLOSE_RANGE,
  shouldReplanPolice,
  type PoliceVehicleRouteMode,
} from './policeRoute'

/** Return-fire tuning: officers in combat shoot at the suspect, imperfectly. */
const POLICE_FIRE_COOLDOWN = 1.5
const POLICE_FIRE_WARMUP = 1.0
const POLICE_DAMAGE = 9

/**
 * Per-frame police orchestration, kept pure/side-effect-scoped so it is unit
 * testable without React. Runs dispatch reconciliation, steps every active
 * unit's AI, relays aggregate line-of-sight to the wanted runtime (pursuit ↔
 * search), and resolves an arrest into a real consequence (clears wanted, so
 * the dispatch drains the fleet next tick).
 */

export interface PoliceDirectorInput {
  gameTime: number
  dt: number
  /** Suspect world position (x,z). */
  suspectPos: Vec2
  suspectInVehicle: boolean
  suspectSpeed: number
  cameraBox: CameraBox | null
  hasLos: (from: Vec2, to: Vec2) => boolean
  avoid?: (pos: Vec2) => Vec2
  /** Validated cruiser exit for a dismounting officer (live driver supplies). */
  findSafeExit?: (x: number, z: number, heading: number) => Vec2
}

export interface PoliceDirectorResult {
  anySees: boolean
  arrested: boolean
}

export function stepPoliceDirector(input: PoliceDirectorInput): PoliceDirectorResult {
  stepDispatch({
    gameTime: input.gameTime,
    suspectPosition: input.suspectPos,
    cameraBox: input.cameraBox,
  })

  const forceCombat = getWantedLevel() === 3 || wantedRuntime.policeAttacked
  const lastKnown: Vec2 | null = wantedRuntime.lastKnownPosition
    ? [wantedRuntime.lastKnownPosition[0], wantedRuntime.lastKnownPosition[2]]
    : null

  let anySees = false
  let arrested = false
  for (const unit of policeRuntime.units.values()) {
    // Emergency road-graph pursuit: a cruiser beyond close range follows a
    // planned road route toward the suspect (or last-known); within close range
    // it steers directly for containment. Bounded replan (cadence / drift).
    let roadWaypoint: Vec2 | null = null
    if (unit.kind === 'vehicle') {
      const chase: Vec2 = unit.seesSuspect ? input.suspectPos : (lastKnown ?? input.suspectPos)
      const range = Math.hypot(unit.position[0] - chase[0], unit.position[1] - chase[1])
      if (range > POLICE_CLOSE_RANGE) {
        const mode: PoliceVehicleRouteMode = unit.seesSuspect
          ? input.suspectInVehicle
            ? 'intercept_suspect'
            : 'follow_last_known_route'
          : 'respond_to_incident'
        if (shouldReplanPolice(unit.id, chase, input.gameTime)) {
          planPoliceRoute(unit.id, mode, unit.position, chase, input.gameTime)
        }
        roadWaypoint = nextPoliceWaypoint(unit.id, unit.position)
      } else {
        clearPoliceRoute(unit.id)
      }
    }

    const r = stepPoliceUnit(unit, {
      suspectPos: input.suspectPos,
      lastKnown,
      suspectInVehicle: input.suspectInVehicle,
      suspectSpeed: input.suspectSpeed,
      forceCombat,
      gameTime: input.gameTime,
      dt: input.dt,
      hasLos: input.hasLos,
      avoid: input.avoid,
      roadWaypoint,
      onFoot: unit.kind === 'officer',
    })
    if (r.sees) anySees = true
    if (r.arrested) arrested = true

    // Return fire: an officer in combat with a visual shoots at the suspect
    // with distance-scaled, imperfect accuracy (deterministic per shot).
    if (unit.state === 'combat' && unit.seesSuspect) {
      const warmedUp = input.gameTime - unit.spawnedAt >= POLICE_FIRE_WARMUP
      const offCooldown = input.gameTime - unit.lastShotAt >= POLICE_FIRE_COOLDOWN
      if (warmedUp && offCooldown) {
        unit.lastShotAt = input.gameTime
        const dist = Math.hypot(
          input.suspectPos[0] - unit.position[0],
          input.suspectPos[1] - unit.position[1],
        )
        const chance = Math.max(0.12, Math.min(0.55, 0.6 - dist * 0.012))
        const rng = createRng(hashString(`pshot_${unit.id}_${Math.floor(input.gameTime * 10)}`))
        if (rng() < chance) {
          emitDamage({
            sourceId: unit.id,
            targetId: 'player',
            targetKind: 'player',
            amount: POLICE_DAMAGE,
            kind: 'bullet',
            position: input.suspectPos,
            gameTime: input.gameTime,
          })
        }
      }
    }
  }

  // Dismount pass: a cruiser that has closed on an ON-FOOT suspect puts an
  // officer on the street (once per cruiser, capped by the wanted level). The
  // live driver supplies a validated cruiser-exit resolver.
  const level = getWantedLevel()
  if (level >= 1) {
    const plans = planDismounts({
      units: [...policeRuntime.units.values()],
      suspectPos: input.suspectPos,
      suspectOnFoot: !input.suspectInVehicle,
      officerCap: POLICE_CAPS[level].officers,
      currentOfficers: activeCounts().officers,
    })
    for (const plan of plans) {
      const cruiser = policeRuntime.units.get(plan.cruiserId)
      if (!cruiser) continue
      const exit: Vec2 = input.findSafeExit
        ? input.findSafeExit(cruiser.position[0], cruiser.position[1], cruiser.heading)
        : [cruiser.position[0] + 1.6, cruiser.position[1]]
      spawnPoliceOfficer(plan.cruiserId, exit, plan.incidentId, input.gameTime)
    }
  }

  // Relay line of sight to wanted. policeSighting/policeLostSight self-guard on
  // status, so calling them every frame produces exactly one pursuit→search
  // transition when the last officer loses visual.
  const suspect3: Vec3 = [input.suspectPos[0], 1, input.suspectPos[1]]
  if (anySees) policeSighting(suspect3, input.gameTime)
  else policeLostSight(input.gameTime)

  if (arrested) {
    recordArrest(input.gameTime)
    clearWanted()
  }
  return { anySees, arrested }
}
