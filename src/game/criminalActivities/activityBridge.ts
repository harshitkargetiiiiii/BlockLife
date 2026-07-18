import type { ActivityGameEvent } from './activityTypes'
import {
  abandonRobbery,
  beginRobbery,
  fireAlarm,
  loseProceeds,
  lootRegister,
  secureProceeds,
  tickAlarm,
  type BeginResult,
  type RobberyEngineContext,
} from './robberyEngine'
import { activityRuntime } from './activityRuntime'
import { getRobberyDefinition } from './activityDefinitions'
import { getWantedLevel } from '../crime/wantedRuntime'
import { getCrimeGameTime } from '../crime/crimeSystem'
import { emitCrime } from '../crime/crimeRuntime'
import { fileReport } from '../crime/reportingSystem'
import { getWeaponSnapshot } from '../combat/weaponRuntime'

/**
 * The narrow live adapter between the running game and the pure robbery engine
 * (same register-sink pattern as missionBridge, so criminalActivities never
 * imports the store and there's no cycle). It builds the injected context from
 * the wanted runtime, crime clock, weapon state and the store hooks, routes the
 * alarm through the EXISTING crime/witness/wanted stack (never setting wanted or
 * spawning police), and fans typed activity events out to the UI and any
 * observing mission (Corner Take).
 */

export interface ActivityBridgeHooks {
  /** In-game hours (stats.day*24 + stats.hour). */
  getGameHours: () => number
  /** Add secured cash to the player through the store economy action. */
  applyMoney: (amount: number) => void
  toast: (text: string) => void
  /** Re-project activityRuntime → the store's UI-reactive fields. */
  onUiChanged: () => void
  /** Forward a typed activity event to an observing mission (bridged there). */
  onActivityEvent: (event: ActivityGameEvent) => void
}

let hooks: ActivityBridgeHooks | null = null

export function registerActivityBridge(h: ActivityBridgeHooks): void {
  hooks = h
}

/** Safe to secure proceeds only with the weapon holstered (out of combat). */
function isOutOfCombat(): boolean {
  return getWeaponSnapshot().pose === 'holstered'
}

function buildContext(): RobberyEngineContext {
  return {
    gameTime: getCrimeGameTime(),
    gameHours: hooks?.getGameHours() ?? 0,
    wantedLevel: getWantedLevel(),
    outOfCombat: isOutOfCombat(),
    // Report the robbery through the existing crime stack: emit an armed_robbery
    // crime and file a deterministic report by the cashier (like the carjack
    // owner report), so witness/wanted/dispatch take it from here. This code
    // NEVER sets wanted stars or spawns police.
    reportCrime: (position) => {
      const gt = getCrimeGameTime()
      const crime = emitCrime(
        { type: 'armed_robbery', position, suspectEntityId: 'player' },
        gt,
      )
      const cashierId = activityRuntime.active
        ? getRobberyDefinition(activityRuntime.active.activityId)?.cashierId
        : undefined
      if (crime) fileReport(crime, cashierId ?? 'store_alarm', gt)
    },
    applyMoney: (amount) => hooks?.applyMoney(amount),
    emit: (event) => {
      hooks?.onActivityEvent(event)
    },
    toast: (text) => hooks?.toast(text),
  }
}

/** Begin a robbery (director confirms sustained threat first). */
export function tryBeginRobbery(activityId: string): BeginResult {
  if (!hooks) return { ok: false, reason: 'unknown' }
  const r = beginRobbery(activityId, buildContext())
  hooks.onUiChanged()
  return r
}

/** Empty the register (register interaction). Returns cash taken. */
export function tryLootRegister(): number {
  if (!hooks) return 0
  const amount = lootRegister(buildContext())
  hooks.onUiChanged()
  return amount
}

/** Convert unsecured proceeds at the fixer. Returns cash secured (0 if gated). */
export function trySecureProceeds(): number {
  if (!hooks) return 0
  const amount = secureProceeds(buildContext())
  hooks.onUiChanged()
  return amount
}

/** Abandon the active robbery (left the store / holstered / walked out). */
export function abandonActiveRobbery(): void {
  if (!hooks || !activityRuntime.active) return
  abandonRobbery(buildContext())
  hooks.onUiChanged()
}

/** Per-frame: advance a pending silent alarm toward its report time. */
export function tickRobberyAlarm(): void {
  if (!hooks || !activityRuntime.active) return
  tickAlarm(buildContext())
  hooks.onUiChanged()
}

/**
 * A fled/hidden civilian reached safety and raises the alarm. Idempotent:
 * fireAlarm self-guards on `alarmFired`, so repeated calls report exactly once.
 * This is the organic-witness path — notably the ONLY report source for the
 * open-air kiosk (alarm policy 'none'), and it can trip a store's silent alarm
 * early when a witness escapes before the timer.
 */
export function reportRobberyByWitness(): void {
  if (!hooks || !activityRuntime.active) return
  fireAlarm(buildContext())
  hooks.onUiChanged()
}

/** Arrest / incapacitation → lose unsecured proceeds exactly once. */
export function onPlayerIncident(kind: 'arrest' | 'incapacitation'): number {
  if (!hooks) return 0
  const lost = loseProceeds(kind === 'arrest' ? 'arrested' : 'incapacitated', buildContext())
  hooks.onUiChanged()
  return lost
}
