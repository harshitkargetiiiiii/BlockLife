import { useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import { useGameStore } from '../store/useGameStore'
import { registry } from '../world/runtimeRegistry'
import { getWeaponSnapshot } from '../combat/weaponRuntime'
import { getWantedLevel } from '../crime/wantedRuntime'
import { policeRuntime } from '../police/policeRuntime'
import { activityRuntime } from './activityRuntime'
import { getRobberyForInterior, getRobberyDefinition } from './activityDefinitions'
import { hasLineOfSight, isAimingAtCashier } from './robberyLogic'
import { stepContainment } from './containmentLogic'
import {
  abandonActiveRobbery,
  reportRobberyByWitness,
  tickRobberyAlarm,
  tryBeginRobbery,
} from './activityBridge'
import { anyCivilianReported } from '../interiors/interiorCivilians'

/** A responder is "on scene" once a cruiser is within this radius of the door. */
const CONTAIN_ARRIVE_RADIUS = 9

/**
 * The live criminal-activity driver — bounded per-frame checks that turn
 * continuous world state (position, aim, weapon, location) into discrete
 * robbery transitions, and publish a throttled UI projection. Owns NO durable
 * state (that lives in activityRuntime); it just observes. Mounted once at the
 * app root, so it survives interior/sector streaming. Real clamped delta; no
 * per-frame React writes (projection at ~4 Hz only when it changes).
 */

const UI_INTERVAL = 0.2
/** Threat decays faster than it builds when the player looks away. */
const THREAT_DECAY_MULT = 2

export function ActivityDirector() {
  const threat = useRef(0)
  const uiAccum = useRef(0)

  useFrame((_, rawDt) => {
    const store = useGameStore.getState()
    if (store.worldPaused) return
    const dt = Math.min(rawDt, 0.05)

    // 1. A pending silent alarm advances on the crime clock, wherever the player is.
    if (activityRuntime.active) {
      tickRobberyAlarm()
      // A civilian who fled/hid to safety raises the alarm (idempotent). This is
      // the organic-witness report — the kiosk's only report source, and an
      // early trip for a silent-alarm store when a witness escapes first. Keyed
      // by the INTERIOR id (where the civilians live), not the activity id.
      const activeInterior = getRobberyDefinition(activityRuntime.active.activityId)?.interiorId
      if (activeInterior && anyCivilianReported(activeInterior)) reportRobberyByWitness()
    }

    // 1b. Police containment + breach escalation while the player is inside a
    //     robbed store WITH heat. Deterministic phase machine (real clamped
    //     delta); routes police to the entrance and forces a fair exit if the
    //     player tries to camp. Owns no police — it only advances the phase.
    const interiorId = store.currentInteriorId
    const insideStoreDef =
      store.location === 'store' && interiorId ? getRobberyForInterior(interiorId) : undefined
    const containStoreId = insideStoreDef && getWantedLevel() > 0 ? insideStoreDef.id : null
    const responders = countRespondersAtEntrance(containStoreId)
    const c = stepContainment(
      activityRuntime.containment,
      { activeStoreId: containStoreId, respondersOnScene: responders },
      dt,
    )
    if (c.forceExit) store.exitInterior() // breach: eject into the contained street

    // 2. Threat detection only while inside a robbable store interior.
    const def = insideStoreDef

    if (def) {
      const p = registry.playerPosition
      const pose = getWeaponSnapshot().pose
      const drawn = pose === 'drawn' || pose === 'aiming'
      const aiming =
        drawn &&
        isAimingAtCashier(def, p.x, p.z, registry.playerHeading) &&
        hasLineOfSight(def, p.x, p.z)

      if (!activityRuntime.active) {
        if (aiming) {
          threat.current += dt
          if (threat.current >= def.threat.holdSeconds) {
            tryBeginRobbery(def.id)
            threat.current = def.threat.holdSeconds
          }
        } else {
          threat.current = Math.max(0, threat.current - dt * THREAT_DECAY_MULT)
        }
      }
    } else {
      // Left the store mid-robbery (not yet looted) → abandon; drop the meter.
      if (activityRuntime.active) abandonActiveRobbery()
      threat.current = 0
    }

    // 3. Bounded UI projection.
    uiAccum.current += dt
    if (uiAccum.current >= UI_INTERVAL) {
      uiAccum.current = 0
      const hold = def?.threat.holdSeconds ?? 1
      store.syncActivityUI(Math.min(1, threat.current / hold))
    }
  })

  return null
}

/** Count police cruisers within arrival radius of a store's entrance (bounded:
 *  police units are capped at 3). Returns true once any responder is on scene. */
function countRespondersAtEntrance(storeId: string | null): boolean {
  if (!storeId) return false
  const def = getRobberyDefinition(storeId)
  if (!def) return false
  const [ex, ez] = def.entrancePosition
  for (const u of policeRuntime.units.values()) {
    if (u.kind !== 'vehicle') continue
    if (Math.hypot(u.position[0] - ex, u.position[1] - ez) <= CONTAIN_ARRIVE_RADIUS) return true
  }
  return false
}
