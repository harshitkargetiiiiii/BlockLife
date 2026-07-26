/**
 * Career, Skills & Life Progression v1 — the type keystone (issue #15).
 *
 * ONE deterministic career platform, NOT four one-off jobs. The career runtime
 * owns employment, ranks, shifts, performance, promotion progress and skills;
 * MONEY stays with the economy authority, ITEMS with inventory, RELATIONSHIPS
 * with the social system, WANTED/ARREST with crime, and TIME with the game clock.
 * Nothing here references a mesh, body, or React node — definitions are IMMUTABLE
 * data with stable ids + source refs; the live runtime is a module singleton.
 *
 * Shifts reuse the mission objective/event VOCABULARY (reach_zone / interact /
 * collect via anchors + interactables) as a small step machine — they do NOT
 * instantiate a second mission engine (CONVENTIONS #23).
 */

// ---- skills (§2: exactly five persistent skills) --------------------------

export type SkillId = 'fitness' | 'driving' | 'social' | 'street_smarts' | 'work_ethic'

export const SKILL_IDS: readonly SkillId[] = ['fitness', 'driving', 'social', 'street_smarts', 'work_ethic'] as const

/** XP is a bounded integer per skill; the level is DERIVED (0–10). */
export const SKILL_XP_MIN = 0
export const SKILL_XP_MAX = 1000
export const SKILL_MAX_LEVEL = 10
/** XP needed for each level boundary (index == level). Deterministic + inspectable. */
export const SKILL_LEVEL_THRESHOLDS: readonly number[] = [0, 20, 50, 90, 140, 200, 280, 380, 500, 650, 1000] as const

export type SkillMap = Record<SkillId, number>

/** Typed reasons an XP award can carry (for DEV tools + anti-farm bucketing). */
export type SkillAwardReason =
  | 'shift_completed'
  | 'shift_optional_objective'
  | 'shift_on_time'
  | 'training_milestone'
  | 'favor_completed'
  | 'social_activity'
  | 'customer_served'
  | 'delivery_completed'
  | 'crime_escaped'
  | 'crime_witnessed'

/** A single bounded XP award to one skill, keyed for exact-once + daily caps. */
export interface SkillAward {
  skill: SkillId
  amount: number
  reason: SkillAwardReason
}

/** Per-source daily caps where farming is possible (issue #2). Keyed by reason. */
export const SKILL_DAILY_CAP: Partial<Record<SkillAwardReason, number>> = {
  crime_escaped: 12,
  crime_witnessed: 8,
  social_activity: 20,
  customer_served: 24,
}

// ---- careers, employers, ranks --------------------------------------------

export type CareerId = 'delivery_driver' | 'cafe_retail' | 'gym_trainer' | 'trade_worker'
export type EmployerId = string
export type RankId = 'trainee' | 'regular' | 'experienced' | 'senior'
export type ShiftTemplateId = 'delivery_route' | 'cafe_service' | 'gym_trainer' | 'trade_work'

export const CAREER_IDS: readonly CareerId[] = ['delivery_driver', 'cafe_retail', 'gym_trainer', 'trade_worker'] as const
export const RANK_ORDER: readonly RankId[] = ['trainee', 'regular', 'experienced', 'senior'] as const

/** A visible benefit granted on reaching a rank (§8: ≥1 immediate unlock/career). */
export interface CareerUnlock {
  /** Stable, unique id (also the exact-once key when granted). */
  id: string
  kind: 'pay_raise' | 'shift_variant' | 'discount' | 'equipment' | 'access' | 'future_hook'
  label: string
}

/** What it takes to be PROMOTED into a rank (undefined on the entry rank). */
export interface PromotionRequirement {
  completedShifts: number
  /** Minimum derived level per skill. */
  skills: Partial<Record<SkillId, number>>
  /** Minimum rolling recent performance (0–100). */
  minRecentPerformance: number
  /** Attendance gate: at most this many missed shifts on record. */
  maxMissedShifts: number
  /** Optional employer standing gate (0–100). */
  minEmployerStanding?: number
}

export interface RankDefinition {
  id: RankId
  displayName: string
  /** Multiplier applied to base pay (deterministic, bounded). */
  payModifier: number
  /** Requirement to REACH this rank (undefined for the entry rank). */
  promotion?: PromotionRequirement
  /** Benefits unlocked on reaching this rank. */
  unlocks: CareerUnlock[]
}

/** Entry requirements to be hired at the trainee rank. */
export interface EntryRequirement {
  skills?: Partial<Record<SkillId, number>>
  /** Global reputation floor (uses the existing reputation authority). */
  minReputation?: number
  /** A social recommendation from this employer/actor RELAXES the skill/rep gate. */
  recommendationRelaxesFrom?: EmployerId
}

/** How a completed shift's 0–100 score is weighted (§6). Weights sum to 1. */
export interface PerformanceWeights {
  attendance: number
  requiredObjectives: number
  optionalObjectives: number
  mistakes: number
  timeEfficiency: number
}

export interface CareerDefinition {
  id: CareerId
  displayName: string
  description: string
  employerId: EmployerId
  employerDisplayName: string
  /** A named social actor employer where applicable (Maya, Coach Bruno). */
  employerActorId?: string
  /** Where the player reports / the shift is anchored. */
  workplaceInteractableId: string
  entry: EntryRequirement
  /** Four ranks: trainee → regular → experienced → senior. */
  ranks: RankDefinition[]
  basePay: number
  shiftTemplateId: ShiftTemplateId
  /** Duration + start-window scheduling defaults. */
  shiftDurationHours: number
  primarySkills: SkillId[]
  secondarySkills: SkillId[]
  performanceWeights: PerformanceWeights
  /** Crime gates: apply/start blocked above these wanted levels. */
  maxWantedToApply: number
  maxWantedToStart: number
  /** True for the comparatively-accessible career (kept open after minor crime). */
  lenientCrime: boolean
  sourceRef: { file: string; symbol: string }
}

// ---- shift lifecycle (§4) -------------------------------------------------

export type ShiftStatus = 'scheduled' | 'available' | 'active' | 'completed' | 'missed' | 'failed' | 'cancelled'

export type ShiftCompletionReason =
  | 'completed'
  | 'missed_window'
  | 'arrested'
  | 'incapacitated'
  | 'cancelled_by_player'
  | 'abandoned'

/** The bounded start window: a shift is startable from START_EARLY_HOURS before its
 *  start hour through GRACE_HOURS after (past which it is a missed no-show). */
export const SHIFT_START_EARLY_HOURS = 1
export const SHIFT_GRACE_HOURS = 3

/** A single step of an instantiated shift template (Slice 3). */
export type ShiftStepKind = 'report' | 'collect' | 'travel' | 'serve' | 'deliver' | 'task' | 'wrap'

export interface ShiftObjectiveState {
  id: string
  kind: ShiftStepKind
  description: string
  /** Anchor / interactable the step resolves against (reused world primitives). */
  anchorId?: string
  interactableId?: string
  itemId?: string
  quantity?: number
  optional: boolean
  done: boolean
  /** True once a mistake was recorded against this step (lowers performance). */
  mistake?: boolean
}

export interface PerformanceBreakdown {
  attendance: number
  requiredObjectives: number
  optionalObjectives: number
  mistakes: number
  timeEfficiency: number
}

export interface PerformanceResult {
  /** Bounded 0–100. */
  score: number
  breakdown: PerformanceBreakdown
  /** Human-readable typed reasons for the results UI. */
  notes: string[]
  onTime: boolean
  requiredDone: number
  requiredTotal: number
  optionalDone: number
  optionalTotal: number
  mistakes: number
}

export interface PayResult {
  base: number
  rankModifier: number
  performanceModifier: number
  /** Final integer dollars paid through the economy authority. */
  total: number
}

export interface ScheduledShift {
  id: string
  careerId: CareerId
  employerId: EmployerId
  rank: RankId
  templateId: ShiftTemplateId
  scheduledDay: number
  startHour: number
  graceHours: number
  durationHours: number
  workplaceInteractableId: string
  status: ShiftStatus
  /** Exact-once attempt key — pay + XP for this shift can be granted at most once. */
  attemptKey: string
  completionReason?: ShiftCompletionReason
  performance?: PerformanceResult
  pay?: PayResult
  /** Instantiated template steps (present once active). */
  objectives?: ShiftObjectiveState[]
  /** Current step index while active. */
  stepIndex?: number
  startedAtHour?: number
  /** Whether the player clocked in within the on-time part of the window. */
  onTime?: boolean
}

// ---- career-specific standing + history (§9: NOT global reputation) -------

export const EMPLOYER_STANDING_MIN = 0
export const EMPLOYER_STANDING_MAX = 100
export const EMPLOYER_STANDING_DEFAULT = 40

export interface CareerHistory {
  careerId: CareerId
  completedShifts: number
  missedShifts: number
  failedShifts: number
  highestRank: RankId
  totalEarned: number
}

/** A bounded rolling performance record for promotion math. */
export interface PerformanceRecord {
  careerId: CareerId
  shiftId: string
  score: number
  onTime: boolean
  day: number
}

// ---- bounds (all collections are capped) ----------------------------------

export const SCHEDULED_SHIFTS_MAX = 8
export const PERFORMANCE_HISTORY_MAX = 20
export const APPLIED_CAREER_EVENT_ID_MAX = 256
export const PAID_ATTEMPT_KEY_MAX = 64
export const UNLOCKS_MAX = 64
/** Recent window (shifts) the promotion math averages performance over. */
export const RECENT_PERFORMANCE_WINDOW = 5

// ---- save slice (§13: additive, fail-safe) --------------------------------

/** The serializable career/progression save slice. All fields optional/additive;
 *  old saves lack it and load with canonical defaults. No runtime object refs. */
export interface CareerSaveData {
  version: number
  skills?: Partial<SkillMap>
  skillLedger?: Record<string, number>
  activeJob?: CareerId | null
  ranks?: Partial<Record<CareerId, RankId>>
  history?: Partial<Record<CareerId, CareerHistory>>
  employerStanding?: Record<EmployerId, number>
  scheduledShifts?: ScheduledShift[]
  activeShift?: ScheduledShift | null
  performanceHistory?: PerformanceRecord[]
  unlocks?: string[]
  appliedEventIds?: string[]
  paidAttemptKeys?: string[]
  recommendations?: EmployerId[]
  shiftSeq?: number
}
