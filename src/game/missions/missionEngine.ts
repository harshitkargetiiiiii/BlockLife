import type {
  ActiveMissionRuntime,
  MissionDefinition,
  MissionFailureReason,
  MissionGameEvent,
  MissionObjectiveDefinition,
  MissionRewardDefinition,
} from './missionTypes'
import { getMissionDefinition } from './missionDefinitions'
import { clearActiveMission, getMissionHistory, missionRuntime, nextAttemptId } from './missionRuntime'
import { claimMissionReward } from './missionRewards'

/**
 * The mission state machine — a side-effect-scoped reducer over the mission
 * runtime singleton. It is the ONE place that advances a mission: start,
 * per-event progression, completion, failure, cancellation, retry. All
 * progression is idempotent (repeated/stale events cannot double-advance), a
 * reward is claimed exactly once via a receipt, and terminal resolution runs
 * cleanup exactly once. World queries and side effects (target resolution,
 * reward application, toasts) are injected so the engine stays unit-testable
 * without a browser or the store.
 */

export interface MissionEngineContext {
  /** In-game hours (day*24 + hour) — cooldowns + history. */
  gameHours: number
  /** Pausable seconds clock — objective timers. */
  gameTime: number
  /** Current wanted level (drives lose_wanted + delivery gating). */
  wantedLevel: number
  /** The source vehicle the player's drivable car currently represents, or
      null. Used so a `deliver_vehicle` handoff only completes for the EXACT
      boosted target — not any stolen replacement. */
  drivenVehicleSourceId: string | null
  /** Resolve a deterministic target vehicle id for a steal selector, or null.
      `preferParked` biases the eligible pool toward a quiet parked grab. */
  resolveTarget: (selectorId: string, opts?: { preferParked?: boolean }) => string | null
  /** Apply granted rewards to the player (money via store economy, items via giveItem). */
  applyRewards: (rewards: MissionRewardDefinition[], moneyTotal: number) => void
  /** Surface a short message to the player. */
  toast: (text: string) => void
}

export type StartFailure =
  | 'unknown_mission'
  | 'already_active'
  | 'another_active'
  | 'on_cooldown'
  | 'no_target'

export interface StartResult {
  ok: boolean
  reason?: StartFailure
}

function activeDef(): MissionDefinition | undefined {
  return missionRuntime.active ? getMissionDefinition(missionRuntime.active.missionId) : undefined
}

function currentObjective(
  def: MissionDefinition,
  active: ActiveMissionRuntime,
): MissionObjectiveDefinition | undefined {
  return def.objectives[active.objectiveIndex]
}

/** Mark this mission discovered (e.g. the player met the fixer). */
export function discoverMission(missionId: string): void {
  missionRuntime.discovered.add(missionId)
}

export function startMission(missionId: string, ctx: MissionEngineContext): StartResult {
  const def = getMissionDefinition(missionId)
  if (!def) return { ok: false, reason: 'unknown_mission' }
  if (missionRuntime.active) {
    return {
      ok: false,
      reason: missionRuntime.active.missionId === missionId ? 'already_active' : 'another_active',
    }
  }
  const cd = missionRuntime.cooldowns[missionId]
  if (cd && cd.readyAtGameHours > ctx.gameHours) return { ok: false, reason: 'on_cooldown' }

  const attemptId = nextAttemptId(missionId)
  const active: ActiveMissionRuntime = {
    missionId,
    missionVersion: def.version,
    attemptId,
    status: 'active',
    objectiveIndex: 0,
    objectiveStates: Object.fromEntries(
      def.objectives.map((o) => [o.id, { id: o.id, phase: 'pending' as const, progress: 0 }]),
    ),
    variables: {},
    ownedEntityIds: new Set<string>(),
    activeMarkerIds: new Set<string>(),
    startedAtGameTime: ctx.gameTime,
    lastEventSeq: missionRuntime.eventSeq,
  }
  missionRuntime.active = active
  missionRuntime.result = null
  missionRuntime.lastFailureReason = null

  // Activating the first objective may resolve a target or chain-complete.
  const activated = activateObjective(def, active, 0, ctx)
  if (!activated.ok) {
    // Could not stand up the opening objective (e.g. no eligible target).
    missionRuntime.active = null
    return { ok: false, reason: activated.reason }
  }
  return { ok: true }
}

/** Stand up an objective; resolve its target / chain trivially-satisfied ones. */
function activateObjective(
  def: MissionDefinition,
  active: ActiveMissionRuntime,
  index: number,
  ctx: MissionEngineContext,
): { ok: boolean; reason?: StartFailure } {
  const obj = def.objectives[index]
  if (!obj) return { ok: true }
  active.objectiveIndex = index
  active.objectiveStates[obj.id].phase = 'active'
  active.status = 'active'

  if (obj.kind === 'steal_vehicle') {
    const target = ctx.resolveTarget(obj.targetSelectorId, { preferParked: obj.preferParked })
    if (!target) return { ok: false, reason: 'no_target' }
    active.variables[obj.writeTargetToVariable] = target
    active.ownedEntityIds.add(target)
  }

  // A lose_wanted objective completes instantly if the player is already clear
  // (e.g. an unwitnessed theft never raised heat).
  if (obj.kind === 'lose_wanted' && ctx.wantedLevel <= obj.requiredLevel) {
    return completeCurrentObjective(def, active, ctx)
  }
  return { ok: true }
}

/** Complete the current objective and advance (or finish the mission). */
function completeCurrentObjective(
  def: MissionDefinition,
  active: ActiveMissionRuntime,
  ctx: MissionEngineContext,
): { ok: boolean; reason?: StartFailure } {
  const obj = currentObjective(def, active)
  if (!obj) return { ok: true }
  if (active.objectiveStates[obj.id].phase === 'complete') return { ok: true }
  active.objectiveStates[obj.id].phase = 'complete'

  const next = active.objectiveIndex + 1
  if (next >= def.objectives.length) {
    resolveTerminal('completed', undefined, ctx)
    return { ok: true }
  }
  return activateObjective(def, active, next, ctx)
}

/** Does `event` satisfy `obj` given the active runtime + context? */
function objectiveSatisfiedBy(
  obj: MissionObjectiveDefinition,
  event: MissionGameEvent,
  active: ActiveMissionRuntime,
  ctx: MissionEngineContext,
): boolean {
  switch (obj.kind) {
    case 'reach_zone':
    case 'return_to_giver':
      if (obj.kind === 'reach_zone') {
        return event.type === 'reached_zone' && event.anchorId === obj.anchorId
      }
      return event.type === 'interactable_used' && event.interactableId === obj.interactableId
    case 'interact':
      return event.type === 'interactable_used' && event.interactableId === obj.interactableId
    case 'collect_item':
      return false // handled with accumulation below (see applyMissionEvent)
    case 'enter_vehicle': {
      if (event.type !== 'vehicle_entered') return false
      const want = obj.vehicleFromVariable ? active.variables[obj.vehicleFromVariable] : undefined
      return want === undefined || event.vehicleId === want
    }
    case 'steal_vehicle': {
      if (event.type !== 'vehicle_stolen') return false
      return event.vehicleId === active.variables[obj.writeTargetToVariable]
    }
    case 'drive_vehicle_to_zone':
      // The driver only emits reached_zone for this anchor when the TARGET
      // vehicle is in-zone and stopped; a clean DELIVERY additionally gates on
      // wanted 0 (rejected while wanted). A STAGING park (requireClean:false)
      // skips that gate so a hot getaway car can still be positioned.
      return (
        event.type === 'reached_zone' &&
        event.anchorId === obj.anchorId &&
        (obj.requireClean === false || ctx.wantedLevel === 0)
      )
    case 'lose_wanted':
      return event.type === 'wanted_changed' && event.current <= obj.requiredLevel
    case 'exit_vehicle': {
      if (event.type !== 'vehicle_exited') return false
      const want = obj.vehicleFromVariable ? active.variables[obj.vehicleFromVariable] : undefined
      return want === undefined || event.vehicleId === want
    }
    case 'deliver_vehicle': {
      if (event.type !== 'interactable_used' || event.interactableId !== obj.interactableId) {
        return false
      }
      // The handoff only counts for the EXACT boosted target. The player's
      // drivable car must currently represent that target vehicle — a decoy /
      // replacement steal has a different source id and is rejected here.
      const want = active.variables[obj.targetVehicleFromVariable]
      return want !== undefined && ctx.drivenVehicleSourceId === want
    }
    case 'rob_store':
      // OBSERVE the robbery subsystem: the marked store's register was looted
      // for at least the required take.
      return (
        event.type === 'activity_event' &&
        event.event.type === 'register_looted' &&
        event.event.storeId === obj.activityId &&
        event.event.amount >= obj.minAmount
      )
    case 'secure_proceeds':
      return event.type === 'activity_event' && event.event.type === 'proceeds_secured'
  }
}

function failureReasonFor(event: MissionGameEvent, active: ActiveMissionRuntime): MissionFailureReason | null {
  const def = getMissionDefinition(active.missionId)
  if (!def) return null
  const rules = new Set(def.failureRules.map((r) => r.kind))
  if (event.type === 'player_arrested' && rules.has('player_arrested')) return 'player_arrested'
  if (event.type === 'player_incapacitated' && rules.has('player_incapacitated')) {
    return 'player_incapacitated'
  }
  if (event.type === 'vehicle_disabled' && rules.has('target_vehicle_disabled')) {
    // Only the mission's target vehicle failing counts.
    if (active.ownedEntityIds.has(event.vehicleId)) return 'target_vehicle_disabled'
  }
  if (event.type === 'vehicle_lost' && rules.has('target_vehicle_lost')) {
    // The boosted target was abandoned/replaced. Only the mission's own target
    // counts (a lost non-mission vehicle is irrelevant).
    if (active.ownedEntityIds.has(event.vehicleId)) return 'target_vehicle_lost'
  }
  return null
}

/**
 * Feed one gameplay event to the active mission. Idempotent: an event that
 * doesn't satisfy the current objective (wrong vehicle, wrong zone, a repeat)
 * is ignored, and a completed objective never re-completes.
 */
export function applyMissionEvent(event: MissionGameEvent, ctx: MissionEngineContext): void {
  missionRuntime.eventSeq += 1
  missionRuntime.lastEventType = event.type
  const active = missionRuntime.active
  const def = activeDef()
  if (!active || !def) return
  active.lastEventSeq = missionRuntime.eventSeq

  // Failure rules take precedence over progression.
  const failReason = failureReasonFor(event, active)
  if (failReason) {
    resolveTerminal('failed', failReason, ctx)
    return
  }

  const obj = currentObjective(def, active)
  if (!obj) return

  // collect_item accumulates toward its quantity.
  if (obj.kind === 'collect_item' && event.type === 'item_acquired' && event.itemId === obj.itemId) {
    const state = active.objectiveStates[obj.id]
    state.progress += event.quantity
    if (state.progress >= obj.quantity) completeCurrentObjective(def, active, ctx)
    return
  }

  if (objectiveSatisfiedBy(obj, event, active, ctx)) {
    completeCurrentObjective(def, active, ctx)
  }
}

/** Resolve the active mission terminally (once), grant reward, set cooldown, clean up. */
function resolveTerminal(
  outcome: 'completed' | 'failed' | 'cancelled',
  reason: MissionFailureReason | undefined,
  ctx: MissionEngineContext,
): void {
  const active = missionRuntime.active
  const def = activeDef()
  if (!active || !def) return

  if (outcome === 'completed') {
    const claim = claimMissionReward(def.id, active.attemptId, def.rewards, ctx.gameHours)
    if (!claim.alreadyClaimed) {
      ctx.applyRewards(claim.rewards, claim.moneyTotal)
      const prev = getMissionHistory(def.id)
      const seconds = Math.max(0, ctx.gameTime - active.startedAtGameTime)
      missionRuntime.history[def.id] = {
        missionId: def.id,
        completions: prev.completions + 1,
        lastCompletedGameHours: ctx.gameHours,
        totalEarned: prev.totalEarned + claim.moneyTotal,
        bestObjectiveSeconds:
          prev.bestObjectiveSeconds === undefined
            ? seconds
            : Math.min(prev.bestObjectiveSeconds, seconds),
      }
      if (def.repeatable && def.cooldownGameHours) {
        missionRuntime.cooldowns[def.id] = {
          missionId: def.id,
          readyAtGameHours: ctx.gameHours + def.cooldownGameHours,
        }
      }
    }
  }

  missionRuntime.resultSeq += 1
  missionRuntime.result = {
    missionId: def.id,
    attemptId: active.attemptId,
    outcome,
    reason,
    seq: missionRuntime.resultSeq,
  }
  missionRuntime.lastFailureReason = reason ?? null
  // Cleanup: dropping the active runtime releases owned ids + markers; the live
  // driver observes the null active and clears any rendered markers.
  missionRuntime.active = null
}

/** Cancel the active mission (safe, no reward, no wanted reset). */
export function cancelMission(ctx: MissionEngineContext): boolean {
  if (!missionRuntime.active) return false
  resolveTerminal('cancelled', 'mission_cancelled', ctx)
  return true
}

/** Retry the last-resolved mission as a fresh attempt (new attempt id). */
export function retryMission(ctx: MissionEngineContext): StartResult {
  if (missionRuntime.active) return { ok: false, reason: 'already_active' }
  const last = missionRuntime.result
  if (!last) return { ok: false, reason: 'unknown_mission' }
  return startMission(last.missionId, ctx)
}

/** Dismiss the terminal result banner (UI). */
export function dismissMissionResult(): void {
  missionRuntime.result = null
}

// Re-export for the driver + tests.
export { clearActiveMission }
