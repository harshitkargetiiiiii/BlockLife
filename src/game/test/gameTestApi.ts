import { useGameStore } from '../store/useGameStore'
import { registry } from '../world/runtimeRegistry'
import { socialSnapshot, getRelationship as getSocialRel, getDerivedRelationship as getSocialDerived, getMemories as getSocialMems, getContacts as getSocialContactsRt, ingestSocialEvent as ingestSocialEventRt, getInvitations as getSocialInvitationsRt, getMessages as getSocialMessagesRt, getTotalUnread as getSocialUnreadRt, reconcileOutreach as reconcileOutreachRt, getActiveActivity as getActiveActivityRt, getConfirmedPlans as getConfirmedPlansRt, reconcileMissedInvitations as reconcileMissedInvitationsRt } from '../social/socialRuntime'
import type { SocialEvent } from '../social/socialEvents'
import type { SocialActionId } from '../social/socialInteraction'
import { careerSnapshot as careerSnapshotRt, ingestCareerEvent as ingestCareerEventRt, grantRecommendation as grantCareerRecommendationRt, reconcileMissedShifts as reconcileCareerMissedRt, getScheduledShifts as getCareerShiftsRt, getNextShift as getCareerNextShiftRt, getSkillLevel as getCareerSkillLevelRt, getActiveShift as getActiveCareerShiftRt, getRecentResults as getCareerRecentResultsRt, hasUnlock as hasCareerUnlockRt, getPromotionProgress as getCareerPromotionRt, type CareerSnapshot } from '../careers/careerRuntime'
import { getCareerCommitmentSlots as getCareerCommitmentSlotsRt } from '../careers/careerSocial'
import { reconcileEarnedRecommendations as careerReconcileRecsRt } from '../careers/careerSocial'
import type { CareerEvent } from '../careers/careerEvents'
import type { CareerId, SkillId } from '../careers/careerTypes'
import type { InvitationActivityKind } from '../social/socialTypes'
import { noteCrimeWitnessed as noteCrimeWitnessedRt } from '../social/socialConsequences'
import { listEntities } from '../world/integrity/entityRegistry'
import {
  getActiveAnomalies,
  getIntegritySnapshot,
  runIntegrityScan,
  type IntegritySnapshot,
} from '../world/integrity/integrityRuntime'
import type { AnomalyRecord } from '../world/integrity/anomalyTypes'
import {
  certifyOcclusionParity,
  checkLiveOcclusionParity,
  type LiveOcclusionParity,
  type OcclusionParityReport,
} from '../world/integrity/occlusionParity'
import { getDistrict } from '../world/cityLayout'
import { ambientCitizenRuntime } from '../citizens/AmbientCitizens'
import { getMood } from '../simulation/worldMoodSystem'
import { CROSSWALKS } from '../traffic/trafficData'
import {
  collectAllVehicleFootprints,
  findVehicleOverlaps,
  getCrosswalkStatus,
  trafficRuntime,
} from '../traffic/trafficRuntime'
import {
  getPedestrianSignal,
  getPhaseAt,
  getPhaseStartOffset,
  getVehicleSignal,
  type TrafficSignalPhase,
} from '../traffic/signalRules'
import type { QuestState } from '../quests/questTypes'
import {
  getBlendedModifiers,
  getScheduledWeather,
  stepWeather,
  weatherRuntime,
} from '../weather/weatherSystem'
import { isWeatherKind, type WeatherKind } from '../weather/weatherTypes'
import type { PlayerAppearance, PlayerLocationMode } from '../interiors/interiorTypes'
import { APARTMENT_SPAWN } from '../interiors/apartmentLayout'
import { clearAllFades, visibilityRuntime } from '../visibility/visibilityRuntime'
import { characterRuntime } from '../characters/characterRuntime'
import { CHARACTER_ASSETS, DEFAULT_CHARACTER_ASSET_ID } from '../characters/characterManifest'
import { getRoadGraph, pointAtProgress } from '../traffic/routing/roadGraphBuilder'
import { routeRuntime } from '../traffic/routing/routeRuntime'
import { SECTOR_DEFINITIONS, getSectorDefinition } from '../world/sectors/sectorRegistry'
import {
  getSectorRuntimeState,
  holdSectorReadiness,
  isSectorReadyForGameplay,
  releaseSectorReadiness,
  streamingRuntime,
} from '../world/sectors/sectorStreaming'
import { safetyRingRuntime } from '../world/sectors/sectorSafetyRing'
import { getCityPlacementReports } from '../world/integrity/placementIntegrity'
import { certifyCity } from '../world/integrity/districtCertification'
import { generateTraversalTargets } from '../world/integrity/citySweep'
import { worldToSectorId } from '../world/sectors/worldGrid'
import { INTERACTABLE_BY_ID } from '../../data/interactables'
import { NPC_DEFS } from '../../data/npcs'
import { INTERIORS } from '../interiors/interiorRegistry'
import { activityRuntime, resetActivityRuntime } from '../criminalActivities/activityRuntime'
import { ROBBERY_DEFINITIONS, getRobberyDefinition, getRobberyForInterior } from '../criminalActivities/activityDefinitions'
import { validateRobberies } from '../criminalActivities/activityValidation'
import { rollLoot } from '../criminalActivities/robberyLogic'
import { tryBeginRobbery } from '../criminalActivities/activityBridge'
import { breachCountdown } from '../criminalActivities/containmentLogic'
import { getInterior } from '../interiors/interiorRegistry'
import {
  getCivilians,
  resetInteriorCivilians,
} from '../interiors/interiorCivilians'
// ---- Personal Economy, Inventory & Shopping v1 ----
import { ITEM_DEFINITIONS } from '../items/itemCatalog'
import { validateItemCatalog } from '../items/itemValidation'
import {
  BACKPACK_CAPACITY,
  STORAGE_CAPACITY,
  occupiedSlots,
} from '../items/inventoryService'
import { APPEARANCE_PRESETS, LOCKED_PALETTE_IDS } from '../interiors/interiorTypes'
import { getStoreDefinition } from '../commerce/storeDefinitions'
import { getStoreStock, reconcileStore, commerceRuntime } from '../commerce/commerceRuntime'
import { validateStores } from '../commerce/commerceValidation'
import type { ShopView } from '../commerce/shopView'
import { MISSION_DEFINITIONS, getMissionDefinition } from '../missions/missionDefinitions'
import { MISSION_ANCHORS, getMissionAnchor } from '../missions/missionAnchors'
import { missionRuntime } from '../missions/missionRuntime'
import { getMissionAvailability } from '../missions/missionSelectors'
import { validateMissions } from '../missions/missionValidation'
import {
  acceptMission as missionAccept,
  cancelActiveMission as missionCancel,
  discoverAndOfferMission,
  emitMissionEvent,
  retryLastMission as missionRetry,
} from '../missions/missionBridge'
import type { MissionGameEvent } from '../missions/missionTypes'
import {
  getSectorContentSummary,
  getSectorForRoadSegment,
  validateSectorOwnership,
} from '../world/sectors/sectorContent'
import { getVehicleRouteSectorSequence } from '../traffic/routing/segmentSectors'
import { COMPILED_SECTORS } from '../world/authoring/compiledSectors'
import {
  getIntersection,
  getIntersectionCrossingSignal,
  getIntersectionCrossingZone,
  getIntersectionStateSnapshot,
  INTERSECTIONS,
} from '../traffic/intersections/intersectionRegistry'
import { citizenPoseOverrides } from '../citizens/AmbientCitizens'
import { AMBIENT_CITIZENS } from '../citizens/ambientCitizenData'
import {
  CROSSING_ART,
  crossingArtDebug,
  getCrossingArt,
  getCrossingArtSummary,
  validateCrossingArt,
} from '../world/surfaces/crossingArt'
import {
  crimeRuntime,
  emitCrime as emitCrimeEvent,
  getCrimeEventsSnapshot,
} from '../crime/crimeRuntime'
import { fileReport } from '../crime/reportingSystem'
import {
  clearWanted,
  getWantedLevel as getWantedLevelValue,
  getWantedSnapshot,
  setWantedLevel as setWantedLevelRuntime,
  type WantedLevel,
} from '../crime/wantedRuntime'
import { witnessRuntime } from '../crime/witnessSystem'
import { getCrimeGameTime, getWitnessStateSnapshot } from '../crime/crimeSystem'
import type { CrimeType } from '../crime/crimeTypes'
import {
  getStealable,
  getVehicleCrimeState as getVehicleCrimeStateRuntime,
  getVehicleOccupant as getVehicleOccupantRuntime,
  setVehicleHealth as setVehicleHealthRuntime,
} from '../vehicles/vehicleCrimeState'
import { getEjectedDrivers } from '../vehicles/ejectedDriverRuntime'
import {
  activeCounts as policeActiveCounts,
  getPoliceUnit,
  getPoliceUnitsSnapshot,
  hasActiveOfficers,
  policeRuntime,
  setPoliceState as setPoliceStateRuntime,
  spawnPoliceOfficer,
} from '../police/policeRuntime'
import { stepDispatch } from '../police/dispatchDirector'
import { getPoliceRoute, policeRouteRuntime } from '../police/policeRoute'
import { planDismounts, cruiserExit } from '../police/policeDismount'
import { avoidSolids } from '../police/policeAvoidance'
import { POLICE_CAPS } from '../police/policeTypes'
import { nearestRoadSegment } from '../traffic/routing/roadProjection'
import {
  drawWeapon,
  getWeaponSnapshot,
  giveWeapon,
  holsterWeapon,
  setAmmo,
} from '../combat/weaponRuntime'
import { firePlayerWeapon } from '../combat/combatSystem'
import { isPanicking } from '../combat/panicRuntime'
import {
  getActorHealth as getActorHealthRuntime,
  isIncapacitated,
  setActorHealth as setActorHealthRuntime,
} from '../combat/healthState'
import { getDamageEvents } from '../combat/damageRuntime'
import type { HitscanTarget } from '../combat/hitscan'
import type { WeaponId } from '../combat/weaponTypes'
import {
  forceTripDestination,
  getTripSnapshot,
  resetSingleTrip,
  graphSummary,
  listDestinations,
  occupancyCount,
  replanTrip,
  tripRuntime,
} from '../citizens/destinations/tripRuntime'
import { getMovementSignal } from '../traffic/intersections/crossIntersection'
import { WALK_CROSSINGS } from '../traffic/walkCrossings'
import { validateCompiledSectorContent } from '../world/authoring/sectorAuthoring'
import {
  BUILDING_TEMPLATES,
  CITIZEN_ZONE_TEMPLATES,
  LOT_TEMPLATES,
  PROP_SCATTER_TEMPLATES,
  ROAD_TEMPLATES,
} from '../world/authoring/templates'


/** Wire-safe route state snapshot for tests (Sets/functions stripped). */
export interface SerializedRouteState {
  vehicleId: string
  mode: string
  destinationId: string | null
  segmentIds: string[]
  segmentIndex: number
  currentSegmentId: string | null
  segmentProgress: number
  totalCost: number
  graphVersion: number
  blockageReason: string
  recoveryStage: number
  replanCount: number
  tripsCompleted: number
  districtsVisited: string[]
  lastDestinationIds: string[]
  stoppedTime: number
  suspectTime: number
}

function serializeRouteState(vehicleId: string): SerializedRouteState | null {
  const s = routeRuntime.states.get(vehicleId)
  if (!s) return null
  return {
    vehicleId: s.vehicleId,
    mode: s.mode,
    destinationId: s.destinationId,
    segmentIds: s.route?.segmentIds ?? [],
    segmentIndex: s.segmentIndex,
    currentSegmentId: s.route?.segmentIds[s.segmentIndex] ?? null,
    segmentProgress: s.segmentProgress,
    totalCost: s.route?.totalCost ?? 0,
    graphVersion: s.route?.graphVersion ?? 0,
    blockageReason: s.blockageReason,
    recoveryStage: s.recoveryStage,
    replanCount: s.replanCount,
    tripsCompleted: s.tripsCompleted,
    districtsVisited: [...s.districtsVisited],
    lastDestinationIds: [...s.lastDestinationIds],
    stoppedTime: s.stoppedTime,
    suspectTime: s.suspectTime,
  }
}

/**
 * Dev/test-only automation API used by Playwright. Guarded by
 * import.meta.env.DEV so production builds never expose it — the call site
 * in App.tsx is also wrapped, letting bundlers drop this module entirely.
 */
export interface GameTestApi {
  ready: () => boolean
  /** True when no GLB/texture loads are in flight (visual tests wait on this). */
  assetsSettled: () => boolean
  getStats: () => {
    money: number
    hunger: number
    energy: number
    reputation: number
    strength: number
    day: number
    hour: number
    mood: string
    mode: string
    position: [number, number, number]
    activeInteractableId: string | null
    questStates: Record<string, QuestState>
    inventory: Record<string, number>
    uiPanel: string
    worldPaused: boolean
  }
  teleportPlayer: (position: [number, number, number]) => void
  /** Teleport to a named TEST_LOCATIONS spot; returns false for unknown names. */
  teleportTo: (name: string) => boolean
  /** Available named teleport spots. */
  getTestLocations: () => string[]
  /** Coarse district at the player's position. */
  getPlayerDistrict: () => string
  getNpcPosition: (npcId: string) => [number, number, number] | null
  /** True while a named resident is fleeing gunfire (Hard M5 panic recovery). */
  isNpcPanicking: (npcId: string) => boolean
  /** Live decorative-traffic positions, for avoidance E2E checks. */
  getAmbientCarPositions: () => Record<string, [number, number, number]>
  /** Live traffic agent snapshot: signal + car/pedestrian states + crosswalks. */
  getTrafficState: () => {
    signal: { phase: string; remaining: number; vehicle: string; pedestrian: string }
    cars: {
      id: string
      state: string
      reason: string
      speed: number
      targetSpeed: number
      blockedTime: number
      position: [number, number]
    }[]
    pedestrians: {
      id: string
      state: string
      waitingAtCrosswalkId: string | null
      crossingCrosswalkId: string | null
      position: [number, number]
    }[]
    crosswalks: { id: string; occupied: boolean; hasWaitingPedestrian: boolean }[]
  }
  /** Reposition an NPC (optionally retargeting a routine waypoint index). */
  setNpcPosition: (id: string, position: [number, number], waypointIndex?: number) => void
  /** Reposition an ambient car (optionally retargeting a lane waypoint index). */
  setAmbientCarPosition: (id: string, position: [number, number], targetIndex?: number) => void
  /** Teleport the player's car (works parked or driven). */
  setDrivenCarPosition: (position: [number, number], yaw?: number) => void
  /** Jump the shared signal controller to the start of a phase. */
  setSignalPhase: (phase: string) => void
  /** Advance the signal clock by N seconds. */
  advanceSignalTime: (seconds: number) => void
  getVehiclePositions: () => Record<string, [number, number]>
  /** Background citizens: id, district, live position and behavior state. */
  getAmbientCitizens: () => {
    id: string
    district: string
    state: string
    position: [number, number]
  }[]
  /** Ids of overlapping vehicle pairs — empty array means no phasing. */
  assertNoVehicleVehicleOverlaps: () => [string, string][]
  /** Active people (citizens + NPCs) whose bodies overlap — empty = no phasing. */
  assertNoPersonPersonOverlaps: (minDistance?: number) => [string, string, number][]
  assertNoMovingPeopleOverlaps: (minDistance?: number) => [string, string, number][]
  // ---- World Integrity & City Certification Platform v1 (DEV) ----
  /** Every mirrored semantic entity (id/kind/position/sector) — safe snapshot. */
  getWorldEntities: () => { id: string; kind: string; x: number; z: number; sectorId: string | null }[]
  /** Integrity scan/registry/anomaly counters. */
  getIntegritySnapshot: () => IntegritySnapshot
  /** Currently-active integrity anomalies (safe copies). */
  getIntegrityAnomalies: () => AnomalyRecord[]
  /** Force one integrity scan now (tests don't wait on the 4 Hz throttle). */
  runIntegrityScan: () => void
  /** Person↔vehicle overlaps as id pairs — empty = none. */
  assertNoPersonVehicleOverlaps: () => [string, string][]
  /** Person↔solid (building/prop) overlaps as id pairs — empty = none. */
  assertNoPersonSolidOverlaps: () => [string, string][]
  /** Occlusion-parity certification from authored data (per district). */
  getOcclusionParity: () => OcclusionParityReport
  /** Live occluder-registration cross-check: missing + phantom ids. */
  getLiveOcclusionParity: () => LiveOcclusionParity
  /** Streaming safety-ring status around the active subject (issue §6). */
  getSafetyRing: () => {
    covered: boolean
    currentSector: string
    enteringSector: string
    notReady: string[]
    selfHeals: number
    backstops: number
  } | null
  /** True when a sector's floor + colliders + visuals are gameplay-ready. */
  isSectorReady: (id: string) => boolean
  /** DEV: hold a sector mid-load (suppress its ready report) to exercise the
      safety-ring backstop/watchdog; release restores normal readiness. */
  holdSectorReadiness: (id: string) => void
  releaseSectorReadiness: (id: string) => void
  /** Per-district 3D-placement report (float/clip/anchor/duplicate/route) with
      exact entity ids + reasons — empty failures = a clean city (issue §7/§8). */
  getPlacementReport: () => {
    sectorId: string
    failures: { kind: string; entityId: string; otherId?: string; reason: string; correction?: number }[]
    counts: { props: number; citizens: number; anchors: number; solids: number }
  }[]
  /** Generated full-city traversal targets (issue §13): a safe sample point per
      district (centre + citizen anchors) for the automated sweeper. */
  getTraversalTargets: () => { sectorId: string; displayName: string; x: number; z: number; kind: string }[]
  /** Machine-readable district certification (issue §11): per-district capability
      matrix + pass/fail verdict, aggregated from authored data. */
  getCityCertification: () => {
    verdict: 'pass' | 'fail'
    passed: number
    totalDistricts: number
    districts: {
      sectorId: string
      displayName: string
      verdict: 'pass' | 'fail'
      errors: number
      warnings: number
      checks: { name: string; status: string; severity: string }[]
    }[]
  }
  /** Social Life, Relationships & NPC Memory v1 (§13 observability). */
  getSocialSnapshot: () => {
    actors: { id: string; name: string; tier: string; hostile: boolean; afraid: boolean; rel: { familiarity: number; affinity: number; trust: number; fear: number; lastMeaningfulInteractionDay: number }; memoryCount: number; contact: boolean }[]
    contactCount: number
    appliedEventCount: number
    totalMemories: number
  }
  getSocialRelationship: (id: string) => { familiarity: number; affinity: number; trust: number; fear: number; lastMeaningfulInteractionDay: number; tier: string; hostile: boolean; afraid: boolean }
  getSocialMemories: (id: string) => { id: string; kind: string; salience: number; valence: number; pinned: boolean; summaryToken: string; gameDay: number }[]
  getSocialContacts: () => string[]
  /** DEV/E2E: inject a typed social event through the exact-once pipeline. */
  ingestSocialEvent: (event: { id: string; kind: string; actorId: string; gameDay: number; gameHour?: number; district?: string; counterpartyId?: string }) => { applied: boolean; contactUnlocked: boolean }
  /** DEV/E2E: open a conversation with a named NPC (fires the first-meeting). */
  openDialogueWith: (npcId: string) => void
  /** DEV/E2E: the contextual social actions currently offered for an NPC. */
  getSocialMenu: (npcId: string) => { actions: { id: string; label: string; enabled: boolean; hint?: string }[]; giftableItemIds: string[] } | null
  /** DEV/E2E: perform one contextual social action (talk / gift / apologize / …). */
  performSocialAction: (npcId: string, actionId: string, itemId?: string) => void
  /** DEV/E2E: lazily generate due NPC follow-ups (message / invitation). */
  reconcileSocialOutreach: (gameDay: number, gameHour: number) => number
  /** DEV/E2E: send / answer an invitation; read the phone's social state. */
  sendSocialInvite: (npcId: string, activityKind?: string) => void
  respondToInvitation: (invitationId: string, status: string) => void
  getSocialInvitations: () => { id: string; actorId: string; source: string; activityKind: string; status: string; proposedDay: number }[]
  getSocialMessages: (npcId: string) => { id: string; dir: string; token: string; read: boolean; gameDay: number }[]
  getSocialUnread: () => number
  /** DEV/E2E: reusable social activities (Slice 4). */
  getActiveSocialActivity: () => { id: string; actorId: string; template: string; step: string; venueId: string; venueLabel: string; requiredItemId?: string } | null
  startSocialActivity: (invitationId: string) => void
  startFavorFor: (npcId: string) => void
  advanceSocialActivity: () => void
  cancelSocialActivity: () => void
  /** DEV/E2E: drive the REAL crime-witness consequence at a named NPC's live
   *  world position (exercises `noteCrimeWitnessed` + registry proximity + the
   *  social pipeline). The crime AUTHORITY itself is covered by crime.spec.ts. */
  devWitnessCrimeAt: (npcId: string) => boolean
  /** DEV/E2E: confirmed (accepted/active) plans; time-out ignored accepted plans. */
  getSocialConfirmedPlans: () => { id: string; actorId: string; activityKind: string; status: string; proposedDay: number; proposedHour: number }[]
  reconcileMissedInvitations: (gameDay: number, gameHour: number) => number
  /** DEV/E2E: simulate arriving at a venue (the proximity scanner does this live). */
  setActiveInteractable: (id: string | null) => void
  /** DEV/E2E: careers (issue #15) — snapshot + arrange prerequisites (never the only path). */
  getCareerSnapshot: () => CareerSnapshot
  getCareerSkillLevel: (skill: string) => number
  applyToCareer: (careerId: string) => void
  grantCareerRecommendation: (employerId: string) => void
  ingestCareerEvent: (event: CareerEvent) => { applied: boolean; grantedXp: number }
  reconcileMissedShifts: (gameDay: number, gameHour: number) => number
  getCareerScheduledShifts: () => { id: string; careerId: string; status: string; scheduledDay: number; startHour: number }[]
  getCareerNextShift: () => { id: string; careerId: string; scheduledDay: number; startHour: number; workplaceInteractableId: string } | null
  startCareerShift: (shiftId: string) => void
  advanceCareerShift: () => void
  cancelCareerShift: () => void
  getActiveCareerShift: () => { id: string; careerId: string; status: string; workplaceInteractableId: string; objectives: { id: string; kind: string; description: string; done: boolean; optional: boolean; anchorId: string | null; requiresCargoItemId: string | null }[] } | null
  getCareerPromotion: (careerId: string) => { currentRank: string; nextRank: string | null; met: boolean; rows: { label: string; have: number; need: number; ok: boolean }[] } | null
  /** DEV/E2E: recent rich shift results (pay decomposition + score breakdown). */
  getCareerRecentResults: () => { careerId: string; reason: string; score: number; base: number; rankModifier: number; performanceModifier: number; pay: number; onTime: boolean }[]
  /** DEV/E2E: has the player earned a specific rank unlock? */
  hasCareerUnlock: (unlockId: string) => boolean
  /** DEV/E2E: accepted social plans the shift scheduler checks conflicts against. */
  getCareerCommitmentSlots: () => { day: number; hour: number; label: string }[]
  /** DEV/E2E: warm employers put in a good word (earns recommendations). Returns earned career ids. */
  reconcileCareerRecommendations: (gameDay: number, gameHour: number) => string[]
  /** DEV/E2E: dispatch a world interaction action (the SAME store action the world
   *  buttons call) — e.g. 'train' at the gym. Exercises the real production path. */
  performActivityAction: (actionId: string) => void
  /** Routing: graph counts + content-hash version. */
  getRoadGraphSummary: () => {
    version: number
    nodeCount: number
    segmentCount: number
    edgeCount: number
    destinationCount: number
    spawnPointCount: number
  }
  /** Routing: full serialized graph (debug overlays, deep assertions). */
  getRoadGraph: () => {
    version: number
    segments: {
      id: string
      kind: string
      districtId: string
      roadId: string
      points: [number, number][]
      length: number
    }[]
    edges: { fromSegmentId: string; toSegmentId: string; movement: string; cost: number }[]
  }
  /** Routing: one vehicle's live route state (null = not a routed car). */
  getVehicleRouteState: (vehicleId: string) => SerializedRouteState | null
  getAllVehicleRouteStates: () => SerializedRouteState[]
  /** Routing: force the next destination and replan immediately. */
  forceVehicleDestination: (vehicleId: string, destinationId: string) => void
  replanVehicleRoute: (vehicleId: string) => void
  getSegmentCongestion: () => {
    segmentId: string
    vehicleCount: number
    occupancyRatio: number
    stoppedVehicleCount: number
    speedRatio: number
    penalty: number
  }[]
  /** Routing: mark a segment blocked for planners (and recovery pressure). */
  setSegmentBlocked: (segmentId: string, blocked: boolean) => void
  clearTrafficRecoveryState: (vehicleId: string) => void
  /** Routing: teleport an ambient car onto a segment at progress 0..1. */
  teleportAmbientVehicleToSegment: (
    vehicleId: string,
    segmentId: string,
    progress: number,
  ) => boolean
  getCompletedTrips: (vehicleId: string) => number
  getIntersectionIds: () => string[]
  getIntersectionState: (id: string) => {
    id: string
    phaseId: string
    phaseIndex: number
    remaining: number
    cycleLength: number
    permittedVehicleGroups: string[]
    permittedPedestrianGroups: string[]
    movements: number
    approaches: number
  } | null
  getSignalPlan: (id: string) => { cycleLength: number; phases: unknown[] } | null
  getMovementPermission: (id: string, approach: string) => 'green' | 'red' | null
  setIntersectionElapsed: (seconds: number) => void
  // ---- Live pedestrian crossings v1 ---------------------------------------
  getCrossingPedestrians: (intersectionId: string) => {
    crossingId: string
    walkSignal: 'walk' | 'clearance' | 'dont_walk'
    occupied: boolean
    queued: string[]
    crossing: string[]
  }[]
  forceCitizenToCrossing: (citizenId: string, crossingId: string, t?: number) => boolean
  getPedestrianCrossingState: (citizenId: string) => {
    state: string
    crosswalkId: string | null
    waitTime: number
    position: [number, number]
  } | null
  setPedestrianCrossingDebug: (enabled: boolean) => void
  // ---- Crossing-aware citizen destinations v1 -----------------------------
  getCitizenTripState: (citizenId: string) => {
    citizenId: string
    phase: string
    destinationId: string | null
    routeEdgeIds: string[]
    crossingIds: string[]
    waypointIndex: number
    waypointCount: number
    tripsCompleted: number
    recoveryStage: number
    suspended: boolean
  } | null
  getCitizenDestinations: () => {
    id: string
    kind: string
    sectorId: string
    position: [number, number]
    capacity: number
    occupancy: number
    arrivalBehavior: string
  }[]
  forceCitizenDestination: (citizenId: string, destinationId: string) => boolean
  getPedestrianGraphSummary: () => {
    nodes: number
    edges: number
    crossings: number
    destinations: number
  }
  getDestinationOccupancy: (destinationId: string) => number
  replanCitizenTrip: (citizenId: string) => boolean
  setCitizenDestinationDebug: (enabled: boolean) => void
  /** Pose any citizen exactly (survives the pause-snap) for baselines. */
  forceCitizenPose: (citizenId: string, x: number, z: number, heading?: number) => boolean
  // ---- Crosswalk surface art v1 -------------------------------------------
  getCrosswalkVisualSpec: (crossingId: string) => {
    crossingId: string
    kind: string
    axis: string
    stripeCount: number
    padPositions: { id: string; kind: string; x: number; z: number }[]
    furniture: { id: string; kind: string; position: number[] }[]
    sectorIds: string[]
  } | null
  getCrosswalkVisualIds: () => string[]
  getCrosswalkFurniture: (crossingId: string) => { id: string; kind: string; position: number[] }[]
  validateCrosswalkVisuals: () => string[]
  setCrosswalkVisualDebug: (enabled: boolean) => void
  // ---- Crime & Law Enforcement v1 -----------------------------------------
  emitCrime: (type: string, position?: [number, number, number]) => { id: string } | null
  getCrimeEvents: () => {
    id: string
    type: string
    position: [number, number, number]
    sectorId: string
    severity: number
    status: string
    witnessedBy: string[]
    reportedBy?: string
  }[]
  getWantedState: () => {
    heat: number
    level: number
    status: string
    lastKnownPosition: [number, number, number] | null
    activeIncidentIds: string[]
  }
  setWantedLevel: (level: number) => void
  clearWanted: () => void
  forceWitnessReport: (citizenId: string, crimeId: string) => boolean
  getWitnessState: (citizenId: string) => {
    state: string
    eventId: string
    verdict: string
    reported: boolean
  } | null
  setCrimeDebug: (enabled: boolean) => void
  stealVehicle: (vehicleId: string) => boolean
  /** Leave the drivable car (back on foot) — e.g. to rob a store mid-getaway. */
  exitPlayerVehicle: () => void
  getVehicleCrimeState: (vehicleId: string) => {
    access: string
    stolen: boolean
    ownerId?: string
    health: number
    disabled: boolean
  }
  setVehicleHealth: (vehicleId: string, value: number) => void
  /** The seated driver of an occupied vehicle, or null once carjacked/empty. */
  getVehicleOccupant: (vehicleId: string) => string | null
  /** Carjack an occupied vehicle (drives the full driver-eject + report). */
  forceOccupiedVehicleTheft: (vehicleId: string) => boolean
  getEjectedDrivers: () => {
    id: string
    vehicleId: string
    position: [number, number]
    heading: number
  }[]
  // ---- Police dispatch & AI (M4) ------------------------------------------
  /** Force a police response at the suspect's location for a wanted level. */
  spawnPoliceResponse: (level: number) => number
  getPoliceUnits: () => {
    id: string
    kind: string
    state: string
    position: [number, number]
    health: number
    seesSuspect: boolean
  }[]
  getPoliceUnitState: (id: string) => string | null
  teleportPoliceUnit: (id: string, x: number, z: number) => boolean
  setPoliceState: (id: string, state: string) => void
  getArrestState: () => { arrestsMade: number; lastArrestAt: number | null }
  setPoliceDebug: (enabled: boolean) => void
  /** Emergency road-graph pursuit route for a cruiser, or null. */
  getPoliceRouteState: (unitId: string) => {
    mode: string
    segmentIds: string[]
    cursor: number
    targetSegmentId: string
    replanCount: number
  } | null
  getPoliceRouteMetrics: () => { totalReplans: number; activeRoutes: number }
  /** Distance from a world point to the nearest road segment (0 = on a road). */
  getNearestRoadDistance: (x: number, z: number) => number
  // ---- Dismounted officers (Hard M4) --------------------------------------
  /** Active cruisers (vehicle police units). */
  getPoliceCruisers: () => {
    id: string
    state: string
    position: [number, number]
    hasOfficers: boolean
  }[]
  /** Active dismounted officers, each linked to the cruiser it exited. */
  getPoliceOfficers: () => {
    id: string
    state: string
    position: [number, number]
    cruiserId: string | null
    health: number
    seesSuspect: boolean
  }[]
  getPoliceCounts: () => { vehicles: number; officers: number }
  /** Run the dismount decision+spawn pass once at a suspect point (on-foot). */
  forcePoliceDismount: (suspectX: number, suspectZ: number) => number
  // ---- Missions & Activities (Mission Framework v1) -----------------------
  getMissionDefinitions: () => { id: string; title: string; category: string; objectives: number }[]
  getMissionState: () => {
    activeMissionId: string | null
    attemptId: string | null
    objectiveIndex: number
    objectiveCount: number
    objectiveId: string | null
    objectiveKind: string | null
    objectiveDescription: string | null
    variables: Record<string, string | number | boolean>
    ownedEntities: string[]
    result: { outcome: string; reason: string | null } | null
  }
  getMissionAvailability: (missionId: string) => string
  getMissionHistory: () => Record<string, { completions: number; totalEarned: number; lastCompletedGameHours: number }>
  getMissionCooldownHours: (missionId: string) => number
  getMissionTargetVehicle: () => string | null
  setMissionTargetVehicle: (vehicleId: string) => boolean
  getMissionValidation: () => string[]
  /** Start a mission (discovers it first, e.g. the Hot Cargo fixer). */
  startMission: (missionId: string) => boolean
  cancelMission: () => boolean
  retryMission: () => boolean
  /** Drive one typed mission event into the engine (event-first testing). */
  forceMissionEvent: (event: MissionGameEvent) => void
  /** Teleport the player to the current objective's marker position. */
  teleportToMissionObjective: () => boolean
  setMissionDebug: (enabled: boolean) => void
  // ---- Criminal activities / Store Robbery v1 -----------------------------
  getRobberyDefinitions: () => { id: string; kind: string; interiorId: string; cashRange: { min: number; max: number }; cooldownGameHours: number }[]
  getActivityState: () => {
    activeId: string | null
    phase: string
    cashierPhase: string
    decision: string | null
    unsecuredProceeds: number
    alarmArmed: boolean
    alarmFired: boolean
    threatProgress: number
    canLoot: boolean
    canSecure: boolean
    result: { outcome: string; amount: number } | null
    location: string
    interiorId: string | null
    containmentPhase: string
    breachSeconds: number | null
  }
  /** Police containment phase machine around a robbed store (Getaway Polish v1). */
  getContainmentState: () => {
    storeId: string | null
    phase: string
    phaseSeconds: number
    breached: boolean
    breachSeconds: number | null
  }
  /** Routed store civilians (cashier + customers) for a store interior, or null. */
  getInteriorCivilians: (interiorId: string) =>
    | {
        id: string
        role: string
        reaction: string
        pos: [number, number]
        crouch: number
        arrived: boolean
        reported: boolean
      }[]
    | null
  getStoreRobberyState: (storeId: string) => {
    cooldownReadyAtGameHours: number
    robberyCount: number
    registerEmptied: boolean
  } | null
  getActivityValidation: () => string[]
  getRobberyLoot: (activityId: string, attemptId: string) => number
  /** Enter/leave an interior (store or apartment) by id — teleport-coordinated. */
  enterInterior: (interiorId: string) => void
  exitInterior: () => void
  /** Force a robbery to begin (bypasses sustained-threat detection, for tests). */
  forceBeginRobbery: (activityId: string) => boolean
  lootStoreRegister: () => void
  secureRobberyProceeds: () => void
  /** Set the player's facing heading (radians) so tests can aim deterministically. */
  setPlayerHeading: (heading: number) => void
  resetActivities: () => void
  setActivityDebug: (enabled: boolean) => void
  // ---- Personal Economy, Inventory & Shopping v1 --------------------------
  getItemCatalog: () => { id: string; name: string; category: string; price: number; stackLimit: number; usable: boolean; questReserved: boolean }[]
  getItemValidation: () => string[]
  getBackpack: () => { stacks: Record<string, number>; occupied: number; capacity: number }
  getStorageContainer: () => { stacks: Record<string, number>; occupied: number; capacity: number }
  getWardrobeUnlocks: () => string[]
  giveTestItem: (id: string, qty: number) => void
  useTestItem: (id: string) => void
  discardTestItem: (id: string, qty?: number) => void
  depositTestItem: (id: string, qty?: number | 'all') => void
  withdrawTestItem: (id: string, qty?: number | 'all') => void
  openTestShop: (storeId: string) => void
  buyTestItem: (storeId: string, itemId: string) => void
  getShopView: () => ShopView | null
  getStoreCatalog: (storeId: string) => { itemId: string; maxStock: number; restockAmount: number }[] | null
  getStoreStockState: (storeId: string) => { stock: Record<string, number>; lastRestockGameHours: number }
  reconcileStoreStock: (storeId: string, gameHours: number) => Record<string, number>
  getCommerceReceipts: () => string[]
  getCommerceValidation: () => string[]
  collectTestShelfCrate: () => void
  deliverTestShelfCrate: (storeId: string) => void
  /** Open a center panel directly (storage/wardrobe/shop) — visual/E2E setup. */
  openTestPanel: (panel: string) => void
  /** Open the phone at a given app (e.g. 'bag') — visual/E2E setup. */
  openTestPhoneApp: (app: string) => void
  // ---- Firearm + health/damage (M5) ---------------------------------------
  givePlayerWeapon: (id?: string) => void
  drawPlayerWeapon: () => void
  holsterPlayerWeapon: () => void
  setPlayerAmmo: (magazine: number, reserve: number) => void
  getWeaponState: () => {
    equipped: string | null
    pose: string
    magazine: number
    reserve: number
    reloading: boolean
  }
  /** Fire the equipped weapon toward a world point; auto-gathers live actors. */
  firePlayerWeaponAt: (x: number, z: number) => {
    fired: boolean
    hit: boolean
    targetId?: string
    targetKind?: string
    incapacitated: boolean
  }
  setPlayerHealth: (value: number) => void
  getPlayerHealth: () => { health: number; incapacitated: boolean }
  /** Drive the arrest/incapacitation recovery flow directly. */
  respawnPlayer: (kind: 'arrest' | 'incapacitation') => void
  getRecoveryState: () => { active: boolean; kind: string | null }
  getActorHealth: (id: string) => { health: number; incapacitated: boolean }
  setActorHealth: (id: string, value: number) => void
  getDamageEvents: () => {
    id: string
    sourceId: string
    targetId: string
    targetKind: string
    amount: number
    kind: string
    incapacitated: boolean
  }[]
  /** Routing: reseed + deterministically rebuild the routed fleet. */
  setTrafficRoutingSeed: (seed: number) => void
  // ---- Large City Foundation v1: sector streaming ------------------------
  getSectorRegistry: () => {
    id: string
    name: string
    kind: string
    districtIds: string[]
    bounds: { minX: number; maxX: number; minZ: number; maxZ: number }
  }[]
  getSectorRuntimeStates: () => {
    id: string
    lifecycle: string
    requestedLifecycle: string
    simulationTier: string
    generation: number
    visualsReady: boolean
    collidersReady: boolean
    loadDurationMs: number | null
    error: string | null
  }[]
  getCurrentSectorId: () => string
  getSectorState: (id: string) => {
    id: string
    lifecycle: string
    simulationTier: string
    visualsReady: boolean
    collidersReady: boolean
  } | null
  getSectorContentSummary: (id: string) => Record<string, number>
  getSectorForRoadSegment: (segmentId: string) => {
    primarySectorId: string
    touchedSectorIds: string[]
    boundaryCrossing: boolean
  } | null
  getVehicleRouteSectorSequence: (vehicleId: string) => string[]
  getSimulationTier: (id: string) => string
  forceLoadSector: (id: string) => boolean
  forceUnloadSector: (id: string) => boolean
  clearForcedSectors: () => void
  setStreamingEnabled: (enabled: boolean) => void
  setStreamingRings: (activeRing: number, warmRing: number) => void
  getStreamingMetrics: () => Record<string, number>
  validateSectorOwnership: () => string[]
  getGlobalRoadGraphVersion: () => number
  getAuthoringTemplates: () => Record<string, string[]>
  getCompiledSectorContent: (sectorId: string) => {
    sectorId: string
    buildings: number
    props: number
    citizens: number
    segments: number
    destinations: number
    walls: number
    lots: { id: string; bounds: { minX: number; maxX: number; minZ: number; maxZ: number } }[]
  } | null
  validateSectorAuthoring: (sectorId: string) => string[]
  getAuthoringSourceRef: (
    contentId: string,
  ) => { sectorId: string; templateId: string; localId: string } | null
  /** Force a weather kind (instant by default; smooth with instant: false). */
  setWeather: (kind: string, options?: { instant?: boolean; intensity?: number }) => boolean
  /** Live weather runtime snapshot + today's scheduled kind. */
  getWeatherState: () => {
    kind: WeatherKind
    targetKind: WeatherKind
    transition: number
    intensity: number
    wetness: number
    manualOverride: boolean
    scheduled: WeatherKind
    modifiers: { trafficSpeedFactor: number; rainStrength: number; fogDensity: number }
  }
  /** Force the surface wetness (0..1) directly. */
  setWetness: (wetness: number) => void
  /** Advance weather simulation by N real seconds (transitions + wetness). */
  advanceWeather: (seconds: number) => void
  /** Ambient citizens currently visible (hidden ones sheltered indoors). */
  getVisibleCitizenCountByWeather: () => number
  /** Step through the apartment door (same rules as pressing E outside it). */
  enterApartment: () => void
  /** Leave the apartment back to the street entrance. */
  exitApartment: () => void
  /** 'city' or 'apartment'. */
  getLocationMode: () => PlayerLocationMode
  /** Outfit colors currently applied to the player mesh. */
  getAppearance: () => PlayerAppearance
  /** Update outfit colors (partial merge). */
  setAppearance: (appearance: Partial<PlayerAppearance>) => void
  /** Occlusion snapshot: subject, candidates, currently faded buildings. */
  getVisibilityState: () => {
    enabled: boolean
    subjectId: string | null
    subjectKind: string | null
    registeredCount: number
    candidateCount: number
    faded: { id: string; opacity: number; targetOpacity: number; reason: string }[]
  }
  /** Ids of every registered occludable. */
  getRegisteredOccluders: () => string[]
  /** Master switch for the occlusion system (visual A/B in tests). */
  setOcclusionEnabled: (enabled: boolean) => void
  /** Clear all fades and force fresh detection next frame. */
  forceVisibilityRecheck: () => void
  /** Live character-pipeline snapshot for an instance ('player' default). */
  getCharacterState: (id?: string) => {
    id: string
    activeVisual: string
    renderMode: string
    animState: string
    previousAnimState: string
    playbackRate: number
    speed: number
    resolvedSlots: string[]
    fallbackReason: string | null
    modelLoaded: boolean
  } | null
  /** Force 'model' | 'primitive' | 'auto' for every character. */
  setCharacterRenderMode: (mode: 'auto' | 'model' | 'primitive') => void
  /** Force a semantic gait (null restores normal motion-driven animation). */
  forceCharacterAnimation: (role: 'idle' | 'walk' | 'run' | null) => void
  /** Manifest info for the default character asset. */
  getCharacterAssetInfo: () => { id: string; modelPath: string; clips: string[]; bounds: unknown }
  setTime: (hour: number) => void
  /** Set the game-clock DAY (advance the real clock, e.g. into a plan's start window). */
  setGameDay: (day: number) => void
  setTimeScale: (scale: number) => void
  pauseWorld: (paused: boolean) => void
  setQuestState: (questId: string, state: QuestState) => void
  giveItem: (itemId: string, quantity: number) => void
  resetGame: () => void
  saveGame: () => Promise<boolean>
  loadGame: () => Promise<boolean>
  interact: () => void
}

declare global {
  interface Window {
    GAME_TEST_API?: GameTestApi
  }
}

/** Named teleport spots covering all three districts (dev/test only). */
export const TEST_LOCATIONS: Record<string, [number, number, number]> = {
  central_plaza: [0, 1.2, 0],
  residential_street: [-2, 1.2, -40.5],
  residential_crosswalk: [-2, 1.2, -40.8],
  industrial_strip: [43, 1.2, 22.5],
  warehouse_or_garage: [54.5, 1.2, 1.2],
  long_road_test: [-19, 1.2, -44],
  traffic_light_test: [-1, 1.2, -21.5],
  parking_lot_test: [13, 1.2, 14],
  apartment_entrance: [-12.5, 1.2, -7.2],
  residential_west_street: [-43.8, 1.2, -9],
  residential_south_street: [0, 1.2, 54],
  industrial_north_strip: [43.4, 1.2, -34.8],
  downtown_gateway: [48, 1.2, -84],
  gateway_plaza: [60, 1.2, -84],
  main_street_east: [94, 1.2, -92.2],
  // City Expansion Content Pack v1
  main_street_north: [100, 1.2, -290],
  waterfront: [0, 1.2, -302],
  residential_east: [238, 1.2, -89],
  industrial_yard: [-114, 1.2, -252],
  harbor_cross: [55, 1.2, -150],
  // Raw interior coordinates — prefer enterApartment() so the location flag
  // is set too; this exists for camera/visual framing only.
  apartment_interior: APARTMENT_SPAWN,
}

export function installTestApi(): void {
  if (!import.meta.env.DEV) return
  const api: GameTestApi = {
    ready: () => registry.gameReady,
    // Every mounted GLB instance has either committed to the scene or fallen
    // back. Callers must check ready() first so all instances are mounted.
    assetsSettled: () =>
      registry.glbLandmarksActive + registry.glbLandmarksFailed >=
      registry.glbLandmarksExpected,
    getStats: () => {
      const s = useGameStore.getState()
      const pos = s.mode === 'driving' ? registry.vehiclePosition : registry.playerPosition
      return {
        ...s.stats,
        mood: getMood(s.stats.hour),
        mode: s.mode,
        position: [pos.x, pos.y, pos.z],
        activeInteractableId: s.activeInteractableId,
        questStates: { ...s.questStates },
        inventory: { ...s.inventory },
        uiPanel: s.ui.panel,
        worldPaused: s.worldPaused,
      }
    },
    teleportPlayer: (position) => useGameStore.getState().requestTeleport(position),
    teleportTo: (name) => {
      const spot = TEST_LOCATIONS[name]
      if (!spot) return false
      useGameStore.getState().requestTeleport(spot)
      return true
    },
    getTestLocations: () => Object.keys(TEST_LOCATIONS),
    getPlayerDistrict: () => {
      const pos =
        useGameStore.getState().mode === 'driving'
          ? registry.vehiclePosition
          : registry.playerPosition
      return getDistrict(pos.x, pos.z)
    },
    getNpcPosition: (npcId) => {
      const p = registry.npcPositions.get(npcId)
      return p ? [p.x, p.y, p.z] : null
    },
    isNpcPanicking: (npcId) => isPanicking(npcId, getCrimeGameTime()),
    getAmbientCarPositions: () => {
      const out: Record<string, [number, number, number]> = {}
      for (const [id, p] of registry.ambientCarPositions) out[id] = [p.x, p.y, p.z]
      return out
    },
    getTrafficState: () => ({
      signal: (() => {
        const at = getPhaseAt(trafficRuntime.signal.elapsed)
        return {
          phase: at.phase,
          remaining: at.remaining,
          vehicle: getVehicleSignal(at.phase),
          pedestrian: getPedestrianSignal(at.phase),
        }
      })(),
      cars: [...trafficRuntime.cars.values()].map((c) => ({
        id: c.id,
        state: c.state,
        reason: c.reason,
        speed: c.speed,
        targetSpeed: c.targetSpeed,
        blockedTime: c.blockedTime,
        heading: c.heading,
        position: [c.x, c.z] as [number, number],
      })),
      pedestrians: [...trafficRuntime.pedestrians.values()].map((p) => ({
        id: p.id,
        state: p.state,
        waitingAtCrosswalkId: p.waitingAtCrosswalkId,
        crossingCrosswalkId: p.crossingCrosswalkId,
        position: [p.x, p.z] as [number, number],
      })),
      crosswalks: CROSSWALKS.map((zone) => {
        const status = getCrosswalkStatus(zone)
        return {
          id: status.id,
          occupied: status.occupied,
          hasWaitingPedestrian: status.hasWaitingPedestrian,
        }
      }),
    }),
    setNpcPosition: (id, position, waypointIndex) =>
      trafficRuntime.npcOverrides.set(id, { position, waypointIndex }),
    setAmbientCarPosition: (id, position, targetIndex) =>
      trafficRuntime.carOverrides.set(id, { position, targetIndex }),
    setDrivenCarPosition: (position, yaw = 0) => {
      const body = registry.vehicleBody
      if (!body) return
      body.setTranslation({ x: position[0], y: 0.8, z: position[1] }, true)
      body.setRotation({ x: 0, y: Math.sin(yaw / 2), z: 0, w: Math.cos(yaw / 2) }, true)
      body.setLinvel({ x: 0, y: 0, z: 0 }, true)
      body.setAngvel({ x: 0, y: 0, z: 0 }, true)
      registry.vehiclePosition.set(position[0], 0.8, position[1])
    },
    setSignalPhase: (phase) => {
      trafficRuntime.signal.elapsed = getPhaseStartOffset(phase as TrafficSignalPhase)
    },
    advanceSignalTime: (seconds) => {
      trafficRuntime.signal.elapsed += seconds
    },
    getVehiclePositions: () => {
      const out: Record<string, [number, number]> = {}
      for (const f of collectAllVehicleFootprints()) out[f.id] = [f.position.x, f.position.z]
      return out
    },
    assertNoVehicleVehicleOverlaps: () => findVehicleOverlaps(),
    assertNoPersonPersonOverlaps: (minDistance = 0.45) => {
      // registry.npcPositions holds only ACTIVE/visible people (dormant and
      // off-duty citizens are removed), so this naturally scopes to who is
      // actually on screen. Bodies closer than minDistance are phasing.
      const people = [...registry.npcPositions.entries()]
      const out: [string, string, number][] = []
      for (let i = 0; i < people.length; i++) {
        for (let j = i + 1; j < people.length; j++) {
          const [idA, a] = people[i]
          const [idB, b] = people[j]
          const d = Math.hypot(a.x - b.x, a.z - b.z)
          if (d < minDistance) out.push([idA, idB, Math.round(d * 100) / 100])
        }
      }
      return out
    },
    // Anti-phasing scoped to two MOVING people walking through each other — the
    // case person-separation guarantees. A walker briefly brushing a
    // momentarily-stationary person is a documented v1 limitation (needs a full
    // crowd-sim to resolve without deadlocking deterministic trips).
    assertNoMovingPeopleOverlaps: (minDistance = 0.45) => {
      const people = [...registry.npcPositions.entries()].filter(([id]) =>
        registry.movingPersonIds.has(id),
      )
      const out: [string, string, number][] = []
      for (let i = 0; i < people.length; i++) {
        for (let j = i + 1; j < people.length; j++) {
          const [idA, a] = people[i]
          const [idB, b] = people[j]
          const d = Math.hypot(a.x - b.x, a.z - b.z)
          if (d < minDistance) out.push([idA, idB, Math.round(d * 100) / 100])
        }
      }
      return out
    },
    // ---- World Integrity & City Certification Platform v1 ------------------
    getWorldEntities: () =>
      listEntities().map((e) => ({ id: e.id, kind: e.kind, x: e.x, z: e.z, sectorId: e.sectorId })),
    getIntegritySnapshot: () => getIntegritySnapshot(),
    getIntegrityAnomalies: () => getActiveAnomalies().map((a) => ({ ...a, entityIds: [...a.entityIds] })),
    runIntegrityScan: () => runIntegrityScan(),
    assertNoPersonVehicleOverlaps: () =>
      getActiveAnomalies()
        .filter((a) => a.type === 'person_vehicle_overlap')
        .map((a) => [a.entityIds[0], a.entityIds[1]] as [string, string]),
    assertNoPersonSolidOverlaps: () =>
      getActiveAnomalies()
        .filter((a) => a.type === 'person_solid_overlap')
        .map((a) => [a.entityIds[0], a.entityIds[1]] as [string, string]),
    getOcclusionParity: () => certifyOcclusionParity(),
    getLiveOcclusionParity: () =>
      checkLiveOcclusionParity(
        // Exclude linked decal occluders (they intentionally have non-building ids).
        [...visibilityRuntime.occluders.values()]
          .filter((o) => !o.descriptor.linkedTo)
          .map((o) => o.descriptor.id),
      ),
    getSafetyRing: () => {
      const s = safetyRingRuntime
      if (!s.lastStatus) return null
      return {
        covered: s.lastStatus.covered,
        currentSector: s.lastStatus.currentSector,
        enteringSector: s.lastStatus.enteringSector,
        notReady: [...s.lastStatus.notReady],
        selfHeals: s.totalSelfHeals,
        backstops: s.totalBackstops,
      }
    },
    isSectorReady: (id: string) => isSectorReadyForGameplay(id),
    holdSectorReadiness: (id: string) => holdSectorReadiness(id),
    releaseSectorReadiness: (id: string) => releaseSectorReadiness(id),
    getPlacementReport: () =>
      getCityPlacementReports().map((r) => ({
        sectorId: r.sectorId,
        failures: r.failures.map((f) => ({
          kind: f.kind,
          entityId: f.entityId,
          otherId: f.otherId,
          reason: f.reason,
          correction: f.correction,
        })),
        counts: r.counts,
      })),
    getTraversalTargets: () => generateTraversalTargets().map((t) => ({ ...t })),
    getCityCertification: () => {
      const c = certifyCity()
      return {
        verdict: c.verdict,
        passed: c.passed,
        totalDistricts: c.totalDistricts,
        districts: c.districts.map((d) => ({
          sectorId: d.sectorId,
          displayName: d.displayName,
          verdict: d.verdict,
          errors: d.errors,
          warnings: d.warnings,
          checks: d.checks.map((x) => ({ name: x.name, status: x.status, severity: x.severity })),
        })),
      }
    },
    // ---- Social Life, Relationships & NPC Memory v1 ------------------------
    getSocialSnapshot: () => socialSnapshot(),
    getSocialRelationship: (id: string) => {
      const rel = getSocialRel(id)
      const d = getSocialDerived(id)
      return { ...rel, tier: d.tier, hostile: d.hostile, afraid: d.afraid }
    },
    getSocialMemories: (id: string) =>
      getSocialMems(id).map((m) => ({ id: m.id, kind: m.kind, salience: m.salience, valence: m.valence, pinned: m.pinned, summaryToken: m.summaryToken, gameDay: m.gameDay })),
    getSocialContacts: () => [...getSocialContactsRt()],
    ingestSocialEvent: (event) => {
      const r = ingestSocialEventRt(event as SocialEvent)
      return { applied: r.applied, contactUnlocked: r.contactUnlocked }
    },
    openDialogueWith: (npcId: string) => useGameStore.getState().openDialogue(npcId),
    getSocialMenu: (npcId: string) => useGameStore.getState().getSocialMenu(npcId),
    performSocialAction: (npcId: string, actionId: string, itemId?: string) =>
      useGameStore.getState().performSocialAction(npcId, actionId as SocialActionId, itemId ? { itemId } : undefined),
    reconcileSocialOutreach: (gameDay: number, gameHour: number) => reconcileOutreachRt(gameDay, gameHour),
    sendSocialInvite: (npcId: string, activityKind?: string) =>
      useGameStore.getState().sendPlayerInvite(npcId, activityKind as InvitationActivityKind | undefined),
    respondToInvitation: (invitationId: string, status: string) =>
      useGameStore.getState().respondToInvitation(invitationId, status as 'accepted' | 'declined' | 'suggested_later'),
    getSocialInvitations: () =>
      getSocialInvitationsRt().map((i) => ({ id: i.id, actorId: i.actorId, source: i.source, activityKind: i.activityKind, status: i.status, proposedDay: i.proposedDay })),
    getSocialMessages: (npcId: string) =>
      getSocialMessagesRt(npcId).map((m) => ({ id: m.id, dir: m.dir, token: m.token, read: m.read, gameDay: m.gameDay })),
    getSocialUnread: () => getSocialUnreadRt(),
    getActiveSocialActivity: () => {
      const a = getActiveActivityRt()
      return a ? { id: a.id, actorId: a.actorId, template: a.template, step: a.step, venueId: a.venueId, venueLabel: a.venueLabel, requiredItemId: a.requiredItemId } : null
    },
    startSocialActivity: (invitationId: string) => useGameStore.getState().startSocialActivity(invitationId),
    startFavorFor: (npcId: string) => useGameStore.getState().startFavorFor(npcId),
    advanceSocialActivity: () => useGameStore.getState().advanceSocialActivity(),
    cancelSocialActivity: () => useGameStore.getState().cancelSocialActivity(),
    devWitnessCrimeAt: (npcId: string) => {
      const pos = registry.npcPositions.get(npcId)
      if (!pos) return false
      const { day, hour } = useGameStore.getState().stats
      const seen = noteCrimeWitnessedRt(`devcrime:${npcId}:${day}:${Math.round(hour)}`, [pos.x, pos.y, pos.z], day, hour)
      return seen.includes(npcId)
    },
    getSocialConfirmedPlans: () =>
      getConfirmedPlansRt().map((i) => ({ id: i.id, actorId: i.actorId, activityKind: i.activityKind, status: i.status, proposedDay: i.proposedDay, proposedHour: i.proposedHour })),
    reconcileMissedInvitations: (gameDay: number, gameHour: number) => reconcileMissedInvitationsRt(gameDay, gameHour),
    /** DEV/E2E: simulate arrival at a venue (the real proximity scanner sets this
     *  in live play; a headless test can set it directly to exercise the gate). */
    setActiveInteractable: (id: string | null) => useGameStore.getState().setActiveInteractable(id),
    getCareerSnapshot: () => careerSnapshotRt(),
    getCareerSkillLevel: (skill: string) => getCareerSkillLevelRt(skill as SkillId),
    applyToCareer: (careerId: string) => useGameStore.getState().applyToCareer(careerId as CareerId),
    grantCareerRecommendation: (employerId: string) => grantCareerRecommendationRt(employerId),
    ingestCareerEvent: (event: CareerEvent) => ingestCareerEventRt(event),
    reconcileMissedShifts: (gameDay: number, gameHour: number) => reconcileCareerMissedRt(gameDay, gameHour).length,
    getCareerScheduledShifts: () => getCareerShiftsRt().map((s) => ({ id: s.id, careerId: s.careerId, status: s.status, scheduledDay: s.scheduledDay, startHour: s.startHour })),
    getCareerNextShift: () => {
      const s = getCareerNextShiftRt()
      return s ? { id: s.id, careerId: s.careerId, scheduledDay: s.scheduledDay, startHour: s.startHour, workplaceInteractableId: s.workplaceInteractableId } : null
    },
    startCareerShift: (shiftId: string) => useGameStore.getState().startCareerShift(shiftId),
    advanceCareerShift: () => useGameStore.getState().advanceCareerShift(),
    cancelCareerShift: () => useGameStore.getState().cancelCareerShift(),
    getActiveCareerShift: () => {
      const s = getActiveCareerShiftRt()
      if (!s) return null
      return { id: s.id, careerId: s.careerId, status: s.status, workplaceInteractableId: s.workplaceInteractableId, objectives: (s.objectives ?? []).map((o) => ({ id: o.id, kind: o.kind, description: o.description, done: o.done, optional: o.optional, anchorId: o.anchorId ?? null, requiresCargoItemId: o.requiresCargoItemId ?? null })) }
    },
    getCareerPromotion: (careerId: string) => {
      const p = getCareerPromotionRt(careerId as CareerId)
      return p ? { currentRank: p.currentRank, nextRank: p.nextRank ? p.nextRank.id : null, met: p.met, rows: p.rows } : null
    },
    getCareerRecentResults: () => getCareerRecentResultsRt().map((r) => ({ careerId: r.careerId, reason: r.reason, score: r.score, base: r.base, rankModifier: r.rankModifier, performanceModifier: r.performanceModifier, pay: r.pay, onTime: r.onTime })),
    hasCareerUnlock: (unlockId: string) => hasCareerUnlockRt(unlockId),
    getCareerCommitmentSlots: () => getCareerCommitmentSlotsRt(),
    reconcileCareerRecommendations: (gameDay: number, gameHour: number) => careerReconcileRecsRt(gameDay, gameHour),
    performActivityAction: (actionId: string) => useGameStore.getState().performActivityAction(actionId),
    // ---- Cross-District Traffic Routing v1 ---------------------------------
    getRoadGraphSummary: () => {
      const graph = getRoadGraph()
      return {
        version: graph.version,
        nodeCount: graph.nodes.size,
        segmentCount: graph.segments.size,
        edgeCount: graph.edges.length,
        destinationCount: graph.destinations.size,
        spawnPointCount: graph.spawnPoints.size,
      }
    },
    getRoadGraph: () => {
      const graph = getRoadGraph()
      return {
        version: graph.version,
        segments: [...graph.segments.values()].map((s) => ({
          id: s.id,
          kind: s.kind,
          districtId: s.districtId,
          roadId: s.roadId,
          points: s.points,
          length: s.length,
        })),
        edges: graph.edges.map((e) => ({ ...e })),
      }
    },
    getVehicleRouteState: (vehicleId) => serializeRouteState(vehicleId),
    getAllVehicleRouteStates: () =>
      [...routeRuntime.states.keys()].map((id) => serializeRouteState(id)!),
    forceVehicleDestination: (vehicleId, destinationId) => {
      routeRuntime.forcedDestinations.set(vehicleId, destinationId)
      routeRuntime.replanRequests.add(vehicleId)
    },
    replanVehicleRoute: (vehicleId) => {
      routeRuntime.replanRequests.add(vehicleId)
    },
    getSegmentCongestion: () =>
      [...routeRuntime.congestion.values()].map((c) => ({ ...c })),
    setSegmentBlocked: (segmentId, blocked) => {
      if (blocked) routeRuntime.blockedSegmentIds.add(segmentId)
      else routeRuntime.blockedSegmentIds.delete(segmentId)
    },
    clearTrafficRecoveryState: (vehicleId) => {
      const state = routeRuntime.states.get(vehicleId)
      if (!state) return
      state.stoppedTime = 0
      state.suspectTime = 0
      state.recoveryStage = 0
      state.recoveryAttempts = 0
      state.blockageReason = 'none'
    },
    teleportAmbientVehicleToSegment: (vehicleId, segmentId, progress) => {
      const graph = getRoadGraph()
      const seg = graph.segments.get(segmentId)
      if (!seg) return false
      const [x, z] = pointAtProgress(seg, Math.max(0, Math.min(1, progress)))
      trafficRuntime.carOverrides.set(vehicleId, { position: [x, z] })
      return true
    },
    getCompletedTrips: (vehicleId) => routeRuntime.states.get(vehicleId)?.tripsCompleted ?? 0,
    // ---- Signalized cross-street intersections ---------------------------
    getIntersectionIds: () => INTERSECTIONS.map((x) => x.id),
    getIntersectionState: (id) => getIntersectionStateSnapshot(id, trafficRuntime.signal.elapsed),
    getSignalPlan: (id) => {
      const x = getIntersection(id)
      return x ? { cycleLength: x.cycleLength, phases: x.phases } : null
    },
    getMovementPermission: (id, approach) => {
      const x = getIntersection(id)
      return x ? getMovementSignal(x, approach as never, trafficRuntime.signal.elapsed) : null
    },
    setIntersectionElapsed: (seconds) => {
      trafficRuntime.signal.elapsed = seconds
      trafficRuntime.signal.pinned = seconds
    },
    // ---- Live pedestrian crossings v1 -------------------------------------
    getCrossingPedestrians: (intersectionId) => {
      const x = getIntersection(intersectionId)
      if (!x) return []
      return x.crossings.map((c) => {
        const queued: string[] = []
        const crossing: string[] = []
        for (const ped of trafficRuntime.pedestrians.values()) {
          if (ped.waitingAtCrosswalkId === c.id) queued.push(ped.id)
          if (ped.crossingCrosswalkId === c.id) crossing.push(ped.id)
        }
        const zone = getIntersectionCrossingZone(c.id)!
        return {
          crossingId: c.id,
          walkSignal: getIntersectionCrossingSignal(c.id, trafficRuntime.signal.elapsed),
          occupied: getCrosswalkStatus(zone).occupied,
          queued,
          crossing,
        }
      })
    },
    forceCitizenToCrossing: (citizenId, crossingId, t = 0.5) => {
      const rec =
        INTERSECTIONS.flatMap((x) => x.crossings).find((c) => c.id === crossingId) ??
        WALK_CROSSINGS.find((c) => c.id === crossingId)
      if (!rec || !AMBIENT_CITIZENS.some((c) => c.id === citizenId)) return false
      const [a, b] = rec.waitSpots
      const k = Math.max(0, Math.min(1, t))
      const pos: [number, number] = [a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k]
      // t at the ends means "standing at the curb" — off the roadway, NOT
      // occupying the zone; anything in between is committed mid-crossing.
      const atCurb = k <= 0.05 || k >= 0.95
      citizenPoseOverrides.set(citizenId, {
        pos,
        heading: Math.atan2(b[0] - a[0], b[1] - a[1]),
        state: atCurb ? 'walking_sidewalk' : 'crossing',
        crosswalkId: atCurb ? null : crossingId,
        pending: true,
      })
      const ped = trafficRuntime.pedestrians.get(citizenId)
      if (ped) {
        ped.x = pos[0]
        ped.z = pos[1]
        ped.state = atCurb ? 'walking_sidewalk' : 'crossing'
        ped.crossingCrosswalkId = atCurb ? null : crossingId
        ped.waitingAtCrosswalkId = null
      }
      return true
    },
    getPedestrianCrossingState: (citizenId) => {
      const ped = trafficRuntime.pedestrians.get(citizenId)
      if (!ped) return null
      return {
        state: ped.state,
        crosswalkId: ped.crossingCrosswalkId ?? ped.waitingAtCrosswalkId,
        waitTime: ped.waitTime,
        position: [ped.x, ped.z],
      }
    },
    setPedestrianCrossingDebug: (enabled) => {
      trafficRuntime.pedestrianCrossingDebug = enabled
    },
    // ---- Crossing-aware citizen destinations v1 ---------------------------
    getCitizenTripState: (citizenId) => getTripSnapshot(citizenId),
    getCitizenDestinations: () => listDestinations(),
    forceCitizenDestination: (citizenId, destinationId) => {
      const ped = trafficRuntime.pedestrians.get(citizenId)
      if (!ped) return false
      return forceTripDestination(citizenId, destinationId, [ped.x, ped.z])
    },
    getPedestrianGraphSummary: () => graphSummary(),
    getDestinationOccupancy: (destinationId) => occupancyCount(destinationId),
    replanCitizenTrip: (citizenId) => {
      const ped = trafficRuntime.pedestrians.get(citizenId)
      if (!ped) return false
      return replanTrip(citizenId, [ped.x, ped.z])
    },
    setCitizenDestinationDebug: (enabled) => {
      tripRuntime.debugEnabled = enabled
    },
    getCrosswalkVisualSpec: (crossingId) => getCrossingArtSummary(crossingId),
    getCrosswalkVisualIds: () => CROSSING_ART.map((a) => a.spec.crossingId),
    getCrosswalkFurniture: (crossingId) =>
      getCrossingArt(crossingId)?.furniture.map((f) => ({
        id: f.id,
        kind: f.kind,
        position: [...f.position],
      })) ?? [],
    validateCrosswalkVisuals: () => validateCrossingArt(),
    setCrosswalkVisualDebug: (enabled) => {
      crossingArtDebug.enabled = enabled
    },
    // ---- Crime & Law Enforcement v1 ---------------------------------------
    emitCrime: (type, position) => {
      const p: [number, number, number] = position ?? [
        registry.playerPosition.x,
        registry.playerPosition.y,
        registry.playerPosition.z,
      ]
      const e = emitCrimeEvent(
        { type: type as CrimeType, position: p, suspectEntityId: 'player' },
        getCrimeGameTime(),
      )
      return e ? { id: e.id } : null
    },
    getCrimeEvents: () =>
      getCrimeEventsSnapshot().map((e) => ({
        id: e.id,
        type: e.type,
        position: e.position,
        sectorId: e.sectorId,
        severity: e.severity,
        status: e.status,
        witnessedBy: e.witnessedBy,
        reportedBy: e.reportedBy,
      })),
    getWantedState: () => {
      const s = getWantedSnapshot()
      return {
        heat: s.heat,
        level: s.level,
        status: s.status,
        lastKnownPosition: s.lastKnownPosition,
        activeIncidentIds: s.activeIncidentIds,
      }
    },
    setWantedLevel: (level) => {
      const p = registry.playerPosition
      setWantedLevelRuntime(level as WantedLevel, [p.x, p.y, p.z], getCrimeGameTime())
    },
    clearWanted: () => clearWanted(),
    forceWitnessReport: (citizenId, crimeId) => {
      const ev = crimeRuntime.events.find((e) => e.id === crimeId)
      if (!ev) return false
      fileReport(ev, citizenId, getCrimeGameTime())
      return true
    },
    getWitnessState: (citizenId) => getWitnessStateSnapshot(citizenId),
    setCrimeDebug: (enabled) => {
      crimeRuntime.debugEnabled = enabled
      witnessRuntime.debugEnabled = enabled
    },
    stealVehicle: (vehicleId) => useGameStore.getState().stealVehicle(vehicleId),
    exitPlayerVehicle: () => useGameStore.getState().exitVehicle(),
    getVehicleCrimeState: (vehicleId) => {
      const r = getVehicleCrimeStateRuntime(vehicleId)
      return { access: r.access, stolen: r.stolen, ownerId: r.ownerId, health: r.health, disabled: r.disabled }
    },
    setVehicleHealth: (vehicleId, value) => setVehicleHealthRuntime(vehicleId, value),
    getVehicleOccupant: (vehicleId) => getVehicleOccupantRuntime(vehicleId),
    forceOccupiedVehicleTheft: (vehicleId) => useGameStore.getState().stealVehicle(vehicleId),
    getEjectedDrivers: () =>
      getEjectedDrivers().map((d) => ({
        id: d.id,
        vehicleId: d.vehicleId,
        position: d.pos,
        heading: d.heading,
      })),
    // ---- Police dispatch & AI (M4) ----------------------------------------
    spawnPoliceResponse: (level) => {
      const p = registry.playerPosition
      setWantedLevelRuntime(level as WantedLevel, [p.x, p.y, p.z], getCrimeGameTime())
      stepDispatch({
        gameTime: getCrimeGameTime(),
        suspectPosition: [p.x, p.z],
        cameraBox: null,
      })
      return policeActiveCounts().vehicles
    },
    getPoliceUnits: () =>
      getPoliceUnitsSnapshot().map((u) => ({
        id: u.id,
        kind: u.kind,
        state: u.state,
        position: u.position,
        health: u.health,
        seesSuspect: u.seesSuspect,
      })),
    getPoliceUnitState: (id) => getPoliceUnit(id)?.state ?? null,
    teleportPoliceUnit: (id, x, z) => {
      const u = getPoliceUnit(id)
      if (!u) return false
      u.position = [x, z]
      return true
    },
    setPoliceState: (id, state) =>
      setPoliceStateRuntime(id, state as ReturnType<typeof getPoliceUnitsSnapshot>[number]['state']),
    getArrestState: () => ({
      arrestsMade: policeRuntime.arrestsMade,
      lastArrestAt: policeRuntime.lastArrestAt,
    }),
    setPoliceDebug: (enabled) => {
      policeRuntime.debugEnabled = enabled
    },
    getPoliceRouteState: (unitId) => {
      const r = getPoliceRoute(unitId)
      if (!r) return null
      return {
        mode: r.mode,
        segmentIds: [...r.segmentIds],
        cursor: r.cursor,
        targetSegmentId: r.targetSegmentId,
        replanCount: r.replanCount,
      }
    },
    getPoliceRouteMetrics: () => ({
      totalReplans: policeRouteRuntime.totalReplans,
      activeRoutes: policeRouteRuntime.routes.size,
    }),
    getNearestRoadDistance: (x, z) => {
      const proj = nearestRoadSegment(getRoadGraph(), [x, z])
      return proj ? proj.distance : Infinity
    },
    // ---- Dismounted officers (Hard M4) ------------------------------------
    getPoliceCruisers: () =>
      [...policeRuntime.units.values()]
        .filter((u) => u.kind === 'vehicle')
        .map((u) => ({
          id: u.id,
          state: u.state,
          position: [u.position[0], u.position[1]] as [number, number],
          hasOfficers: hasActiveOfficers(u.id),
        })),
    getPoliceOfficers: () =>
      [...policeRuntime.units.values()]
        .filter((u) => u.kind === 'officer')
        .map((u) => ({
          id: u.id,
          state: u.state,
          position: [u.position[0], u.position[1]] as [number, number],
          cruiserId: u.cruiserId ?? null,
          health: u.health,
          seesSuspect: u.seesSuspect,
        })),
    getPoliceCounts: () => policeActiveCounts(),
    forcePoliceDismount: (suspectX, suspectZ) => {
      const level = getWantedLevelValue()
      if (level < 1) return 0
      const before = policeActiveCounts().officers
      const plans = planDismounts({
        units: [...policeRuntime.units.values()],
        suspectPos: [suspectX, suspectZ],
        suspectOnFoot: true,
        officerCap: POLICE_CAPS[level].officers,
        currentOfficers: before,
      })
      for (const plan of plans) {
        const cruiser = policeRuntime.units.get(plan.cruiserId)
        if (!cruiser) continue
        const exit = avoidSolids(
          cruiserExit(cruiser.position[0], cruiser.position[1], cruiser.heading),
        )
        spawnPoliceOfficer(plan.cruiserId, exit, plan.incidentId, getCrimeGameTime())
      }
      return policeActiveCounts().officers - before
    },
    // ---- Missions & Activities (Mission Framework v1) ---------------------
    getMissionDefinitions: () =>
      MISSION_DEFINITIONS.map((m) => ({
        id: m.id,
        title: m.title,
        category: m.category,
        objectives: m.objectives.length,
      })),
    getMissionState: () => {
      const a = missionRuntime.active
      const def = a ? getMissionDefinition(a.missionId) : undefined
      const obj = def?.objectives[a?.objectiveIndex ?? 0]
      return {
        activeMissionId: a?.missionId ?? null,
        attemptId: a?.attemptId ?? null,
        objectiveIndex: a?.objectiveIndex ?? 0,
        objectiveCount: def?.objectives.length ?? 0,
        objectiveId: obj?.id ?? null,
        objectiveKind: obj?.kind ?? null,
        objectiveDescription: obj?.description ?? null,
        variables: a ? { ...a.variables } : {},
        ownedEntities: a ? [...a.ownedEntityIds] : [],
        result: missionRuntime.result
          ? { outcome: missionRuntime.result.outcome, reason: missionRuntime.result.reason ?? null }
          : null,
      }
    },
    getMissionAvailability: (missionId) => {
      const def = getMissionDefinition(missionId)
      if (!def) return 'unknown'
      const { day, hour } = useGameStore.getState().stats
      return getMissionAvailability(def, {
        gameHours: day * 24 + hour,
        activeMissionId: missionRuntime.active?.missionId ?? null,
        discovered: missionRuntime.discovered,
        cooldownReadyAt: Object.fromEntries(
          Object.values(missionRuntime.cooldowns).map((c) => [c.missionId, c.readyAtGameHours]),
        ),
      })
    },
    getMissionHistory: () =>
      Object.fromEntries(
        Object.values(missionRuntime.history).map((h) => [
          h.missionId,
          {
            completions: h.completions,
            totalEarned: h.totalEarned,
            lastCompletedGameHours: h.lastCompletedGameHours,
          },
        ]),
      ),
    getMissionCooldownHours: (missionId) => {
      const cd = missionRuntime.cooldowns[missionId]
      if (!cd) return 0
      const { day, hour } = useGameStore.getState().stats
      return Math.max(0, cd.readyAtGameHours - (day * 24 + hour))
    },
    getMissionTargetVehicle: () =>
      (missionRuntime.active?.variables.targetVehicle as string | undefined) ?? null,
    setMissionTargetVehicle: (vehicleId) => {
      const a = missionRuntime.active
      if (!a) return false
      a.variables.targetVehicle = vehicleId
      a.ownedEntityIds.add(vehicleId)
      return true
    },
    getMissionValidation: () =>
      validateMissions({
        anchorIds: new Set(MISSION_ANCHORS.map((x) => x.id)),
        interactableIds: new Set(Object.keys(INTERACTABLE_BY_ID)),
        registeredSectorIds: new Set(SECTOR_DEFINITIONS.map((d) => d.id)),
        phoneJobIds: new Set(
          MISSION_DEFINITIONS.filter((m) => m.offerSource.kind === 'phone_job').map((m) =>
            m.offerSource.kind === 'phone_job' ? m.offerSource.jobId : '',
          ),
        ),
      }),
    startMission: (missionId) => {
      discoverAndOfferMission(missionId)
      return missionAccept(missionId).ok
    },
    cancelMission: () => missionCancel(),
    retryMission: () => missionRetry().ok,
    forceMissionEvent: (event) => emitMissionEvent(event),
    teleportToMissionObjective: () => {
      const a = missionRuntime.active
      const def = a ? getMissionDefinition(a.missionId) : undefined
      const obj = def?.objectives[a?.objectiveIndex ?? 0]
      if (!a || !obj) return false
      let pos: [number, number, number] | null = null
      if (obj.kind === 'reach_zone' || obj.kind === 'drive_vehicle_to_zone') {
        const an = getMissionAnchor(obj.anchorId)
        if (an) pos = [an.position[0], 1.2, an.position[2]]
      } else if (obj.kind === 'interact' || obj.kind === 'deliver_vehicle' || obj.kind === 'return_to_giver') {
        const an = getMissionAnchor(obj.interactableId === 'hotcargo_fixer' ? 'hotcargo_garage' : obj.interactableId)
        if (an) pos = [an.position[0], 1.2, an.position[2]]
      } else if (obj.kind === 'steal_vehicle') {
        const targetId = a.variables.targetVehicle as string | undefined
        const v = targetId ? getStealable(targetId) : undefined
        if (v) pos = [v.position[0], 1.2, v.position[1]]
      }
      if (!pos) return false
      useGameStore.getState().requestTeleport(pos)
      return true
    },
    setMissionDebug: (enabled) => {
      missionRuntime.debugEnabled = enabled
    },
    // ---- Criminal activities / Store Robbery v1 ---------------------------
    getRobberyDefinitions: () =>
      ROBBERY_DEFINITIONS.map((d) => ({
        id: d.id,
        kind: d.kind,
        interiorId: d.interiorId,
        cashRange: { ...d.cashRange },
        cooldownGameHours: d.cooldownGameHours,
      })),
    getActivityState: () => {
      const a = activityRuntime.active
      const s = useGameStore.getState()
      return {
        activeId: a?.activityId ?? null,
        phase: a?.phase ?? 'idle',
        cashierPhase: a?.cashierPhase ?? 'calm',
        decision: a?.decision ?? null,
        unsecuredProceeds: activityRuntime.unsecuredProceeds,
        alarmArmed: a?.alarmReportsAtGameTime !== null && a?.alarmReportsAtGameTime !== undefined,
        alarmFired: a?.alarmFired ?? false,
        threatProgress: s.activityView.threatProgress,
        canLoot: s.activityView.canLoot,
        canSecure: s.activityView.canSecure,
        result: activityRuntime.result
          ? { outcome: activityRuntime.result.outcome, amount: activityRuntime.result.amount }
          : null,
        location: s.location,
        interiorId: s.currentInteriorId,
        containmentPhase: activityRuntime.containment.phase,
        breachSeconds: breachCountdown(activityRuntime.containment),
      }
    },
    getContainmentState: () => {
      const c = activityRuntime.containment
      return {
        storeId: c.storeId,
        phase: c.phase,
        phaseSeconds: c.phaseSeconds,
        breached: c.breached,
        breachSeconds: breachCountdown(c),
      }
    },
    getInteriorCivilians: (interiorId) => {
      const interior = getInterior(interiorId)
      const def = getRobberyForInterior(interiorId)
      if (!interior || !def) return null
      return getCivilians(interior, def).map((a) => ({
        id: a.id,
        role: a.role,
        reaction: a.reaction,
        pos: [a.pos[0], a.pos[1]] as [number, number],
        crouch: a.crouch,
        arrived: a.arrived,
        reported: a.reported,
      }))
    },
    getStoreRobberyState: (storeId) => {
      const s = activityRuntime.stores[storeId]
      return s
        ? {
            cooldownReadyAtGameHours: s.cooldownReadyAtGameHours,
            robberyCount: s.robberyCount,
            registerEmptied: s.registerEmptied,
          }
        : null
    },
    getActivityValidation: () =>
      validateRobberies({
        interiorIds: new Set(INTERIORS.map((i) => i.id)),
        interiorBounds: new Map(
          INTERIORS.map((i) => [
            i.id,
            { origin: i.origin, halfWidth: i.size.width / 2, halfDepth: i.size.depth / 2 },
          ]),
        ),
        registeredSectorIds: new Set(SECTOR_DEFINITIONS.map((d) => d.id)),
        interactableIds: new Set(Object.keys(INTERACTABLE_BY_ID)),
        questCriticalNpcIds: new Set(NPC_DEFS.map((n) => n.id)),
      }),
    getRobberyLoot: (activityId, attemptId) => {
      const def = getRobberyDefinition(activityId)
      return def ? rollLoot(def, attemptId) : 0
    },
    enterInterior: (interiorId) => useGameStore.getState().enterInterior(interiorId),
    exitInterior: () => useGameStore.getState().exitInterior(),
    forceBeginRobbery: (activityId) => tryBeginRobbery(activityId).ok,
    lootStoreRegister: () => useGameStore.getState().lootStoreRegister(),
    secureRobberyProceeds: () => useGameStore.getState().secureRobberyProceeds(),
    setPlayerHeading: (heading) => {
      registry.playerHeading = heading
    },
    resetActivities: () => {
      resetActivityRuntime()
      resetInteriorCivilians()
      useGameStore.getState().syncActivityUI(0)
    },
    setActivityDebug: (enabled) => {
      activityRuntime.debugEnabled = enabled
    },
    // ---- Personal Economy, Inventory & Shopping v1 ------------------------
    getItemCatalog: () =>
      ITEM_DEFINITIONS.map((d) => ({
        id: d.id,
        name: d.name,
        category: d.category,
        price: d.price,
        stackLimit: d.stackLimit,
        usable: d.usable,
        questReserved: d.questReserved,
      })),
    getItemValidation: () =>
      validateItemCatalog({
        paletteIds: new Set(APPEARANCE_PRESETS.map((p) => p.id)),
        lockedPaletteIds: new Set(LOCKED_PALETTE_IDS),
      }),
    getBackpack: () => {
      const inv = useGameStore.getState().inventory
      return { stacks: { ...inv }, occupied: occupiedSlots(inv), capacity: BACKPACK_CAPACITY }
    },
    getStorageContainer: () => {
      const st = useGameStore.getState().storage
      return { stacks: { ...st }, occupied: occupiedSlots(st), capacity: STORAGE_CAPACITY }
    },
    getWardrobeUnlocks: () => [...useGameStore.getState().wardrobeUnlocks],
    giveTestItem: (id, qty) => useGameStore.getState().giveItem(id, qty),
    useTestItem: (id) => useGameStore.getState().useItem(id),
    discardTestItem: (id, qty) => useGameStore.getState().discardItem(id, qty),
    depositTestItem: (id, qty) => useGameStore.getState().depositItem(id, qty),
    withdrawTestItem: (id, qty) => useGameStore.getState().withdrawItem(id, qty),
    openTestShop: (storeId) => useGameStore.getState().openShop(storeId),
    buyTestItem: (storeId, itemId) => useGameStore.getState().buyItem(storeId, itemId),
    getShopView: () => useGameStore.getState().shopView,
    getStoreCatalog: (storeId) => {
      const d = getStoreDefinition(storeId)
      return d ? d.listings.map((l) => ({ itemId: l.itemId, maxStock: l.maxStock, restockAmount: l.restockAmount })) : null
    },
    getStoreStockState: (storeId) => {
      const s = getStoreStock(storeId)
      return { stock: { ...s.stock }, lastRestockGameHours: s.lastRestockGameHours }
    },
    reconcileStoreStock: (storeId, gameHours) => ({ ...reconcileStore(storeId, gameHours).stock }),
    getCommerceReceipts: () => [...commerceRuntime.restockReceipts],
    getCommerceValidation: () =>
      validateStores({
        itemIds: new Set(ITEM_DEFINITIONS.map((i) => i.id)),
        interiorIds: new Set(INTERIORS.map((i) => i.id)),
        interactableIds: new Set(Object.keys(INTERACTABLE_BY_ID)),
        activityIds: new Set(ROBBERY_DEFINITIONS.map((r) => r.id)),
      }),
    collectTestShelfCrate: () => useGameStore.getState().collectShelfCrate(),
    deliverTestShelfCrate: (storeId) => useGameStore.getState().deliverShelfCrate(storeId),
    openTestPanel: (panel) =>
      useGameStore.setState((s) => ({
        ui: { ...s.ui, panel: panel as never, dialogueNpcId: null, activityId: null },
      })),
    openTestPhoneApp: (app) =>
      useGameStore.setState((s) => ({ ui: { ...s.ui, panel: 'phone', activePhoneApp: app as never } })),
    // ---- Firearm + health/damage (M5) -------------------------------------
    givePlayerWeapon: (id) => giveWeapon((id as WeaponId) ?? 'handgun'),
    drawPlayerWeapon: () => drawWeapon(),
    holsterPlayerWeapon: () => holsterWeapon(),
    setPlayerAmmo: (magazine, reserve) => setAmmo(magazine, reserve),
    getWeaponState: () => {
      const s = getWeaponSnapshot()
      return {
        equipped: s.equipped,
        pose: s.pose,
        magazine: s.magazine,
        reserve: s.reserve,
        reloading: s.reloading,
      }
    },
    firePlayerWeaponAt: (x, z) => {
      const p = registry.playerPosition
      const origin: [number, number] = [p.x, p.z]
      const dx = x - p.x
      const dz = z - p.z
      const len = Math.hypot(dx, dz) || 1
      // Gather live actors as hitscan targets (mirrors PlayerWeapon).
      const targets: HitscanTarget[] = []
      for (const u of policeRuntime.units.values()) {
        if (!isIncapacitated(u.id)) {
          targets.push({ id: u.id, position: [u.position[0], u.position[1]], radius: 0.7, kind: 'police' })
        }
      }
      for (const c of ambientCitizenRuntime.values()) {
        if (c.state === 'hidden' || isIncapacitated(c.id)) continue
        targets.push({ id: c.id, position: [c.x, c.z], radius: 0.45, kind: 'citizen' })
      }
      // Bystanders (panic) = hittable citizens PLUS the named residents, who
      // flee-and-recover but are never hittable (mirrors PlayerWeapon).
      const bystanders: { id: string; position: [number, number] }[] = targets
        .filter((t) => t.kind === 'citizen')
        .map((t) => ({ id: t.id, position: [t.position[0], t.position[1]] }))
      for (const [id, np] of registry.npcPositions) bystanders.push({ id, position: [np.x, np.z] })
      const r = firePlayerWeapon({
        origin,
        aimDir: [dx / len, dz / len],
        gameTime: getCrimeGameTime(),
        targets,
        bystanders,
      })
      return {
        fired: r.fired,
        hit: r.hit,
        targetId: r.targetId,
        targetKind: r.targetKind,
        incapacitated: r.incapacitated,
      }
    },
    setPlayerHealth: (value) => useGameStore.getState().setPlayerHealth(value),
    getPlayerHealth: () => ({
      health: useGameStore.getState().playerHealth,
      incapacitated: useGameStore.getState().playerIncapacitated,
    }),
    respawnPlayer: (kind) => useGameStore.getState().respawnAfterIncident(kind),
    getRecoveryState: () => {
      const r = useGameStore.getState().recovery
      return { active: r !== null, kind: r?.kind ?? null }
    },
    getActorHealth: (id) => ({
      health: getActorHealthRuntime(id),
      incapacitated: isIncapacitated(id),
    }),
    setActorHealth: (id, value) => setActorHealthRuntime(id, value, getCrimeGameTime()),
    getDamageEvents: () =>
      getDamageEvents().map((e) => ({
        id: e.id,
        sourceId: e.sourceId,
        targetId: e.targetId,
        targetKind: e.targetKind,
        amount: e.amount,
        kind: e.kind,
        incapacitated: e.incapacitated,
      })),
    forceCitizenPose: (citizenId, x, z, heading = 0) => {
      if (!AMBIENT_CITIZENS.some((c) => c.id === citizenId)) return false
      citizenPoseOverrides.set(citizenId, {
        pos: [x, z],
        heading,
        state: 'walking_sidewalk',
        crosswalkId: null,
        pending: true,
      })
      return true
    },
    setTrafficRoutingSeed: (seed) => {
      routeRuntime.seed = seed
      routeRuntime.fleetResetSeq += 1
    },
    // ---- Large City Foundation v1: sector streaming ----------------------
    getSectorRegistry: () =>
      SECTOR_DEFINITIONS.map((d) => ({
        id: d.id,
        name: d.name,
        kind: d.kind,
        districtIds: [...d.districtIds],
        bounds: { ...d.bounds },
      })),
    getSectorRuntimeStates: () =>
      [...streamingRuntime.states.values()].map((s) => ({
        id: s.id,
        lifecycle: s.lifecycle,
        requestedLifecycle: s.requestedLifecycle,
        simulationTier: s.simulationTier,
        generation: s.generation,
        visualsReady: s.visualsReady,
        collidersReady: s.collidersReady,
        loadDurationMs: s.loadDurationMs,
        error: s.error,
      })),
    getCurrentSectorId: () => {
      // The active avatar's sector: the car while driving (matches the
      // streaming director's anchor), the player on foot.
      const p =
        useGameStore.getState().mode === 'driving'
          ? registry.vehiclePosition
          : registry.playerPosition
      return worldToSectorId(p.x, p.z)
    },
    getSectorState: (id) => {
      const s = getSectorRuntimeState(id)
      return s
        ? {
            id: s.id,
            lifecycle: s.lifecycle,
            simulationTier: s.simulationTier,
            visualsReady: s.visualsReady,
            collidersReady: s.collidersReady,
          }
        : null
    },
    getSectorContentSummary: (id) => getSectorContentSummary(id),
    getSectorForRoadSegment: (segmentId) => getSectorForRoadSegment(segmentId) ?? null,
    getVehicleRouteSectorSequence: (vehicleId) => getVehicleRouteSectorSequence(vehicleId),
    getSimulationTier: (id) => getSectorRuntimeState(id)?.simulationTier ?? 'unloaded',
    forceLoadSector: (id) => {
      if (!getSectorDefinition(id)) return false
      streamingRuntime.forced.set(id, 'active')
      return true
    },
    forceUnloadSector: (id) => {
      if (!getSectorDefinition(id)) return false
      streamingRuntime.forced.set(id, 'unloaded')
      return true
    },
    clearForcedSectors: () => streamingRuntime.forced.clear(),
    setStreamingEnabled: (enabled) => {
      streamingRuntime.enabled = enabled
    },
    setStreamingRings: (activeRing, warmRing) => {
      streamingRuntime.activeRing = activeRing
      streamingRuntime.warmRing = warmRing
    },
    getStreamingMetrics: () => ({ ...streamingRuntime.metrics, queue: streamingRuntime.queue.length }),
    validateSectorOwnership: () => validateSectorOwnership(),
    getGlobalRoadGraphVersion: () => getRoadGraph().version,
    // ---- District Authoring Kit v1 ---------------------------------------
    getAuthoringTemplates: () => ({
      roads: ROAD_TEMPLATES.map((t) => t.id),
      buildings: BUILDING_TEMPLATES.map((t) => t.id),
      lots: LOT_TEMPLATES.map((t) => t.id),
      props: PROP_SCATTER_TEMPLATES.map((t) => t.id),
      citizens: CITIZEN_ZONE_TEMPLATES.map((t) => t.id),
    }),
    getCompiledSectorContent: (sectorId) => {
      const compiled = COMPILED_SECTORS.find((c) => c.sectorId === sectorId)
      if (!compiled) return null
      return {
        sectorId: compiled.sectorId,
        buildings: compiled.buildings.length,
        props: compiled.props.length,
        citizens: compiled.citizens.length,
        segments: compiled.segmentSpecs.length,
        destinations: compiled.destinations.length,
        walls: compiled.walls.length,
        lots: compiled.lots.map((l) => ({ id: l.id, bounds: { ...l.bounds } })),
      }
    },
    validateSectorAuthoring: (sectorId) => {
      const compiled = COMPILED_SECTORS.find((c) => c.sectorId === sectorId)
      return compiled ? validateCompiledSectorContent(compiled) : [`no compiled sector ${sectorId}`]
    },
    getAuthoringSourceRef: (contentId) => {
      for (const compiled of COMPILED_SECTORS) {
        const ref = compiled.sourceRefs.get(contentId)
        if (ref) return { ...ref }
      }
      return null
    },
    getAmbientCitizens: () =>
      [...ambientCitizenRuntime.values()].map((c) => ({
        id: c.id,
        district: c.district,
        state: c.state,
        position: [c.x, c.z] as [number, number],
      })),
    setWeather: (kind, options = {}) => {
      if (!isWeatherKind(kind)) return false
      useGameStore.getState().setWeather(kind, { instant: options.instant ?? true, intensity: options.intensity })
      return true
    },
    getWeatherState: () => {
      const stats = useGameStore.getState().stats
      const mods = getBlendedModifiers(weatherRuntime)
      return {
        kind: weatherRuntime.kind,
        targetKind: weatherRuntime.targetKind,
        transition: weatherRuntime.transition,
        intensity: weatherRuntime.intensity,
        wetness: weatherRuntime.wetness,
        manualOverride: weatherRuntime.manualOverride,
        scheduled: getScheduledWeather(stats.day, stats.hour, weatherRuntime.seed),
        modifiers: {
          trafficSpeedFactor: mods.trafficSpeedFactor,
          rainStrength: mods.rainStrength,
          fogDensity: mods.fogDensity,
        },
      }
    },
    setWetness: (wetness) => {
      weatherRuntime.wetness = Math.min(1, Math.max(0, wetness))
    },
    advanceWeather: (seconds) => {
      const stats = useGameStore.getState().stats
      // Step in small slices so transitions and wetness integrate normally.
      let remaining = seconds
      while (remaining > 0) {
        const dt = Math.min(0.5, remaining)
        stepWeather(weatherRuntime, dt, { day: stats.day, hour: stats.hour })
        remaining -= dt
      }
      const settled = weatherRuntime.kind === weatherRuntime.targetKind
      if (settled) useGameStore.setState({ weather: weatherRuntime.kind })
    },
    getVisibleCitizenCountByWeather: () =>
      [...ambientCitizenRuntime.values()].filter((c) => c.state !== 'hidden').length,
    enterApartment: () => useGameStore.getState().enterApartment(),
    exitApartment: () => useGameStore.getState().exitApartment(),
    getLocationMode: () => useGameStore.getState().location,
    getAppearance: () => ({ ...useGameStore.getState().appearance }),
    setAppearance: (appearance) => useGameStore.getState().setAppearance(appearance),
    getVisibilityState: () => ({
      enabled: visibilityRuntime.enabled,
      subjectId: visibilityRuntime.debug.subjectId,
      subjectKind: visibilityRuntime.debug.subjectKind,
      registeredCount: visibilityRuntime.debug.registeredCount,
      candidateCount: visibilityRuntime.debug.candidateCount,
      lastPrecise: visibilityRuntime.debug.lastPrecise,
      faded: visibilityRuntime.debug.fadedIds.map((id) => {
        const occ = visibilityRuntime.occluders.get(id)!
        return {
          id,
          opacity: occ.state.currentOpacity,
          targetOpacity: occ.state.targetOpacity,
          reason: occ.state.reason,
        }
      }),
    }),
    getRegisteredOccluders: () => [...visibilityRuntime.occluders.keys()],
    setOcclusionEnabled: (enabled) => {
      visibilityRuntime.enabled = enabled
      if (!enabled) clearAllFades()
    },
    forceVisibilityRecheck: () => clearAllFades(),
    getCharacterState: (id = 'player') => {
      const c = characterRuntime.instances.get(id)
      if (!c) return null
      return {
        id: c.id,
        activeVisual: c.activeVisual,
        renderMode: c.renderMode,
        animState: c.animState,
        previousAnimState: c.previousAnimState,
        playbackRate: c.playbackRate,
        speed: c.speed,
        resolvedSlots: [...c.resolvedSlots],
        fallbackReason: c.fallbackReason,
        modelLoaded: c.modelLoaded,
      }
    },
    setCharacterRenderMode: (mode) => useGameStore.getState().setCharacterRenderMode(mode),
    forceCharacterAnimation: (role) => {
      characterRuntime.forcedAnimation = role
    },
    getCharacterAssetInfo: () => {
      const def = CHARACTER_ASSETS[DEFAULT_CHARACTER_ASSET_ID]
      return {
        id: def.id,
        modelPath: def.modelPath,
        clips: Object.keys(def.clips),
        bounds: def.bounds,
      }
    },
    setTime: (hour) => useGameStore.getState().setHour(hour),
    setGameDay: (day) => useGameStore.setState((s) => ({ stats: { ...s.stats, day: Math.max(1, Math.trunc(day)) } })),
    setTimeScale: (scale) => useGameStore.getState().setTimeScale(scale),
    pauseWorld: (paused) => useGameStore.getState().setWorldPaused(paused),
    setQuestState: (questId, state) => useGameStore.getState().setQuestState(questId, state),
    giveItem: (itemId, quantity) => useGameStore.getState().giveItem(itemId, quantity),
    resetGame: () => {
      citizenPoseOverrides.clear()
      trafficRuntime.signal.pinned = null
      for (const id of tripRuntime.trips.keys()) resetSingleTrip(id)
      useGameStore.getState().resetGame()
    },
    saveGame: () => useGameStore.getState().saveNow(),
    loadGame: () => useGameStore.getState().loadNow(),
    interact: () => useGameStore.getState().interact(),
  }
  window.GAME_TEST_API = api
}
