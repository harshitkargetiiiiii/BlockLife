import { useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import { useGameStore } from '../store/useGameStore'
import { registry } from '../world/runtimeRegistry'
import { getWeaponSnapshot } from '../combat/weaponRuntime'
import { activityRuntime } from './activityRuntime'
import { getRobberyForInterior } from './activityDefinitions'
import { hasLineOfSight, isAimingAtCashier } from './robberyLogic'
import {
  abandonActiveRobbery,
  tickRobberyAlarm,
  tryBeginRobbery,
} from './activityBridge'

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
    if (activityRuntime.active) tickRobberyAlarm()

    // 2. Threat detection only while inside a robbable store interior.
    const interiorId = store.currentInteriorId
    const def = store.location === 'store' && interiorId ? getRobberyForInterior(interiorId) : undefined

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
