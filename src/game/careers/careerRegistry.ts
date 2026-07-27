/**
 * The canonical career registry (issue #15 §1). ONE typed source of truth for
 * careers, employers, ranks, requirements, pay, schedules, shift templates,
 * workplace anchors, skill affinities, unlocks and crime restrictions. IMMUTABLE
 * data with stable ids + source refs, validated by {@link validateCareerRegistry}.
 *
 * Reuses existing world anchors + named social NPCs as employers (Maya, Coach
 * Bruno, Leo) — no duplicate NPC identities. The trade yard is the one minimal
 * authored workplace the current city lacks (wired in Slice 3).
 */
import {
  CAREER_IDS,
  RANK_ORDER,
  type CareerDefinition,
  type CareerId,
  type PerformanceWeights,
  type RankDefinition,
} from './careerTypes'

const DELIVERY_WEIGHTS: PerformanceWeights = { attendance: 0.25, requiredObjectives: 0.4, optionalObjectives: 0.1, mistakes: 0.1, timeEfficiency: 0.15 }
const SERVICE_WEIGHTS: PerformanceWeights = { attendance: 0.3, requiredObjectives: 0.4, optionalObjectives: 0.15, mistakes: 0.15, timeEfficiency: 0 }
const TRAINER_WEIGHTS: PerformanceWeights = { attendance: 0.3, requiredObjectives: 0.35, optionalObjectives: 0.2, mistakes: 0.15, timeEfficiency: 0 }
const TRADE_WEIGHTS: PerformanceWeights = { attendance: 0.25, requiredObjectives: 0.4, optionalObjectives: 0.2, mistakes: 0.15, timeEfficiency: 0 }

const DELIVERY_DRIVER: CareerDefinition = {
  id: 'delivery_driver',
  displayName: 'Delivery Driver',
  description: 'Run parcel routes across the city for City Courier Dispatch. Reliable, forgiving of a rough patch, and the fastest way to build Driving.',
  employerId: 'courier_dispatch',
  employerDisplayName: 'City Courier Dispatch',
  workplaceInteractableId: 'courier_depot',
  entry: { minReputation: 0 },
  basePay: 40,
  shiftTemplateId: 'delivery_route',
  shiftDurationHours: 4,
  primarySkills: ['driving'],
  secondarySkills: ['work_ethic'],
  performanceWeights: DELIVERY_WEIGHTS,
  maxWantedToApply: 2,
  maxWantedToStart: 1,
  lenientCrime: true, // the comparatively-accessible career (§11)
  sourceRef: { file: 'careerRegistry.ts', symbol: 'DELIVERY_DRIVER' },
  ranks: [
    { id: 'trainee', displayName: 'Trainee Driver', payModifier: 1.0, unlocks: [] },
    {
      id: 'regular',
      displayName: 'Driver',
      payModifier: 1.3,
      promotion: { completedShifts: 3, skills: { driving: 2 }, minRecentPerformance: 55, maxMissedShifts: 2 },
      unlocks: [{ id: 'delivery_thermal_bag', kind: 'equipment', label: 'Insulated delivery bag (fewer cargo mistakes)' }],
    },
    {
      id: 'experienced',
      displayName: 'Senior Driver',
      payModifier: 1.6,
      promotion: { completedShifts: 8, skills: { driving: 4, work_ethic: 3 }, minRecentPerformance: 65, maxMissedShifts: 3 },
      unlocks: [{ id: 'delivery_express_route', kind: 'shift_variant', label: 'Express routes (higher pay, tighter time)' }],
    },
    {
      id: 'senior',
      displayName: 'Lead Courier',
      payModifier: 2.0,
      promotion: { completedShifts: 15, skills: { driving: 6, work_ethic: 4 }, minRecentPerformance: 75, maxMissedShifts: 5, minEmployerStanding: 60 },
      unlocks: [{ id: 'delivery_fleet_discount', kind: 'discount', label: 'Fleet fuel discount' }],
    },
  ],
}

const CAFE_RETAIL: CareerDefinition = {
  id: 'cafe_retail',
  displayName: 'Café / Retail Worker',
  description: "Serve customers at Maya's counter. Customer-facing, so keep your record clean — but a word from Maya can get you in the door.",
  employerId: 'maya_cafe',
  employerDisplayName: "Maya's Counter",
  employerActorId: 'npc_maya_01',
  workplaceInteractableId: 'food_truck_01',
  // Needs some Social; a recommendation from Maya relaxes it (§3/§10).
  entry: { skills: { social: 2 }, recommendationRelaxesFrom: 'maya_cafe' },
  basePay: 35,
  shiftTemplateId: 'cafe_service',
  shiftDurationHours: 4,
  primarySkills: ['social'],
  secondarySkills: ['work_ethic'],
  performanceWeights: SERVICE_WEIGHTS,
  maxWantedToApply: 1,
  maxWantedToStart: 0, // stricter: customer-facing, no heat on the clock (§11)
  lenientCrime: false,
  sourceRef: { file: 'careerRegistry.ts', symbol: 'CAFE_RETAIL' },
  ranks: [
    { id: 'trainee', displayName: 'Trainee Barista', payModifier: 1.0, unlocks: [] },
    {
      id: 'regular',
      displayName: 'Barista',
      payModifier: 1.3,
      promotion: { completedShifts: 3, skills: { social: 3 }, minRecentPerformance: 55, maxMissedShifts: 2 },
      unlocks: [{ id: 'cafe_staff_discount', kind: 'discount', label: 'Staff discount at the counter' }],
    },
    {
      id: 'experienced',
      displayName: 'Shift Lead',
      payModifier: 1.6,
      promotion: { completedShifts: 8, skills: { social: 5, work_ethic: 3 }, minRecentPerformance: 65, maxMissedShifts: 3, minEmployerStanding: 55 },
      unlocks: [{ id: 'cafe_open_close', kind: 'shift_variant', label: 'Open/close shifts (better pay)' }],
    },
    {
      id: 'senior',
      displayName: 'Manager',
      payModifier: 2.0,
      promotion: { completedShifts: 15, skills: { social: 7, work_ethic: 4 }, minRecentPerformance: 75, maxMissedShifts: 4, minEmployerStanding: 65 },
      unlocks: [{ id: 'cafe_free_meal', kind: 'access', label: 'Free meal on every shift' }],
    },
  ],
}

const GYM_TRAINER: CareerDefinition = {
  id: 'gym_trainer',
  displayName: 'Gym Trainer',
  description: 'Coach clients at Block Gym under Coach Bruno. Demands real Fitness up front — earn his recommendation to skip the gatekeeping.',
  employerId: 'bruno_gym',
  employerDisplayName: 'Block Gym',
  employerActorId: 'npc_bruno_01',
  workplaceInteractableId: 'gym',
  // The gated career: needs Fitness 3; a recommendation from Bruno relaxes it.
  entry: { skills: { fitness: 3 }, recommendationRelaxesFrom: 'bruno_gym' },
  basePay: 45,
  shiftTemplateId: 'gym_trainer',
  shiftDurationHours: 3,
  primarySkills: ['fitness', 'social'],
  secondarySkills: ['work_ethic'],
  performanceWeights: TRAINER_WEIGHTS,
  maxWantedToApply: 1,
  maxWantedToStart: 1,
  lenientCrime: false,
  sourceRef: { file: 'careerRegistry.ts', symbol: 'GYM_TRAINER' },
  ranks: [
    { id: 'trainee', displayName: 'Assistant Trainer', payModifier: 1.0, unlocks: [] },
    {
      id: 'regular',
      displayName: 'Trainer',
      payModifier: 1.3,
      promotion: { completedShifts: 3, skills: { fitness: 4, social: 2 }, minRecentPerformance: 55, maxMissedShifts: 2 },
      unlocks: [{ id: 'gym_free_access', kind: 'access', label: 'Free gym access (train off the clock)' }],
    },
    {
      id: 'experienced',
      displayName: 'Senior Trainer',
      payModifier: 1.6,
      promotion: { completedShifts: 8, skills: { fitness: 6, social: 4 }, minRecentPerformance: 65, maxMissedShifts: 3 },
      unlocks: [{ id: 'gym_class_slot', kind: 'shift_variant', label: 'Lead group classes (higher pay)' }],
    },
    {
      id: 'senior',
      displayName: 'Head Coach',
      payModifier: 2.0,
      promotion: { completedShifts: 15, skills: { fitness: 8, social: 6, work_ethic: 4 }, minRecentPerformance: 78, maxMissedShifts: 4, minEmployerStanding: 65 },
      unlocks: [{ id: 'gym_protein_perk', kind: 'discount', label: 'Supplement discount' }],
    },
  ],
}

const TRADE_WORKER: CareerDefinition = {
  id: 'trade_worker',
  displayName: 'Trade Worker',
  description: 'Mechanic and construction work at the Ironworks yard with foreman Leo. Physical, hands-on, and the backbone of Work Ethic.',
  employerId: 'trade_crew',
  employerDisplayName: 'Ironworks Yard',
  employerActorId: 'npc_leo_01',
  // Operates out of the existing Supply Depot (an industrial anchor already in the
  // city) — no new authored workplace geometry needed (§1 "reuse where possible").
  workplaceInteractableId: 'shelf_depot',
  entry: { skills: { work_ethic: 1 }, minReputation: 0 },
  basePay: 50,
  shiftTemplateId: 'trade_work',
  shiftDurationHours: 4,
  primarySkills: ['work_ethic'],
  secondarySkills: ['street_smarts'],
  performanceWeights: TRADE_WEIGHTS,
  maxWantedToApply: 2,
  maxWantedToStart: 1,
  lenientCrime: false,
  sourceRef: { file: 'careerRegistry.ts', symbol: 'TRADE_WORKER' },
  ranks: [
    { id: 'trainee', displayName: 'Apprentice', payModifier: 1.0, unlocks: [] },
    {
      id: 'regular',
      displayName: 'Tradesperson',
      payModifier: 1.3,
      promotion: { completedShifts: 3, skills: { work_ethic: 3 }, minRecentPerformance: 55, maxMissedShifts: 2 },
      unlocks: [{ id: 'trade_toolbelt', kind: 'equipment', label: 'Personal toolbelt (fewer mistakes)' }],
    },
    {
      id: 'experienced',
      displayName: 'Journeyman',
      payModifier: 1.6,
      promotion: { completedShifts: 8, skills: { work_ethic: 5, street_smarts: 3 }, minRecentPerformance: 65, maxMissedShifts: 3 },
      unlocks: [{ id: 'trade_overtime', kind: 'shift_variant', label: 'Overtime jobs (higher pay)' }],
    },
    {
      id: 'senior',
      displayName: 'Foreman',
      payModifier: 2.0,
      promotion: { completedShifts: 15, skills: { work_ethic: 7, street_smarts: 4 }, minRecentPerformance: 75, maxMissedShifts: 5, minEmployerStanding: 60 },
      unlocks: [{ id: 'trade_supply_access', kind: 'access', label: 'Yard supply access' }],
    },
  ],
}

const CAREERS: Record<CareerId, CareerDefinition> = {
  delivery_driver: DELIVERY_DRIVER,
  cafe_retail: CAFE_RETAIL,
  gym_trainer: GYM_TRAINER,
  trade_worker: TRADE_WORKER,
}

/** All career definitions in stable id order. */
export function allCareers(): CareerDefinition[] {
  return CAREER_IDS.map((id) => CAREERS[id])
}

export function getCareer(id: CareerId): CareerDefinition | undefined {
  return CAREERS[id]
}

export function isCareerId(id: string): id is CareerId {
  return id in CAREERS
}

export function getRank(careerId: CareerId, rankId: string): RankDefinition | undefined {
  return CAREERS[careerId]?.ranks.find((r) => r.id === rankId)
}

/** The rank a career starts at (the entry rank). */
export function entryRank(careerId: CareerId): RankDefinition {
  return CAREERS[careerId].ranks[0]
}

/** The id of a career's cargo-carrying EQUIPMENT unlock (thermal bag / toolbelt), if
 *  any — the insulated bag/toolbelt that carries shift cargo separately from the
 *  backpack, so a full bag no longer blocks the collect step (§8 unlock effect). */
export function cargoEquipmentUnlockId(careerId: CareerId): string | undefined {
  return CAREERS[careerId]?.ranks.flatMap((r) => r.unlocks).find((u) => u.kind === 'equipment')?.id
}

/** The next rank up from `rankId`, or undefined at the top (Senior). */
export function nextRank(careerId: CareerId, rankId: string): RankDefinition | undefined {
  const idx = RANK_ORDER.indexOf(rankId as (typeof RANK_ORDER)[number])
  if (idx < 0 || idx >= RANK_ORDER.length - 1) return undefined
  return getRank(careerId, RANK_ORDER[idx + 1])
}

/**
 * Validate the registry's internal consistency (stable-id mapping, §1). Returns a
 * list of problems (empty when clean); the unit gate asserts it is empty.
 */
export function validateCareerRegistry(): string[] {
  const problems: string[] = []
  const seenUnlockIds = new Set<string>()
  for (const id of CAREER_IDS) {
    const c = CAREERS[id]
    if (c.id !== id) problems.push(`career ${id}: id mismatch ${c.id}`)
    if (c.ranks.length !== RANK_ORDER.length) problems.push(`career ${id}: expected ${RANK_ORDER.length} ranks, got ${c.ranks.length}`)
    c.ranks.forEach((r, i) => {
      if (r.id !== RANK_ORDER[i]) problems.push(`career ${id}: rank ${i} should be ${RANK_ORDER[i]}, got ${r.id}`)
      if (i === 0 && r.promotion) problems.push(`career ${id}: entry rank must have no promotion requirement`)
      if (i > 0 && !r.promotion) problems.push(`career ${id}: rank ${r.id} needs a promotion requirement`)
      if (i > 0 && r.payModifier <= c.ranks[i - 1].payModifier) problems.push(`career ${id}: rank ${r.id} pay must exceed the rank below`)
      for (const u of r.unlocks) {
        if (seenUnlockIds.has(u.id)) problems.push(`duplicate unlock id ${u.id}`)
        seenUnlockIds.add(u.id)
      }
    })
    // Every career must ship at least one immediate visible unlock (by Senior).
    if (!c.ranks.some((r) => r.unlocks.length > 0)) problems.push(`career ${id}: no visible unlocks`)
    if (c.basePay <= 0) problems.push(`career ${id}: basePay must be positive`)
    const wsum = Object.values(c.performanceWeights).reduce((a, b) => a + b, 0)
    if (Math.abs(wsum - 1) > 1e-6) problems.push(`career ${id}: performance weights sum to ${wsum}, expected 1`)
  }
  return problems
}
