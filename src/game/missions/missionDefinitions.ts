import type { MissionDefinition } from './missionTypes'

/**
 * The two v1 proof missions. Everything mission-specific is DATA here — the
 * engine, runtime, markers, HUD, phone and validation are all generic. Adding a
 * future job (taxi, race, bounty, delivery, story beat) should mostly be a new
 * entry in this list plus any new anchors/interactables it references.
 *
 * Objective ids are stable and unique within a mission; anchor/interactable ids
 * reference authored sources (missionAnchors, the interactable registry).
 * Definitions are immutable and never mutated at runtime.
 */

const CITY_COURIER: MissionDefinition = {
  id: 'city_courier',
  version: 1,
  title: 'City Courier',
  description:
    'Run a sealed parcel across town for a courier outfit. Grab it at the depot, drop at the Waterfront and Main Street North, then check in. Honest pay, no heat.',
  category: 'lawful',
  offerSource: { kind: 'phone_job', jobId: 'city_courier' },
  repeatable: true,
  cooldownGameHours: 6,
  objectives: [
    {
      id: 'pickup',
      kind: 'interact',
      interactableId: 'courier_depot',
      description: 'Collect the sealed parcel from the courier depot',
      marker: { kind: 'pickup', showOnMap: true, showTracker: true },
    },
    {
      id: 'drop_waterfront',
      kind: 'reach_zone',
      anchorId: 'courier_waterfront',
      description: 'Deliver to the Waterfront drop',
      marker: { kind: 'delivery', showOnMap: true, showTracker: true },
    },
    {
      id: 'drop_mainstreet',
      kind: 'reach_zone',
      anchorId: 'courier_mainstreet',
      description: 'Deliver to the Main Street North drop',
      marker: { kind: 'delivery', showOnMap: true, showTracker: true },
    },
    {
      id: 'return',
      kind: 'reach_zone',
      anchorId: 'courier_return',
      description: 'Check in at the Job Board to get paid',
      marker: { kind: 'return', showOnMap: true, showTracker: true },
    },
  ],
  rewards: [{ kind: 'money', amount: 100 }],
  failureRules: [
    { kind: 'player_arrested' },
    { kind: 'player_incapacitated' },
    { kind: 'mission_cancelled' },
  ],
  blockSaveWhenActive: false,
  sourceRef: { file: 'src/game/missions/missionDefinitions.ts', symbol: 'CITY_COURIER' },
}

const HOT_CARGO: MissionDefinition = {
  id: 'hot_cargo',
  version: 1,
  title: 'Hot Cargo',
  description:
    "A fixer in the Industrial Yard wants a specific car boosted and delivered clean. Steal the marked vehicle, shake the police, and bring it to the garage — no heat on delivery. High risk, good money.",
  category: 'criminal',
  offerSource: { kind: 'interactable', interactableId: 'hotcargo_fixer' },
  repeatable: true,
  cooldownGameHours: 20,
  objectives: [
    {
      id: 'boost',
      kind: 'steal_vehicle',
      targetSelectorId: 'hotcargo_target',
      writeTargetToVariable: 'targetVehicle',
      description: 'Steal the marked vehicle',
      marker: { kind: 'target_vehicle', showOnMap: true, showTracker: true },
    },
    {
      id: 'lose_heat',
      kind: 'lose_wanted',
      requiredLevel: 0,
      description: 'Lose the police',
      marker: { kind: 'destination', showTracker: false },
    },
    {
      id: 'deliver_drive',
      kind: 'drive_vehicle_to_zone',
      targetVehicleFromVariable: 'targetVehicle',
      anchorId: 'hotcargo_garage',
      maxSpeed: 3,
      description: "Deliver the vehicle to the fixer's garage",
      marker: { kind: 'delivery', showOnMap: true, showTracker: true },
    },
    {
      id: 'dismount',
      kind: 'exit_vehicle',
      vehicleFromVariable: 'targetVehicle',
      description: 'Get out of the vehicle',
    },
    {
      id: 'handoff',
      kind: 'deliver_vehicle',
      targetVehicleFromVariable: 'targetVehicle',
      interactableId: 'hotcargo_fixer',
      description: 'Hand the vehicle over to the fixer',
      marker: { kind: 'delivery', showOnMap: true, showTracker: true },
    },
  ],
  rewards: [{ kind: 'money', amount: 280 }],
  failureRules: [
    { kind: 'player_arrested' },
    { kind: 'player_incapacitated' },
    { kind: 'target_vehicle_disabled' },
    { kind: 'target_vehicle_lost' },
    { kind: 'mission_cancelled' },
  ],
  blockSaveWhenActive: true,
  sourceRef: { file: 'src/game/missions/missionDefinitions.ts', symbol: 'HOT_CARGO' },
}

const CORNER_TAKE: MissionDefinition = {
  id: 'corner_take',
  version: 1,
  title: 'Corner Take',
  description:
    "The fixer wants a specific corner store hit. Rob the Main St Convenience for at least $120, shake any heat, and secure the take at the garage. He pays a bonus on delivery.",
  category: 'criminal',
  // Discovered at the fixer, accepted from the phone Jobs+ board — the fixer's
  // direct interaction is reserved for Hot Cargo's offer/handoff + securing.
  offerSource: { kind: 'phone_job', jobId: 'corner_take' },
  repeatable: true,
  cooldownGameHours: 24,
  objectives: [
    {
      id: 'rob',
      kind: 'rob_store',
      activityId: 'robbery_mainst_store',
      minAmount: 120,
      anchorId: 'cornertake_store',
      description: 'Rob the Main St Convenience (take at least $120)',
      marker: { kind: 'target_vehicle', showOnMap: true, showTracker: true },
    },
    {
      id: 'secure',
      kind: 'secure_proceeds',
      anchorId: 'cornertake_secure',
      description: 'Secure the take at the fixer’s garage',
      marker: { kind: 'delivery', showOnMap: true, showTracker: true },
    },
  ],
  rewards: [{ kind: 'money', amount: 150 }],
  failureRules: [
    { kind: 'player_arrested' },
    { kind: 'player_incapacitated' },
    { kind: 'mission_cancelled' },
  ],
  // Robbery already blocks its own save (active/unsecured); a bonus-only wrapper
  // needn't add extra save friction beyond that.
  blockSaveWhenActive: false,
  sourceRef: { file: 'src/game/missions/missionDefinitions.ts', symbol: 'CORNER_TAKE' },
}

/** Deterministic definition order (never sorted at runtime). */
export const MISSION_DEFINITIONS: readonly MissionDefinition[] = [CITY_COURIER, HOT_CARGO, CORNER_TAKE]

const BY_ID: Record<string, MissionDefinition> = Object.fromEntries(
  MISSION_DEFINITIONS.map((m) => [m.id, m]),
)

export function getMissionDefinition(id: string): MissionDefinition | undefined {
  return BY_ID[id]
}
