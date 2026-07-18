import type { ActivityGameEvent, RobberyOutcome } from './activityTypes'
import { getRobberyDefinition } from './activityDefinitions'
import {
  activityRuntime,
  getStoreState,
  nextRobberyAttemptId,
  nextSecureId,
} from './activityRuntime'
import { decideCashier, rollLoot } from './robberyLogic'

/**
 * The robbery state machine — the ONE place that advances a robbery. All world
 * queries and side effects (crime reporting, money, toasts, event fan-out) are
 * injected so the engine stays unit-testable without a browser, the store, or
 * physics. Loot and proceed-securing are receipt-guarded (exactly once). The
 * engine NEVER sets wanted stars or spawns police — it reports a crime through
 * the injected `reportCrime`, and the existing witness/wanted/dispatch stack
 * decides everything from there.
 */

export interface RobberyEngineContext {
  /** Pausable seconds clock (crime clock) — alarm timing. */
  gameTime: number
  /** In-game hours (day*24+hour) — cooldowns. */
  gameHours: number
  wantedLevel: number
  /** Safe to secure proceeds (no weapon drawn / not mid-fight). */
  outOfCombat: boolean
  /** Report a robbery crime → existing witness/wanted/dispatch. */
  reportCrime: (position: [number, number, number]) => void
  /** Add secured cash to the player through the store economy action. */
  applyMoney: (amount: number) => void
  /** Fan a typed activity event out to the UI + any observing mission. */
  emit: (event: ActivityGameEvent) => void
  toast: (text: string) => void
}

export type BeginFailure = 'unknown' | 'already_active' | 'on_cooldown' | 'register_empty'

export interface BeginResult {
  ok: boolean
  reason?: BeginFailure
}

function markStoreRobbed(storeId: string, gameHours: number, cooldownHours: number): void {
  const store = getStoreState(storeId)
  const readyAt = gameHours + cooldownHours
  store.cooldownReadyAtGameHours = Math.max(store.cooldownReadyAtGameHours, readyAt)
  store.registerEmptied = true
}

function resolveRobbery(outcome: RobberyOutcome, amount: number): void {
  const active = activityRuntime.active
  if (!active) return
  activityRuntime.resultSeq += 1
  activityRuntime.result = {
    activityId: active.activityId,
    attemptId: active.attemptId,
    outcome,
    amount,
    seq: activityRuntime.resultSeq,
  }
  activityRuntime.active = null
}

/**
 * Start a robbery once threat detection has confirmed sustained aim. Guards on
 * availability (no active robbery, store off cooldown, register not already
 * emptied). Resolves the cashier decision + arms the alarm deterministically.
 */
export function beginRobbery(activityId: string, ctx: RobberyEngineContext): BeginResult {
  const def = getRobberyDefinition(activityId)
  if (!def) return { ok: false, reason: 'unknown' }
  if (activityRuntime.active) {
    return { ok: false, reason: 'already_active' }
  }
  const store = getStoreState(def.id)
  if (store.cooldownReadyAtGameHours > ctx.gameHours) return { ok: false, reason: 'on_cooldown' }
  if (store.registerEmptied) return { ok: false, reason: 'register_empty' }

  const attemptId = nextRobberyAttemptId(def.id)
  const decision = decideCashier(def, store.robberyCount)
  activityRuntime.active = {
    activityId: def.id,
    attemptId,
    storeId: def.id,
    phase: decision === 'comply' ? 'demanding' : 'threatening',
    cashierPhase: decision === 'comply' ? 'complying' : decision === 'flee' ? 'fled' : 'refused',
    decision,
    threatSeconds: def.threat.holdSeconds,
    alarmReportsAtGameTime: null,
    alarmFired: false,
    lootAmount: 0,
    startedAtGameTime: ctx.gameTime,
    lastEventSeq: activityRuntime.eventSeq,
  }
  activityRuntime.result = null

  // Arm the alarm per the store policy.
  const policy = def.alarmPolicy
  if (policy.kind === 'silent_delayed') {
    activityRuntime.active.alarmReportsAtGameTime = ctx.gameTime + policy.delaySeconds
  }

  emitEvent(ctx, { type: 'threat_started', activityId: def.id, storeId: def.id })
  emitEvent(ctx, { type: 'cashier_decided', activityId: def.id, decision })
  if (policy.kind === 'panic_immediate') fireAlarm(ctx)
  return { ok: true }
}

/** Fire the store alarm exactly once: report the crime + close the store. */
export function fireAlarm(ctx: RobberyEngineContext): void {
  const active = activityRuntime.active
  if (!active || active.alarmFired) return
  const def = getRobberyDefinition(active.activityId)
  if (!def) return
  active.alarmFired = true
  active.alarmReportsAtGameTime = null
  // Report through the existing crime/witness/wanted stack — NEVER set wanted
  // or spawn police here. Position is the cashier's counter.
  ctx.reportCrime([def.cashierPosition[0], 0, def.cashierPosition[1]])
  markStoreRobbed(def.id, ctx.gameHours, def.cooldownGameHours)
  emitEvent(ctx, { type: 'alarm_triggered', activityId: def.id, storeId: def.id })
}

/** Per-frame alarm advance (director drives this; gameTime comparison only). */
export function tickAlarm(ctx: RobberyEngineContext): void {
  const active = activityRuntime.active
  if (!active || active.alarmFired || active.alarmReportsAtGameTime === null) return
  if (ctx.gameTime >= active.alarmReportsAtGameTime) fireAlarm(ctx)
}

/** Empty the register — deterministic loot, exactly once, into unsecured proceeds. */
export function lootRegister(ctx: RobberyEngineContext): number {
  const active = activityRuntime.active
  if (!active || active.phase !== 'demanding') return 0
  const def = getRobberyDefinition(active.activityId)
  if (!def) return 0
  if (activityRuntime.lootReceipts[active.attemptId]) return 0 // already looted this attempt

  const amount = rollLoot(def, active.attemptId)
  activityRuntime.lootReceipts[active.attemptId] = {
    attemptId: active.attemptId,
    storeId: def.id,
    amount,
    atGameHours: ctx.gameHours,
  }
  active.lootAmount = amount
  active.phase = 'looted'
  activityRuntime.unsecuredProceeds += amount
  const store = getStoreState(def.id)
  store.robberyCount += 1
  markStoreRobbed(def.id, ctx.gameHours, def.cooldownGameHours)
  emitEvent(ctx, { type: 'register_looted', activityId: def.id, storeId: def.id, amount })
  // The looted robbery is done as an in-progress activity — the crime + escape
  // now live in the wanted/police stack; the money is unsecured until secured.
  activityRuntime.active = null
  return amount
}

/** Player left / holstered / walked out before taking the money. */
export function abandonRobbery(ctx: RobberyEngineContext): void {
  const active = activityRuntime.active
  if (!active) return
  const def = getRobberyDefinition(active.activityId)
  emitEvent(ctx, {
    type: 'robbery_abandoned',
    activityId: active.activityId,
    storeId: active.storeId,
  })
  if (def) resolveRobbery('abandoned', 0)
}

/**
 * Convert unsecured proceeds to money at the fixer — only wanted 0 and out of
 * combat. Idempotent: the balance is zeroed, so a repeat converts nothing.
 */
export function secureProceeds(ctx: RobberyEngineContext): number {
  const amount = activityRuntime.unsecuredProceeds
  if (amount <= 0) return 0
  if (ctx.wantedLevel > 0 || !ctx.outOfCombat) return 0
  const secureId = nextSecureId()
  activityRuntime.secureReceipts[secureId] = { secureId, amount, atGameHours: ctx.gameHours }
  activityRuntime.unsecuredProceeds = 0
  ctx.applyMoney(amount)
  emitEvent(ctx, { type: 'proceeds_secured', amount })
  activityRuntime.resultSeq += 1
  activityRuntime.result = {
    activityId: 'secure',
    attemptId: secureId,
    outcome: 'secured',
    amount,
    seq: activityRuntime.resultSeq,
  }
  return amount
}

/** Arrest / incapacitation: lose all unsecured proceeds exactly once, end any robbery. */
export function loseProceeds(cause: 'arrested' | 'incapacitated', ctx: RobberyEngineContext): number {
  // End any in-flight robbery first (no loot carried through an incident).
  if (activityRuntime.active) resolveRobbery('busted', 0)
  const amount = activityRuntime.unsecuredProceeds
  if (amount <= 0) return 0
  activityRuntime.unsecuredProceeds = 0
  emitEvent(ctx, { type: 'proceeds_lost', amount, cause })
  return amount
}

function emitEvent(ctx: RobberyEngineContext, event: ActivityGameEvent): void {
  activityRuntime.eventSeq += 1
  activityRuntime.lastEventType = event.type
  if (activityRuntime.active) activityRuntime.active.lastEventSeq = activityRuntime.eventSeq
  ctx.emit(event)
}

/** Dismiss the terminal banner (UI). */
export function dismissRobberyResult(): void {
  activityRuntime.result = null
}
