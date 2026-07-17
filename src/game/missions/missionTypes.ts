import type { Vec3 } from '../world/worldTypes'
import type { SectorId } from '../world/sectors/worldGrid'

/**
 * Mission & Open-World Activity Framework v1 — the type keystone.
 *
 * Missions are REUSABLE, data-driven, objective-driven open-world activities
 * (deliveries, jobs, robberies, vehicle jobs, …). They are deliberately kept
 * separate from the narrative quest FSM (Coffee for Ravi): quests own dialogue
 * and story; missions own repeatable multi-system activities.
 *
 * Definitions are IMMUTABLE data with stable ids and source refs; the engine is
 * a pure state machine over them; the live runtime is a module singleton (never
 * per-frame React state, never scene objects). Nothing here references a mesh,
 * body, or React node.
 */

export type MissionCategory = 'lawful' | 'criminal'

export type MissionStatus =
  | 'locked'
  | 'available'
  | 'accepted'
  | 'active'
  | 'completed'
  | 'failed'
  | 'cancelled'
  | 'cooldown'

/** Where a source reference points, for error messages + tooling. */
export interface MissionSourceRef {
  file: string
  symbol: string
}

// ---- Objectives -----------------------------------------------------------

/** How an objective wants to be marked in the world / on the map / in the HUD. */
export interface MissionMarkerPolicy {
  kind: MissionMarkerKind
  /** Show the on-map marker even while the target sector is unloaded. */
  showOnMap?: boolean
  /** Show the HUD direction+distance tracker for this objective. */
  showTracker?: boolean
}

export type MissionMarkerKind =
  | 'destination'
  | 'pickup'
  | 'delivery'
  | 'target_vehicle'
  | 'return'

interface BaseMissionObjective {
  id: string
  description: string
  marker?: MissionMarkerPolicy
  optional?: boolean
}

export interface ReachZoneObjective extends BaseMissionObjective {
  kind: 'reach_zone'
  anchorId: string
}

export interface InteractObjective extends BaseMissionObjective {
  kind: 'interact'
  interactableId: string
}

export interface CollectItemObjective extends BaseMissionObjective {
  kind: 'collect_item'
  itemId: string
  quantity: number
}

export interface EnterVehicleObjective extends BaseMissionObjective {
  kind: 'enter_vehicle'
  /** Any drivable vehicle, or a specific one resolved from a variable. */
  vehicleFromVariable?: string
}

export interface StealVehicleObjective extends BaseMissionObjective {
  kind: 'steal_vehicle'
  /** Selector that resolves a deterministic eligible target at accept time. */
  targetSelectorId: string
  /** Variable the chosen target vehicle id is written into. */
  writeTargetToVariable: string
}

export interface DriveVehicleToZoneObjective extends BaseMissionObjective {
  kind: 'drive_vehicle_to_zone'
  targetVehicleFromVariable: string
  anchorId: string
  /** Deliver requires the vehicle roughly stopped (planar speed ≤ this). */
  maxSpeed?: number
}

export interface LoseWantedObjective extends BaseMissionObjective {
  kind: 'lose_wanted'
  requiredLevel: 0
}

export interface ExitVehicleObjective extends BaseMissionObjective {
  kind: 'exit_vehicle'
  vehicleFromVariable?: string
}

export interface DeliverVehicleObjective extends BaseMissionObjective {
  kind: 'deliver_vehicle'
  targetVehicleFromVariable: string
  /** The handoff interactable that completes the delivery. */
  interactableId: string
}

export interface ReturnToGiverObjective extends BaseMissionObjective {
  kind: 'return_to_giver'
  interactableId: string
}

export type MissionObjectiveDefinition =
  | ReachZoneObjective
  | InteractObjective
  | CollectItemObjective
  | EnterVehicleObjective
  | StealVehicleObjective
  | DriveVehicleToZoneObjective
  | LoseWantedObjective
  | ExitVehicleObjective
  | DeliverVehicleObjective
  | ReturnToGiverObjective

export type MissionObjectiveKind = MissionObjectiveDefinition['kind']

// ---- Rewards & failure ----------------------------------------------------

export type MissionRewardDefinition =
  | { kind: 'money'; amount: number }
  | { kind: 'item'; itemId: string; quantity: number }

export type MissionFailureRule =
  | { kind: 'player_arrested' }
  | { kind: 'player_incapacitated' }
  | { kind: 'target_vehicle_disabled' }
  | { kind: 'target_vehicle_lost' }
  | { kind: 'mission_cancelled' }

export type MissionFailureReason = MissionFailureRule['kind']

// ---- Offer source & definition -------------------------------------------

export type MissionOfferSource =
  | { kind: 'interactable'; interactableId: string }
  | { kind: 'phone_job'; jobId: string }

export interface MissionDefinition {
  id: string
  version: number
  title: string
  description: string
  category: MissionCategory
  offerSource: MissionOfferSource
  repeatable: boolean
  cooldownGameHours?: number
  objectives: MissionObjectiveDefinition[]
  rewards: MissionRewardDefinition[]
  failureRules: MissionFailureRule[]
  /** Blocks saving once this mission is accepted (criminal / target-assigned). */
  blockSaveWhenActive?: boolean
  sourceRef: MissionSourceRef
}

// ---- Anchors (authored world locations) ----------------------------------

export type MissionAnchorKind = 'pickup' | 'delivery' | 'garage' | 'meeting' | 'return'

export interface MissionAnchor {
  id: string
  position: Vec3
  radius: number
  sectorId: SectorId
  kind: MissionAnchorKind
  /** Optional label for markers / phone map. */
  label?: string
  sourceRef: MissionSourceRef
}

// ---- Runtime state (module singleton owns these) --------------------------

export type MissionObjectivePhase = 'pending' | 'active' | 'complete'

export interface MissionObjectiveRuntime {
  id: string
  phase: MissionObjectivePhase
  /** Objective-local counter (e.g. items collected so far). */
  progress: number
}

export type MissionVariableValue = string | number | boolean

export interface ActiveMissionRuntime {
  missionId: string
  missionVersion: number
  attemptId: string
  status: 'accepted' | 'active'
  objectiveIndex: number
  objectiveStates: Record<string, MissionObjectiveRuntime>
  variables: Record<string, MissionVariableValue>
  ownedEntityIds: Set<string>
  activeMarkerIds: Set<string>
  startedAtGameTime: number
  lastEventSeq: number
}

/** Terminal result of an attempt (for the HUD banner). */
export interface MissionResult {
  missionId: string
  attemptId: string
  outcome: 'completed' | 'failed' | 'cancelled'
  reason?: MissionFailureReason
  seq: number
}

// ---- History & cooldown (persisted) --------------------------------------

export interface MissionHistoryRecord {
  missionId: string
  completions: number
  lastCompletedGameHours: number
  totalEarned: number
  bestObjectiveSeconds?: number
}

export interface MissionCooldownRecord {
  missionId: string
  /** In-game hours (day*24+hour) at which the mission becomes available. */
  readyAtGameHours: number
}

/** A one-per-attempt receipt so a reward can never be granted twice. */
export interface MissionCompletionReceipt {
  attemptId: string
  missionId: string
  grantedAtGameHours: number
}

// ---- Mission events (the narrow adapter) ----------------------------------

export type MissionGameEvent =
  | { type: 'interactable_used'; interactableId: string }
  | { type: 'item_acquired'; itemId: string; quantity: number }
  | { type: 'vehicle_entered'; vehicleId: string }
  | { type: 'vehicle_exited'; vehicleId: string }
  | { type: 'vehicle_stolen'; vehicleId: string; theftKind: string }
  | { type: 'vehicle_disabled'; vehicleId: string }
  | { type: 'wanted_changed'; previous: number; current: number }
  | { type: 'player_arrested' }
  | { type: 'player_incapacitated' }
  | { type: 'location_changed'; location: string }
  | { type: 'reached_zone'; anchorId: string }

export type MissionEventType = MissionGameEvent['type']
