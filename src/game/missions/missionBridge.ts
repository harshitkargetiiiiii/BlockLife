import type { MissionGameEvent, MissionRewardDefinition } from './missionTypes'
import {
  applyMissionEvent,
  cancelMission,
  discoverMission,
  retryMission,
  startMission,
  type MissionEngineContext,
  type StartResult,
} from './missionEngine'
import { missionRuntime } from './missionRuntime'
import { selectMissionTarget } from './missionSelectors'
import { getWantedLevel } from '../crime/wantedRuntime'
import { getCrimeGameTime } from '../crime/crimeSystem'
import {
  STEALABLE_VEHICLES,
  clearStolenPlayerCar,
  getPlayerCarSourceId,
  getVehicleCrimeState,
} from '../vehicles/vehicleCrimeState'

/**
 * The narrow live adapter between the running game and the pure mission engine.
 * Registered once by the store (the `register…` sink pattern the crime damage
 * system already uses), so missions never import the store and there is no
 * circular dependency. It builds the injected engine context from the wanted
 * runtime, the crime clock, the store hooks and the vehicle-eligibility scan,
 * then forwards typed events into the engine and re-projects the UI.
 */

export interface MissionBridgeHooks {
  /** In-game hours (stats.day*24 + stats.hour). */
  getGameHours: () => number
  /** Apply granted rewards to the player through the store's economy actions. */
  applyRewards: (rewards: MissionRewardDefinition[], moneyTotal: number) => void
  toast: (text: string) => void
  /** Re-project missionRuntime → the store's UI-reactive mission fields. */
  onUiChanged: () => void
}

let hooks: MissionBridgeHooks | null = null

export function registerMissionBridge(h: MissionBridgeHooks): void {
  hooks = h
}

/**
 * Eligible Hot Cargo targets: civilian stealables that are not already stolen,
 * not disabled, and not mission-owned. Occupied cars are preferred (the
 * carjacking system is stable); parked cars are the fallback.
 */
export function getEligibleTargets(): string[] {
  const ownedByMission = missionRuntime.active?.ownedEntityIds ?? new Set<string>()
  const eligible = STEALABLE_VEHICLES.filter((v) => {
    const rec = getVehicleCrimeState(v.id)
    return !rec.stolen && !rec.disabled && !ownedByMission.has(v.id)
  })
  const occupied = eligible.filter((v) => v.access === 'civilian_occupied').map((v) => v.id)
  if (occupied.length > 0) return occupied
  return eligible.map((v) => v.id)
}

function buildContext(): MissionEngineContext {
  const getGameHours = hooks?.getGameHours ?? (() => 0)
  const gameHours = getGameHours()
  return {
    gameHours,
    gameTime: getCrimeGameTime(),
    wantedLevel: getWantedLevel(),
    drivenVehicleSourceId: getPlayerCarSourceId(),
    resolveTarget: (selectorId) =>
      selectMissionTarget({
        missionId: missionRuntime.active?.missionId ?? 'unknown',
        selectorId,
        attemptSeq: missionRuntime.attemptSeq,
        gameDay: Math.max(1, Math.floor(gameHours / 24)),
        candidates: getEligibleTargets(),
      }),
    applyRewards: (rewards, moneyTotal) => hooks?.applyRewards(rewards, moneyTotal),
    toast: (text) => hooks?.toast(text),
  }
}

/** Feed one gameplay event to the active mission, then refresh the UI. */
export function emitMissionEvent(event: MissionGameEvent): void {
  if (!hooks) return
  // Capture the boosted target BEFORE applying: if this event resolves the
  // mission (handoff, fail, cancel) while the player still drives that exact
  // target, the car is no longer theirs — clear its stolen identity.
  const before = missionRuntime.active
  const boostedTarget = before?.variables.targetVehicle as string | undefined
  applyMissionEvent(event, buildContext())
  if (before && !missionRuntime.active && boostedTarget && getPlayerCarSourceId() === boostedTarget) {
    clearStolenPlayerCar()
  }
  hooks.onUiChanged()
}

/**
 * Report that the player just boosted `newVehicleId`. If an active mission's
 * boosted target was the car the player WAS driving (prevSourceId) and this is
 * a DIFFERENT vehicle, the target has been abandoned/replaced — emit
 * `vehicle_lost` so a `target_vehicle_lost` failure rule can fire deterministically.
 */
export function notifyVehicleStolen(prevSourceId: string | null, newVehicleId: string): void {
  const target = missionRuntime.active?.variables.targetVehicle as string | undefined
  if (target && prevSourceId === target && newVehicleId !== target) {
    emitMissionEvent({ type: 'vehicle_lost', vehicleId: target })
  }
}

export function acceptMission(missionId: string): StartResult {
  if (!hooks) return { ok: false, reason: 'unknown_mission' }
  const r = startMission(missionId, buildContext())
  hooks.onUiChanged()
  return r
}

export function cancelActiveMission(): boolean {
  if (!hooks) return false
  const r = cancelMission(buildContext())
  hooks.onUiChanged()
  return r
}

export function retryLastMission(): StartResult {
  if (!hooks) return { ok: false, reason: 'unknown_mission' }
  const r = retryMission(buildContext())
  hooks.onUiChanged()
  return r
}

export function discoverAndOfferMission(missionId: string): void {
  discoverMission(missionId)
  hooks?.onUiChanged()
}
