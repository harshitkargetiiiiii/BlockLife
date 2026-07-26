/**
 * Reusable shift templates + the shift step machine (issue #15 §5/§6). A shift is a
 * small LINEAR step machine over REUSED world primitives (report at a workplace,
 * collect real cargo, visit real destinations, complete tasks) — NOT a second
 * mission engine (CONVENTIONS #23). Each step gates on a world condition the store
 * checks live (at the workplace? holding the cargo?), then the machine advances.
 * Performance (0–100) and pay are PURE + deterministic from the run, finalized
 * exactly once by the runtime.
 */
import {
  type CareerDefinition,
  type PerformanceBreakdown,
  type PerformanceResult,
  type PayResult,
  type RankDefinition,
  type ScheduledShift,
  type ShiftObjectiveState,
  type ShiftStepKind,
  type ShiftTemplateId,
} from './careerTypes'

interface ShiftStepDef {
  kind: ShiftStepKind
  description: string
  /** reach_zone / report target (a workplace or destination anchor id). */
  anchorId?: string
  /** collect real cargo through the inventory authority. */
  itemId?: string
  quantity?: number
  optional?: boolean
}

interface ShiftTemplateDef {
  id: ShiftTemplateId
  /** Fixed, deterministic destination anchors the route visits (reused world ids). */
  destinationAnchors: string[]
  buildSteps: (career: CareerDefinition, destinations: string[]) => ShiftStepDef[]
  /** One optional quality/safety objective that lifts performance when done. */
  optional: ShiftStepDef
}

// Deterministic real destinations reused from existing interactables/anchors.
const DELIVERY_STOPS = ['gym', 'food_truck_01', 'job_board']
const TRADE_STOPS = ['store_mainst_entrance', 'store_kiosk_entrance']

const TEMPLATES: Record<ShiftTemplateId, ShiftTemplateDef> = {
  delivery_route: {
    id: 'delivery_route',
    destinationAnchors: DELIVERY_STOPS,
    buildSteps: (career, dests) => [
      { kind: 'report', description: `Clock in at ${career.employerDisplayName}`, anchorId: career.workplaceInteractableId },
      { kind: 'collect', description: 'Load the parcels', itemId: 'restock_crate', quantity: 1 },
      ...dests.map((d, i) => ({ kind: 'deliver' as ShiftStepKind, description: `Deliver parcel ${i + 1}`, anchorId: d })),
      { kind: 'wrap', description: `Return to the depot`, anchorId: career.workplaceInteractableId },
    ],
    optional: { kind: 'task', description: 'Deliver every parcel on time', optional: true },
  },
  cafe_service: {
    id: 'cafe_service',
    destinationAnchors: [],
    buildSteps: (career) => [
      { kind: 'report', description: `Clock in at ${career.employerDisplayName}`, anchorId: career.workplaceInteractableId },
      { kind: 'serve', description: 'Serve the morning customers' },
      { kind: 'task', description: 'Restock the counter' },
      { kind: 'task', description: 'Clean down the station' },
    ],
    optional: { kind: 'serve', description: 'Handle the rush without a mistake', optional: true },
  },
  gym_trainer: {
    id: 'gym_trainer',
    destinationAnchors: [],
    buildSteps: (career) => [
      { kind: 'report', description: `Clock in at ${career.employerDisplayName}`, anchorId: career.workplaceInteractableId },
      { kind: 'task', description: 'Warm up the clients' },
      { kind: 'task', description: 'Run the training circuit' },
    ],
    optional: { kind: 'task', description: 'Nail the form demo', optional: true },
  },
  trade_work: {
    id: 'trade_work',
    destinationAnchors: TRADE_STOPS,
    buildSteps: (career, dests) => [
      { kind: 'report', description: `Clock in at ${career.employerDisplayName}`, anchorId: career.workplaceInteractableId },
      { kind: 'collect', description: 'Grab your tools + materials', itemId: 'restock_crate', quantity: 1 },
      ...dests.map((d, i) => ({ kind: 'task' as ShiftStepKind, description: `Job site ${i + 1}: fit + finish`, anchorId: d })),
      { kind: 'wrap', description: `Sign off at the yard`, anchorId: career.workplaceInteractableId },
    ],
    optional: { kind: 'task', description: 'Pass the safety check', optional: true },
  },
}

export function getShiftTemplate(id: ShiftTemplateId): ShiftTemplateDef {
  return TEMPLATES[id]
}

/** Instantiate a shift's steps (required sequence + one optional) with stable ids. */
export function instantiateShiftObjectives(career: CareerDefinition): ShiftObjectiveState[] {
  const tpl = TEMPLATES[career.shiftTemplateId]
  const required = tpl.buildSteps(career, tpl.destinationAnchors).map((s, i): ShiftObjectiveState => ({
    id: `req_${i}`,
    kind: s.kind,
    description: s.description,
    anchorId: s.anchorId,
    interactableId: s.anchorId,
    itemId: s.itemId,
    quantity: s.quantity,
    optional: false,
    done: false,
  }))
  const optional: ShiftObjectiveState = { id: 'opt_0', kind: tpl.optional.kind, description: tpl.optional.description, optional: true, done: false }
  return [...required, optional]
}

/** The next incomplete REQUIRED step (drives the HUD tracker + world gate). */
export function currentStep(objectives: ShiftObjectiveState[]): ShiftObjectiveState | undefined {
  return objectives.find((o) => !o.optional && !o.done)
}

/** All required steps done → the shift is ready to finalize. */
export function allRequiredDone(objectives: ShiftObjectiveState[]): boolean {
  return objectives.every((o) => o.optional || o.done)
}

// ---- performance scoring (§6) + pay (§7), pure + deterministic -------------

/** Compute the 0–100 performance from the finished run. No hidden randomness. */
export function scorePerformance(career: CareerDefinition, objectives: ShiftObjectiveState[], onTime: boolean): PerformanceResult {
  const required = objectives.filter((o) => !o.optional)
  const optional = objectives.filter((o) => o.optional)
  const requiredDone = required.filter((o) => o.done).length
  const optionalDone = optional.filter((o) => o.done).length
  const mistakes = objectives.filter((o) => o.mistake).length

  const w = career.performanceWeights
  const attendance = onTime ? 1 : 0.4
  const reqRatio = required.length ? requiredDone / required.length : 1
  const optRatio = optional.length ? optionalDone / optional.length : 1
  const mistakePenalty = Math.max(0, 1 - mistakes * 0.34)
  // Time efficiency is folded into attendance for v1 (no reckless-speed incentive, §6).
  const timeEff = onTime ? 1 : 0.6

  const raw = w.attendance * attendance + w.requiredObjectives * reqRatio + w.optionalObjectives * optRatio + w.mistakes * mistakePenalty + w.timeEfficiency * timeEff
  const score = Math.max(0, Math.min(100, Math.round(raw * 100)))

  const breakdown: PerformanceBreakdown = {
    attendance: Math.round(attendance * 100),
    requiredObjectives: Math.round(reqRatio * 100),
    optionalObjectives: Math.round(optRatio * 100),
    mistakes: Math.round(mistakePenalty * 100),
    timeEfficiency: Math.round(timeEff * 100),
  }
  const notes: string[] = []
  notes.push(onTime ? 'On time' : 'Clocked in late')
  notes.push(`${requiredDone}/${required.length} duties done`)
  if (optionalDone > 0) notes.push('Bonus objective complete')
  if (mistakes > 0) notes.push(`${mistakes} mistake${mistakes > 1 ? 's' : ''}`)

  return { score, breakdown, notes, onTime, requiredDone, requiredTotal: required.length, optionalDone, optionalTotal: optional.length, mistakes }
}

/** Deterministic pay: base × rank modifier × performance modifier (0.5–1.25). */
export function computePay(career: CareerDefinition, rank: RankDefinition, perf: PerformanceResult): PayResult {
  const performanceModifier = Math.round((0.5 + (perf.score / 100) * 0.75) * 100) / 100
  const total = Math.max(0, Math.round(career.basePay * rank.payModifier * performanceModifier))
  return { base: career.basePay, rankModifier: rank.payModifier, performanceModifier, total }
}

/** Pay for a FAILED shift (arrest/incapacitation mid-shift): partial for work done, §7. */
export function computeFailedPay(career: CareerDefinition, rank: RankDefinition, objectives: ShiftObjectiveState[]): PayResult {
  const required = objectives.filter((o) => !o.optional)
  const ratio = required.length ? required.filter((o) => o.done).length / required.length : 0
  const total = Math.max(0, Math.round(career.basePay * rank.payModifier * 0.3 * ratio))
  return { base: career.basePay, rankModifier: rank.payModifier, performanceModifier: Math.round(0.3 * ratio * 100) / 100, total }
}

/** The skill XP a completed shift awards, weighted by performance + career affinities. */
export function shiftSkillAwards(career: CareerDefinition, perf: PerformanceResult, onTime: boolean): { skill: string; amount: number; reason: string }[] {
  const quality = 0.5 + (perf.score / 100) * 0.5 // 0.5–1.0
  const awards: { skill: string; amount: number; reason: string }[] = []
  for (const skill of career.primarySkills) awards.push({ skill, amount: Math.round(18 * quality), reason: 'shift_completed' })
  for (const skill of career.secondarySkills) awards.push({ skill, amount: Math.round(10 * quality), reason: 'shift_completed' })
  if (onTime) awards.push({ skill: 'work_ethic', amount: 6, reason: 'shift_on_time' })
  if (perf.optionalDone > 0) awards.push({ skill: career.primarySkills[0], amount: 5, reason: 'shift_optional_objective' })
  return awards
}

/** True once every required step of an active shift is complete. */
export function shiftReadyToFinalize(shift: ScheduledShift): boolean {
  return !!shift.objectives && allRequiredDone(shift.objectives)
}
