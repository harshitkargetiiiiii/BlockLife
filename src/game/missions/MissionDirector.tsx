import { useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import { useGameStore } from '../store/useGameStore'
import { registry, getFollowTargetPosition } from '../world/runtimeRegistry'
import { getWantedLevel } from '../crime/wantedRuntime'
import { PLAYER_CAR_ID, getStealable, getPlayerCarSourceId } from '../vehicles/vehicleCrimeState'
import { missionRuntime } from './missionRuntime'
import { getMissionDefinition } from './missionDefinitions'
import { distanceToAnchor, getMissionAnchor, isInsideAnchor } from './missionAnchors'
import { emitMissionEvent } from './missionBridge'

/**
 * The live mission driver — bounded per-frame checks that turn continuous world
 * state into discrete mission events, and publish a throttled UI projection. It
 * owns NO durable state (that lives in missionRuntime); it just observes. Zone
 * checks run at ~10 Hz and the UI distance at ~4 Hz, so nothing writes React
 * state every frame. Mounted once at the app root, so it survives streaming.
 */

const ZONE_CHECK_INTERVAL = 0.1
const UI_INTERVAL = 0.25

export function MissionDirector() {
  const prevWanted = useRef(0)
  const prevMode = useRef<'walking' | 'driving'>('walking')
  const zoneAccum = useRef(0)
  const uiAccum = useRef(0)

  useFrame((_, rawDt) => {
    const dt = Math.min(rawDt, 0.05)
    const store = useGameStore.getState()
    if (store.worldPaused) return

    // 1. Wanted-level transitions → wanted_changed (drives lose_wanted + gating).
    const wl = getWantedLevel()
    if (wl !== prevWanted.current) {
      emitMissionEvent({ type: 'wanted_changed', previous: prevWanted.current, current: wl })
      prevWanted.current = wl
    }

    // 2. Vehicle enter/exit transitions. When the player is driving a boosted
    //    mission target, use the target's id so exit_vehicle matches it.
    const mode = store.mode
    if (mode !== prevMode.current) {
      // Emit the id of the car the player is actually in: the boosted SOURCE
      // vehicle when driving a stolen car, else the generic drivable car. Using
      // the real source (not "any stolen car == target") keeps exit_vehicle
      // matching honest when a decoy has replaced the target.
      const source = getPlayerCarSourceId()
      const id = source ?? PLAYER_CAR_ID
      if (mode === 'driving') emitMissionEvent({ type: 'vehicle_entered', vehicleId: id })
      else emitMissionEvent({ type: 'vehicle_exited', vehicleId: id })
      prevMode.current = mode
    }

    const active = missionRuntime.active
    if (!active) {
      // Keep the UI mirror in sync while nothing is active (banner + lists).
      uiAccum.current += dt
      if (uiAccum.current >= UI_INTERVAL) {
        uiAccum.current = 0
        store.syncMissionUI(null)
      }
      return
    }
    const def = getMissionDefinition(active.missionId)
    const obj = def?.objectives[active.objectiveIndex]
    if (!def || !obj) return

    // 3. Zone objectives (bounded cadence). reach_zone uses the follow target
    //    (player on foot OR the car when driving); drive_vehicle_to_zone requires
    //    the boosted target in the zone, stopped, and no heat.
    zoneAccum.current += dt
    if (zoneAccum.current >= ZONE_CHECK_INTERVAL) {
      zoneAccum.current = 0
      if (obj.kind === 'reach_zone') {
        const f = getFollowTargetPosition(store.mode)
        if (isInsideAnchor(obj.anchorId, f.x, f.z)) {
          emitMissionEvent({ type: 'reached_zone', anchorId: obj.anchorId })
        }
      } else if (obj.kind === 'drive_vehicle_to_zone') {
        // The delivered car must be the EXACT boosted target — the player's
        // drivable car must currently represent that target's source id, not
        // merely be "some stolen car".
        const targetId = active.variables[obj.targetVehicleFromVariable] as string | undefined
        const drivingTarget =
          store.mode === 'driving' && targetId !== undefined && getPlayerCarSourceId() === targetId
        if (drivingTarget) {
          const v = registry.vehiclePosition
          const speed = Math.abs(registry.flags.drivingSpeed)
          // A staging park (requireClean:false) doesn't need zero heat; a clean
          // delivery does. The engine re-checks the same gate authoritatively.
          const cleanOk = obj.requireClean === false || getWantedLevel() === 0
          if (isInsideAnchor(obj.anchorId, v.x, v.z) && speed <= (obj.maxSpeed ?? 3) && cleanOk) {
            emitMissionEvent({ type: 'reached_zone', anchorId: obj.anchorId })
          }
        }
      }
    }

    // 4. Publish the current-objective distance to the HUD at a bounded cadence.
    uiAccum.current += dt
    if (uiAccum.current >= UI_INTERVAL) {
      uiAccum.current = 0
      store.syncMissionUI(currentObjectiveDistance(store))
    }
  })

  return null
}

/** Planar distance from the player/car to the current objective marker, or null. */
function currentObjectiveDistance(store: ReturnType<typeof useGameStore.getState>): number | null {
  const active = missionRuntime.active
  if (!active) return null
  const def = getMissionDefinition(active.missionId)
  const obj = def?.objectives[active.objectiveIndex]
  if (!obj) return null
  const f = getFollowTargetPosition(store.mode)
  switch (obj.kind) {
    case 'reach_zone':
    case 'drive_vehicle_to_zone':
    case 'rob_store':
    case 'secure_proceeds':
      return distanceToAnchor(obj.anchorId, f.x, f.z)
    case 'interact':
    case 'deliver_vehicle':
    case 'return_to_giver': {
      const a = getMissionAnchor(anchorForInteractable(obj.interactableId))
      return a ? Math.hypot(f.x - a.position[0], f.z - a.position[2]) : null
    }
    case 'steal_vehicle': {
      const targetId = active.variables[obj.writeTargetToVariable] as string | undefined
      const v = targetId ? getStealable(targetId) : undefined
      return v ? Math.hypot(f.x - v.position[0], f.z - v.position[1]) : null
    }
    case 'enter_vehicle': {
      // Return-to-the-getaway-car: the boosted car sits wherever the player left
      // it — the single drivable car body's live position. On foot the follow
      // target is the player, so this is the real walk-back distance.
      const v = registry.vehiclePosition
      return Math.hypot(f.x - v.x, f.z - v.z)
    }
    default:
      return null
  }
}

/** Map a mission interactable id to its co-located anchor (for distance/markers). */
function anchorForInteractable(interactableId: string): string {
  if (interactableId === 'courier_depot') return 'courier_depot'
  if (interactableId === 'hotcargo_fixer') return 'hotcargo_garage'
  return interactableId
}
