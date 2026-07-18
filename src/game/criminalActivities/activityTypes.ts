import type { Vec2 } from '../world/worldTypes'

/**
 * Store Robbery & Criminal Activities v1 — TYPES.
 *
 * A reusable, data-driven spontaneous-robbery subsystem that sits ON TOP of the
 * existing crime / witness / wanted / police / economy / interior stacks and
 * NEVER reimplements them. It owns the store/cashier/robbery state machines,
 * deterministic loot, and unsecured criminal proceeds; it emits crime events
 * through the existing crime runtime and typed activity events that a mission
 * (Corner Take) can OBSERVE.
 *
 * Definitions are immutable with stable ids. Runtime holds ids + scalars only
 * (never scene objects, refs or bodies) so it survives sector/interior
 * streaming. All randomness is seeded (createRng(hashString(key))).
 */

export type RobberyKind = 'convenience_store' | 'cashbox'

/** How a store raises the alarm once threatened. Reporting still flows through
 *  the existing witness/wanted stack — this only decides WHEN/whether. */
export type AlarmPolicy =
  /** Silent alarm armed on threat, reports after `delaySeconds` unless aborted. */
  | { kind: 'silent_delayed'; delaySeconds: number }
  /** Cashier hits a panic button immediately on threat. */
  | { kind: 'panic_immediate' }
  /** No fixed alarm — only organic witnesses (customers/passers-by) may report. */
  | { kind: 'none' }

/**
 * One authored robbery target. `interiorId` names the reusable interior the
 * robbery happens in (see interiorRegistry). `secureInteractableId` is the
 * criminal handoff where unsecured proceeds convert to money (the Industrial
 * Yard fixer). `sectorId` is DERIVED from the exterior entrance in the
 * definitions module (never hand-typed).
 */
export interface RobberyActivityDefinition {
  id: string
  version: number
  kind: RobberyKind
  title: string
  /** The interior this robbery takes place in (interiorRegistry id). */
  interiorId: string
  /** Stable cashier identity (seeds deterministic behaviour + panic). */
  cashierId: string
  /** Register position INSIDE the interior (absolute world coords). */
  registerPosition: Vec2
  /** Cashier stand position INSIDE the interior (absolute world coords). */
  cashierPosition: Vec2
  /** Axis-aligned rects (shelves) that block line of sight to the cashier. */
  losBlockers: readonly { x: number; z: number; halfW: number; halfD: number }[]
  /** Threat detection thresholds. */
  threat: {
    /** Sustained aim seconds before the cashier reacts. */
    holdSeconds: number
    /** Max planar distance (world units) player→cashier to threaten. */
    range: number
    /** Aim-cone acceptance: dot(facing, toCashier) must exceed this. */
    aimDotMin: number
  }
  /** Inclusive deterministic loot bounds (money units). */
  cashRange: { min: number; max: number }
  alarmPolicy: AlarmPolicy
  /** Game-hours the store is closed to robbery after an attempt. */
  cooldownGameHours: number
  /** Where proceeds are secured (interactable id — the fixer). */
  secureInteractableId: string
  /** Exterior entrance interactable id (opens the interior). */
  entranceInteractableId: string
  /** Exterior entrance position (city sidewalk) — police containment focus. */
  entrancePosition: Vec2
  /** Heading facing INTO the store from the entrance (containment forms up here). */
  entranceHeading: number
  /** Derived: sector owning the exterior entrance (streaming/validation). */
  sectorId: string
  /** Seed base for deterministic cashier decision + loot. */
  seedKey: string
  sourceRef: { file: string; symbol: string }
}

// ---- State machines -------------------------------------------------------

/**
 * The cashier's deterministic register reaction, chosen once per attempt by
 * stable identity. The ALARM is separate (driven by the store's AlarmPolicy),
 * so a cashier can comply and still have tripped a silent alarm.
 */
export type CashierDecision = 'comply' | 'flee' | 'refuse'

export type CashierPhase =
  | 'calm' // no threat
  | 'threatened' // being aimed at, deciding
  | 'complying' // opening the register
  | 'fled' // ran to a hide anchor
  | 'refused' // stood ground (non-graphic)

export type RobberyPhase =
  | 'idle' // no active robbery
  | 'threatening' // sustained aim in progress / cashier deciding
  | 'demanding' // cashier complying, register openable
  | 'looted' // register emptied, proceeds unsecured
  | 'aborted' // player left / holstered / abandoned before loot
  | 'resolved' // terminal (secured, or lost to arrest/incap)

export interface StoreRuntimeState {
  storeId: string
  /** Game-hours (day*24+hour) when robbery becomes possible again. */
  cooldownReadyAtGameHours: number
  /** Completed robbery attempts that reached loot/alarm (persisted). */
  robberyCount: number
  /** True while the register is emptied and not yet restocked (cooldown). */
  registerEmptied: boolean
}

export interface ActiveRobbery {
  activityId: string
  attemptId: string
  storeId: string
  phase: RobberyPhase
  cashierPhase: CashierPhase
  decision: CashierDecision | null
  /** Sustained aim accumulator (seconds), real clamped delta. */
  threatSeconds: number
  /** gameTime at which a silent alarm reports, or null if not armed. */
  alarmReportsAtGameTime: number | null
  /** Idempotent: the alarm/report has already fired for this attempt. */
  alarmFired: boolean
  /** Loot taken this attempt (0 until looted). */
  lootAmount: number
  startedAtGameTime: number
  lastEventSeq: number
}

// ---- Receipts (idempotency) ----------------------------------------------

/** One receipt per attempt — the register pays exactly once. */
export interface LootReceipt {
  attemptId: string
  storeId: string
  amount: number
  atGameHours: number
}

/** One receipt per secure operation — proceeds convert exactly once. */
export interface SecureReceipt {
  secureId: string
  amount: number
  atGameHours: number
}

// ---- Events (the narrow adapter a mission OBSERVES) ----------------------

export type ActivityGameEvent =
  | { type: 'threat_started'; activityId: string; storeId: string }
  | { type: 'cashier_decided'; activityId: string; decision: CashierDecision }
  | { type: 'alarm_triggered'; activityId: string; storeId: string }
  | { type: 'register_looted'; activityId: string; storeId: string; amount: number }
  | { type: 'robbery_abandoned'; activityId: string; storeId: string }
  | { type: 'proceeds_secured'; amount: number }
  | { type: 'proceeds_lost'; amount: number; cause: 'arrested' | 'incapacitated' }

export type ActivityEventType = ActivityGameEvent['type']

// ---- Terminal result (for the HUD banner) --------------------------------

export type RobberyOutcome = 'secured' | 'busted' | 'abandoned'

export interface RobberyResult {
  activityId: string
  attemptId: string
  outcome: RobberyOutcome
  amount: number
  seq: number
}

/** UI-reactive projection mirrored into the store at a bounded cadence. */
export interface ActivityView {
  /** Non-null while the player is inside a robbable store. */
  storeId: string | null
  storeTitle: string | null
  phase: RobberyPhase
  cashierPhase: CashierPhase
  /** 0..1 sustained-threat progress for the HUD meter. */
  threatProgress: number
  /** Whether the register is openable right now. */
  canLoot: boolean
  alarmArmed: boolean
  unsecuredProceeds: number
  /** True when standing at the fixer with securable proceeds. */
  canSecure: boolean
  /** Police containment phase around the store the player is inside. */
  containmentPhase: 'none' | 'responding' | 'contained' | 'warning' | 'breached'
  /** Seconds until the breach forces an exit, or null when not warning. */
  breachSeconds: number | null
  result: { outcome: RobberyOutcome; amount: number } | null
}
