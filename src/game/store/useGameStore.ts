import { create } from 'zustand'
import type { PlayerStats } from '../player/playerTypes'
import { INITIAL_STATS, PLAYER_MAX_HEALTH, PLAYER_SPAWN } from '../player/playerTypes'
import type { QuestState } from '../quests/questTypes'
import type { NPCMemory } from '../npc/npcTypes'
import { createEmptyNpcMemory } from '../npc/npcTypes'
import type { Inventory } from '../interactables/interactionHandlers'
import { getActionsFor, performAction } from '../interactables/interactionHandlers'
import type { ActivityAction } from '../interactables/interactableTypes'
import { tickNeeds } from '../simulation/needsSystem'
import { applyDialogueAction, getDialogue, type Dialogue } from '../npc/DialogueSystem'
import { NPC_BY_ID, NPC_DEFS } from '../../data/npcs'
import { COFFEE_QUEST_ID } from '../../data/quests'
import { INTERACTABLE_BY_ID } from '../../data/interactables'
import { registry, teleportPlayer } from '../world/runtimeRegistry'
import { findClearExitPosition } from '../world/collisionQuery'
import { findClearPlayerSpawn } from '../world/integrity/liveObstacles'
import { requestWeather, resetWeatherRuntime, weatherRuntime } from '../weather/weatherSystem'
import { isWeatherKind, type WeatherKind } from '../weather/weatherTypes'
import { getCrimeGameTime, resetCrimeSystems } from '../crime/crimeSystem'
import { emitCrime as emitCrimeEvent } from '../crime/crimeRuntime'
import { getWantedLevel } from '../crime/wantedRuntime'
import {
  getPlayerCarSourceId,
  getStealable,
  getVehicleCrimeState,
  PLAYER_CAR_ID,
  recordTheft,
} from '../vehicles/vehicleCrimeState'
import { ejectDriver } from '../vehicles/ejectedDriverRuntime'
import { fileReport } from '../crime/reportingSystem'
import { registerPlayerDamageSink } from '../combat/damageRuntime'
import { resetCombatSystems } from '../combat/combatSystem'
import { getWeaponSnapshot } from '../combat/weaponRuntime'
import {
  clearSave,
  createSnapshot,
  loadSave,
  persistSave,
} from '../save/saveGame'
import type { SaveData } from '../save/saveTypes'
import { audioManager } from '../audio/AudioManager'
import {
  DEFAULT_APPEARANCE,
  isPlayerAppearance,
  type PlayerAppearance,
  type PlayerLocationMode,
} from '../interiors/interiorTypes'
import { APARTMENT_STREET_EXIT } from '../interiors/apartmentLayout'
import {
  acceptMission as bridgeAccept,
  cancelActiveMission as bridgeCancel,
  discoverAndOfferMission,
  emitMissionEvent,
  notifyVehicleStolen,
  registerMissionBridge,
  retryLastMission as bridgeRetry,
} from '../missions/missionBridge'
import { missionRuntime, resetMissionRuntime } from '../missions/missionRuntime'
import { MISSION_DEFINITIONS, getMissionDefinition } from '../missions/missionDefinitions'
import { dismissMissionResult as engineDismissResult } from '../missions/missionEngine'
import { applyMissionSave, serializeMissions } from '../missions/missionPersistence'
import { applySocialSave, serializeSocial } from '../social/socialPersistence'
import { applyCareerSave, serializeCareers } from '../careers/careerPersistence'
import {
  resetCareers,
  applyToCareer as applyToCareerRt,
  quitJob as quitCareerJobRt,
  reconcileMissedShifts as reconcileMissedShiftsRt,
  getCareerState,
  getActiveJob as getActiveCareerJob,
  hasRecommendation as hasCareerRecommendation,
  getActiveShift as getActiveCareerShift,
  getShiftById as getCareerShiftById,
  startShift as startCareerShiftRt,
  advanceShift as advanceCareerShiftRt,
  finalizeActiveShift as finalizeCareerShiftRt,
  failActiveShift as failCareerShiftRt,
  cancelActiveShift as cancelCareerShiftRt,
  activeShiftReadyToFinalize as careerShiftReadyRt,
  completeShiftOptional as completeCareerBonusRt,
} from '../careers/careerRuntime'
import { getCareer } from '../careers/careerRegistry'
import { notifyHired as careerNotifyHired, notifyPromoted as careerNotifyPromoted, notifyShiftOutcome as careerNotifyShiftOutcome, reconcileEarnedRecommendations as careerReconcileRecs } from '../careers/careerSocial'
import { evaluateShiftStart, type ShiftConflictContext } from '../careers/careerScheduling'
import { currentStep } from '../careers/careerShifts'
import type { CareerId } from '../careers/careerTypes'
import type { EligibilityContext } from '../careers/careerApplications'
import {
  beginActivity,
  cancelActivity as cancelActivityRt,
  getActiveActivity,
  getDerivedRelationship,
  getInvitations,
  getRelationship,
  hasMet as socialHasMet,
  ingestSocialEvent,
  markContactRead as markContactReadRt,
  reconcileMissedInvitations,
  reconcileOutreach,
  resetSocial,
  respondToInvitation as respondToInvitationRt,
  sendPlayerInvite as sendPlayerInviteRt,
  socialRuntime,
  stepActivity,
} from '../social/socialRuntime'
import { activityFromInvitation, activityPrompt, favorActivity } from '../social/socialActivities'
import { invitationStartWindow } from '../social/socialScheduling'
import { noteArrestWitnessed, noteCrimeWitnessed, vendorDiscountPct } from '../social/socialConsequences'
import type { InvitationActivityKind } from '../social/socialTypes'
import { getSocialActor, isSocialActor } from '../social/socialActors'
import {
  availableSocialActions,
  giftableBackpackItems,
  resolveSocialAction,
  type SocialActionContext,
  type SocialActionId,
  type SocialActionOption,
} from '../social/socialInteraction'
import { socialActionResponse } from '../social/socialDialogue'
import { getInterior } from '../interiors/interiorRegistry'
import type { ActivityView } from '../criminalActivities/activityTypes'
import {
  activityRuntime,
  resetActivityRuntime,
  clearTransientActivity,
} from '../criminalActivities/activityRuntime'
import { resetInteriorCivilians } from '../interiors/interiorCivilians'
import {
  registerActivityBridge,
  tryLootRegister,
  trySecureProceeds,
  onPlayerIncident,
} from '../criminalActivities/activityBridge'
import { getRobberyForInterior, getRobberyDefinition } from '../criminalActivities/activityDefinitions'
import { breachCountdown } from '../criminalActivities/containmentLogic'
import { dismissRobberyResult } from '../criminalActivities/robberyEngine'
import {
  applyActivitySave,
  serializeActivities,
} from '../criminalActivities/activityPersistence'
import { distanceToRegister } from '../criminalActivities/robberyLogic'
// ---- Personal Economy, Inventory & Shopping v1 ----
import { getItemDefinition } from '../items/itemCatalog'
import {
  BACKPACK_CAPACITY,
  STORAGE_CAPACITY,
  addItem as addStack,
  hasItem,
  occupiedSlots,
  removeItem as removeStack,
  sanitizeStacks,
  transferItem,
} from '../items/inventoryService'
import { applyItemEffect } from '../items/itemEffects'
import { getStoreDefinition, getStoreForRegister } from '../commerce/storeDefinitions'
import { canPurchase } from '../commerce/commerceEngine'
import { buildShopView, type ShopView } from '../commerce/shopView'
import {
  applyDeliveryRestock,
  getStoreStock,
  nextPurchaseReceipt,
  reconcileStore,
  recordSale,
  resetCommerceRuntime,
} from '../commerce/commerceRuntime'
import { serializeCommerce, applyCommerceSave } from '../commerce/commercePersistence'
import { resetIntegrityRuntime } from '../world/integrity/integrityRuntime'
import { LOCKED_PALETTE_IDS } from '../interiors/interiorTypes'
import { getWeaponDef, setAmmo } from '../combat/weaponRuntime'

export type PanelKind = 'none' | 'dialogue' | 'activity' | 'phone' | 'wardrobe' | 'storage' | 'shop'
export type PlayMode = 'walking' | 'driving'

export type PhoneAppId =
  | 'home'
  | 'map'
  | 'quests'
  | 'missions'
  | 'messages'
  | 'contacts'
  | 'jobs'
  | 'bag'
  | 'settings'

export interface UIState {
  panel: PanelKind
  dialogueNpcId: string | null
  activityId: string | null
  /** Remembered across phone open/close. */
  activePhoneApp: PhoneAppId
}

/** Movement/driving input is swallowed while the phone covers the screen. */
export function isGameplayInputBlocked(panel: PanelKind): boolean {
  return panel === 'phone'
}

/**
 * UI-reactive projection of the mission runtime (Mission & Activity Framework
 * v1). The durable mission state lives in the module-singleton missionRuntime;
 * this mirror is refreshed at a bounded cadence by the mission driver and on
 * discrete transitions, and is the ONLY mission data the DOM UI reads.
 */
export interface MissionView {
  activeMissionId: string | null
  title: string | null
  category: 'lawful' | 'criminal' | null
  objectiveText: string | null
  objectiveIndex: number
  objectiveCount: number
  /** Planar distance (m) to the current objective marker, or null. */
  objectiveDistance: number | null
  result: { outcome: 'completed' | 'failed' | 'cancelled'; title: string; reason: string | null; seq: number } | null
  /** Bumped whenever availability/cooldown/history changes (phone list refresh). */
  listSeq: number
}

interface GameDataState {
  stats: PlayerStats
  inventory: Inventory
  questStates: Record<string, QuestState>
  npcMemory: Record<string, NPCMemory>
  mode: PlayMode
  activeInteractableId: string | null
  /** Discrete weather kind for UI/save; live blend/wetness lives in weatherRuntime. */
  weather: WeatherKind
  /** City streets or inside the apartment interior. */
  location: PlayerLocationMode
  /** Cosmetic outfit colors, persisted with the save. */
  appearance: PlayerAppearance
  /** Character visual mode: 'auto' prefers the rigged model. Debug/test. */
  characterRenderMode: 'auto' | 'model' | 'primitive'
  ui: UIState
  worldPaused: boolean
  timeScale: number
  audioEnabled: boolean
  debugOpen: boolean
  toast: { text: string; seq: number } | null
  /** Bumps on every social-state mutation so social-reading UI re-renders
   *  (the social runtime lives outside zustand; §13 two-tier state). */
  socialVersion: number
  /** Bumps on every career-state mutation so career-reading UI (Phone Jobs, HUD)
   *  re-renders — the career runtime also lives outside zustand (issue #15). */
  careerVersion: number
  saveStatus: string | null
  /** Player health 0–100 (HUD-reactive). Persists across save/load. */
  playerHealth: number
  /** True while incapacitated (health hit 0), until the recovery flow runs. */
  playerIncapacitated: boolean
  /** Active BUSTED/WASTED recovery overlay, or null. */
  recovery: { kind: 'arrest' | 'incapacitation'; message: string; seq: number } | null
  /** UI mirror of the mission runtime (Mission & Activity Framework v1). */
  missionView: MissionView
  /** Which interior the player is inside (store/apartment id), or null in city. */
  currentInteriorId: string | null
  /** UI mirror of the criminal-activity runtime (Store Robbery v1). */
  activityView: ActivityView
  // ---- Personal Economy, Inventory & Shopping v1 ----
  /** Apartment storage container (a second backpack; item id → quantity). */
  storage: Inventory
  /** Unlocked wardrobe palette ids (premium colours bought/used). */
  wardrobeUnlocks: string[]
  /** UI mirror of the open store shopfront (built on open/buy, never per frame). */
  shopView: ShopView | null
}

export interface GameStore extends GameDataState {
  tick: (dtHours: number) => void
  setHour: (hour: number) => void
  setTimeScale: (scale: number) => void
  setWorldPaused: (paused: boolean) => void
  setActiveInteractable: (id: string | null) => void
  interact: () => void
  openDialogue: (npcId: string) => void
  openActivity: (interactableId: string) => void
  closePanel: () => void
  togglePhone: () => void
  setPhoneApp: (app: PhoneAppId) => void
  toggleDebug: () => void
  toggleAudio: () => void
  performActivityAction: (actionId: string) => void
  performDialogueAction: (npcId: string, actionId: string) => void
  /** Contextual social actions offered for a named social actor (Slice 2). */
  getSocialMenu: (npcId: string) => { actions: SocialActionOption[]; giftableItemIds: string[] } | null
  performSocialAction: (npcId: string, actionId: SocialActionId, opts?: { itemId?: string }) => void
  /** Phone: answer an open invitation / send one / mark a thread read (Slice 3). */
  respondToInvitation: (invitationId: string, status: 'accepted' | 'declined' | 'suggested_later') => void
  sendPlayerInvite: (npcId: string, activityKind?: InvitationActivityKind) => void
  markContactRead: (npcId: string) => void
  /** Social activities (Slice 4): start from an accepted invite / a favor, advance, cancel. */
  startSocialActivity: (invitationId: string) => void
  startFavorFor: (npcId: string) => void
  advanceSocialActivity: () => void
  cancelSocialActivity: () => void
  /** Careers (issue #15): apply for a career / leave the active primary job. */
  applyToCareer: (careerId: CareerId) => void
  quitCareerJob: () => void
  /** Careers: start / advance / cancel / finalize a scheduled shift (world flow, Slice 3). */
  startCareerShift: (shiftId: string) => void
  advanceCareerShift: () => void
  cancelCareerShift: () => void
  finalizeCareerShift: () => void
  completeCareerShiftBonus: () => void
  enterVehicle: () => void
  exitVehicle: () => void
  /** Set player health directly (clamped); toggles incapacitation. */
  setPlayerHealth: (value: number) => void
  /** Apply damage to the player; returns the resulting health + incap state. */
  applyPlayerDamage: (amount: number, gameTime: number) => { health: number; incapacitated: boolean }
  /** Resolve an arrest or incapacitation: penalty, reset, respawn safe. */
  respawnAfterIncident: (kind: 'arrest' | 'incapacitation') => void
  /** Dismiss the BUSTED/WASTED overlay. */
  dismissRecovery: () => void
  /** Steal a parked/occupied vehicle: relocate the drivable car, emit the
   *  theft crime, enter driving. Returns false if the target is unknown. */
  stealVehicle: (vehicleId: string) => boolean
  /** Step through the apartment door (on foot only). */
  enterApartment: () => void
  /** Leave the apartment; the player reappears by the street entrance. */
  exitApartment: () => void
  /** Update outfit colors (partial merge over the current appearance). */
  setAppearance: (appearance: Partial<PlayerAppearance>) => void
  setCharacterRenderMode: (mode: 'auto' | 'model' | 'primitive') => void
  requestTeleport: (position: [number, number, number]) => void
  setQuestState: (questId: string, state: QuestState) => void
  giveItem: (itemId: string, quantity: number) => void
  // ---- Personal Economy, Inventory & Shopping v1 ----
  /** Open a store's shop UI (reconciles stock; refuses a robbed/recovering store). */
  openShop: (storeId: string) => void
  /** Buy one unit of an item from a store (atomic charge + stock + grant). */
  buyItem: (storeId: string, itemId: string) => void
  /** Use/consume one of a backpack item (applies its typed effect if valid). */
  useItem: (itemId: string) => void
  /** Discard `quantity` (default 1) of a discardable backpack item. */
  discardItem: (itemId: string, quantity?: number) => void
  /** Move backpack → apartment storage (default 1; `all` moves the whole stack). */
  depositItem: (itemId: string, quantity?: number | 'all') => void
  /** Move apartment storage → backpack (default 1; `all` moves the whole stack). */
  withdrawItem: (itemId: string, quantity?: number | 'all') => void
  /** True when a wardrobe palette id is available (free or unlocked). */
  isPaletteUnlocked: (paletteId: string) => boolean
  /** Shelf Run: pick up the restock crate at the depot (idempotent). */
  collectShelfCrate: () => void
  /** Shelf Run: deliver the crate to a store — restocks it + emits the event. */
  deliverShelfCrate: (storeId: string) => void
  /** Change the weather (smooth fade by default; instant for tests/loads). */
  setWeather: (kind: WeatherKind, options?: { instant?: boolean; intensity?: number }) => void
  showToast: (text: string) => void
  getCurrentDialogue: () => Dialogue | null
  getCurrentActions: () => ActivityAction[]
  saveNow: () => Promise<boolean>
  loadNow: () => Promise<boolean>
  resetSave: () => Promise<void>
  resetGame: () => void
  applySnapshot: (snapshot: SaveData) => void
  // ---- Missions (Mission & Activity Framework v1) ----
  /** Accept a mission by id (from the phone or a giver). */
  acceptMissionById: (missionId: string) => void
  /** Cancel the active mission (no reward; safe cleanup). */
  cancelActiveMission: () => void
  /** Retry the last-resolved mission as a fresh attempt. */
  retryLastMission: () => void
  /** Dismiss the mission result banner. */
  dismissMissionResult: () => void
  /** Re-project the mission runtime into `missionView` (called by the driver). */
  syncMissionUI: (distance?: number | null) => void
  // ---- Criminal activities (Store Robbery v1) ----
  /** Enter a registered interior (apartment or store) by id. */
  enterInterior: (interiorId: string) => void
  /** Leave the current interior back to its street exit. */
  exitInterior: () => void
  /** Empty a store register during an active robbery (register interaction). */
  lootStoreRegister: () => void
  /** Convert unsecured proceeds to money at the fixer (wanted 0, out of combat). */
  secureRobberyProceeds: () => void
  /** Dismiss the robbery result banner. */
  dismissRobberyResult: () => void
  /** Re-project the activity runtime into `activityView` (driver, ~4 Hz). */
  syncActivityUI: (threatProgress: number) => void
}

function createInitialNpcMemory(): Record<string, NPCMemory> {
  return Object.fromEntries(NPC_DEFS.map((n) => [n.id, createEmptyNpcMemory()]))
}

export function createInitialGameState(): GameDataState {
  return {
    stats: { ...INITIAL_STATS },
    inventory: {},
    questStates: { [COFFEE_QUEST_ID]: 'not_started' },
    npcMemory: createInitialNpcMemory(),
    mode: 'walking',
    activeInteractableId: null,
    weather: 'clear',
    location: 'city',
    appearance: { ...DEFAULT_APPEARANCE },
    characterRenderMode: 'auto',
    ui: { panel: 'none', dialogueNpcId: null, activityId: null, activePhoneApp: 'home' },
    worldPaused: false,
    timeScale: 1,
    audioEnabled: false,
    debugOpen: false,
    toast: null,
    socialVersion: 0,
    careerVersion: 0,
    saveStatus: null,
    playerHealth: PLAYER_MAX_HEALTH,
    playerIncapacitated: false,
    recovery: null,
    missionView: {
      activeMissionId: null,
      title: null,
      category: null,
      objectiveText: null,
      objectiveIndex: 0,
      objectiveCount: 0,
      objectiveDistance: null,
      result: null,
      listSeq: 0,
    },
    currentInteriorId: null,
    activityView: {
      storeId: null,
      storeTitle: null,
      phase: 'idle',
      cashierPhase: 'calm',
      threatProgress: 0,
      canLoot: false,
      alarmArmed: false,
      unsecuredProceeds: 0,
      canSecure: false,
      containmentPhase: 'none',
      breachSeconds: null,
      result: null,
    },
    // Personal Economy, Inventory & Shopping v1.
    storage: {},
    wardrobeUnlocks: [],
    shopView: null,
  }
}

let toastSeq = 0
let recoverySeq = 0

// ---- Personal Economy, Inventory & Shopping v1 helpers --------------------

/** In-game hours (day*24 + hour) — the clock stock restock reconciles against. */
function gameHoursOf(s: { stats: PlayerStats }): number {
  return s.stats.day * 24 + s.stats.hour
}

/**
 * A store refuses normal commerce while it is being robbed OR still within its
 * post-robbery recovery cooldown (keyed by the robbery ACTIVITY id, which the
 * commerce store references). Legitimate stock + robbery recovery stay separate
 * concepts but integrate through this one gate.
 */
function storeClosedForCommerce(activityId: string, gameHours: number): boolean {
  if (activityRuntime.active?.activityId === activityId) return true
  const robbery = activityRuntime.stores[activityId]
  return robbery ? robbery.cooldownReadyAtGameHours > gameHours : false
}

/** Build the bounded shop projection for a store from the current state. */
function projectShop(storeId: string, s: GameStore): ShopView | null {
  const def = getStoreDefinition(storeId)
  if (!def) return null
  return buildShopView(
    def,
    getStoreStock(storeId),
    s.stats.money,
    s.inventory,
    BACKPACK_CAPACITY,
    storeClosedForCommerce(def.activityId, gameHoursOf(s)),
  )
}

/** Human message for a refused purchase. */
function purchaseFailureMessage(reason: string | undefined): string {
  switch (reason) {
    case 'store_closed':
      return 'The store is closed right now.'
    case 'out_of_stock':
      return 'Out of stock.'
    case 'insufficient_funds':
      return "You can't afford that."
    case 'backpack_full':
      return 'Your bag is full.'
    case 'not_sold_here':
      return "They don't sell that here."
    default:
      return "Can't buy that right now."
  }
}

/**
 * Route an interaction with a mission giver/objective point. If the active
 * mission's current objective targets this interactable (pickup, handoff,
 * return) it completes it; a fresh `mission_offer` (a fixer) with no active
 * mission discovers + accepts its mission; otherwise a friendly toast.
 */
function handleMissionInteract(
  id: string,
  kind: 'mission_offer' | 'mission_objective',
  get: () => GameStore,
): void {
  const active = missionRuntime.active
  const activeDef = active ? getMissionDefinition(active.missionId) : undefined
  const curObj = active && activeDef ? activeDef.objectives[active.objectiveIndex] : undefined
  const targetsThis =
    curObj !== undefined &&
    ((curObj.kind === 'interact' && curObj.interactableId === id) ||
      (curObj.kind === 'deliver_vehicle' && curObj.interactableId === id) ||
      (curObj.kind === 'return_to_giver' && curObj.interactableId === id))
  if (targetsThis) {
    emitMissionEvent({ type: 'interactable_used', interactableId: id })
    return
  }
  if (kind === 'mission_offer' && !active) {
    // Meeting the fixer also unlocks his phone-board jobs (e.g. Corner Take).
    if (id === 'hotcargo_fixer') {
      for (const m of MISSION_DEFINITIONS) {
        if (m.offerSource.kind === 'phone_job' && m.category === 'criminal') {
          discoverAndOfferMission(m.id)
        }
      }
    }
    const offered = MISSION_DEFINITIONS.find(
      (m) => m.offerSource.kind === 'interactable' && m.offerSource.interactableId === id,
    )
    if (offered) {
      discoverAndOfferMission(offered.id)
      get().acceptMissionById(offered.id)
      return
    }
  }
  get().showToast(active ? 'Nothing to do here right now.' : 'Come back when you have a job.')
}

/** Gather the read-only context the pure social resolver needs (Slice 2). Reads
 *  the social runtime + weapon pose; never mutates. */
function buildSocialActionContext(
  inventory: Record<string, number>,
  day: number,
  hour: number,
  npcId: string,
): SocialActionContext {
  return {
    rel: getRelationship(npcId),
    derived: getDerivedRelationship(npcId),
    hasMet: socialHasMet(npcId),
    gameDay: Math.trunc(day),
    gameHour: hour,
    giftableItemIds: giftableBackpackItems(inventory),
    armed: getWeaponSnapshot().pose !== 'holstered',
    appliedEventIds: socialRuntime.state.appliedEventIds,
  }
}

export const useGameStore = create<GameStore>()((set, get) => ({
  ...createInitialGameState(),

  tick: (dtHours) => {
    const s = get()
    if (s.worldPaused) return
    const flags = {
      running: registry.flags.running,
      driving: s.mode === 'driving' && Math.abs(registry.flags.drivingSpeed) > 0.5,
    }
    set({ stats: tickNeeds(s.stats, dtHours, flags) })
  },

  setHour: (hour) => {
    const h = ((hour % 24) + 24) % 24
    set((s) => ({ stats: { ...s.stats, hour: h } }))
  },

  setTimeScale: (scale) => set({ timeScale: Math.max(0, scale) }),
  setWorldPaused: (paused) => {
    if (paused) registry.pauseSeq++
    set({ worldPaused: paused })
  },
  setActiveInteractable: (id) => set({ activeInteractableId: id }),

  interact: () => {
    const s = get()
    if (s.ui.panel !== 'none') return
    if (s.mode === 'driving') {
      get().exitVehicle()
      return
    }
    const id = s.activeInteractableId
    if (!id) return
    const def = INTERACTABLE_BY_ID[id]
    if (!def) return
    audioManager.playClick()
    if (def.kind === 'npc') {
      get().openDialogue(id)
    } else if (def.kind === 'vehicle') {
      get().enterVehicle()
    } else if (def.kind === 'steal_vehicle') {
      get().stealVehicle(id)
    } else if (def.kind === 'apartment') {
      get().enterApartment()
    } else if (def.kind === 'apartment_exit') {
      get().exitApartment()
    } else if (def.kind === 'store_entrance') {
      get().enterInterior(def.interiorId ?? '')
    } else if (def.kind === 'store_exit') {
      get().exitInterior()
    } else if (def.kind === 'store_register') {
      // Priority: an in-progress heist loots the register; a Shelf Run delivery
      // drops the crate here; otherwise it's a legitimate shop counter.
      const store = getStoreForRegister(id)
      const sm = missionRuntime.active
      const shelfDeliverHere =
        store !== undefined &&
        sm?.missionId === 'shelf_run' &&
        getMissionDefinition('shelf_run')?.objectives[sm.objectiveIndex]?.kind === 'deliver_restock' &&
        hasItem(get().inventory, 'restock_crate')
      if (activityRuntime.active) get().lootStoreRegister()
      else if (shelfDeliverHere && store) get().deliverShelfCrate(store.id)
      else if (store) get().openShop(store.id)
      else get().lootStoreRegister()
    } else if (def.kind === 'wardrobe') {
      set((s) => ({ ui: { ...s.ui, panel: 'wardrobe', dialogueNpcId: null, activityId: null } }))
    } else if (def.kind === 'storage') {
      set((s) => ({ ui: { ...s.ui, panel: 'storage', dialogueNpcId: null, activityId: null } }))
    } else if (def.kind === 'mission_offer' || def.kind === 'mission_objective') {
      // The fixer doubles as the criminal-proceeds secure point: converting
      // unsecured cash here also feeds any observing mission (Corner Take).
      if (activityRuntime.unsecuredProceeds > 0) get().secureRobberyProceeds()
      // The supply depot grants the Shelf Run crate through the normal item path
      // (idempotent) before the interact objective completes.
      if (id === 'shelf_depot') get().collectShelfCrate()
      handleMissionInteract(id, def.kind, get)
    } else {
      get().openActivity(id)
      // Feed the interaction to the active mission (a no-op unless a mission's
      // current objective targets this interactable).
      emitMissionEvent({ type: 'interactable_used', interactableId: id })
    }
  },

  openDialogue: (npcId) => {
    const s = get()
    // Meeting a named social actor for the first time seeds social state and may
    // unlock them as a phone contact — the "first unlock" consequence (§2/§4).
    if (isSocialActor(npcId) && !socialHasMet(npcId)) {
      const met = ingestSocialEvent({
        id: `social:met:${npcId}`,
        kind: 'met',
        actorId: npcId,
        gameDay: Math.trunc(s.stats.day),
        gameHour: s.stats.hour,
      })
      if (met.contactUnlocked) {
        get().showToast(`${getSocialActor(npcId)?.displayName ?? 'New contact'} added to your phone contacts`)
      }
      set((st) => ({ socialVersion: st.socialVersion + 1 }))
    }
    set((st) => ({ ui: { ...st.ui, panel: 'dialogue', dialogueNpcId: npcId, activityId: null } }))
  },

  openActivity: (interactableId) =>
    set((s) => ({
      ui: { ...s.ui, panel: 'activity', dialogueNpcId: null, activityId: interactableId },
    })),

  closePanel: () =>
    set((s) => ({ ui: { ...s.ui, panel: 'none', dialogueNpcId: null, activityId: null } })),

  togglePhone: () => {
    const s = get()
    // No checking your phone (map / fast-travel) mid-pursuit.
    if (s.ui.panel !== 'phone' && getWantedLevel() > 0) {
      get().showToast("Not while the police are after you!")
      return
    }
    audioManager.playClick()
    // Opening the phone lazily reconciles NPC follow-ups + times out ignored
    // accepted plans into no-shows (never per-frame — §14; PR#14 blocker 3).
    if (s.ui.panel !== 'phone') {
      reconcileOutreach(s.stats.day, s.stats.hour)
      reconcileMissedInvitations(s.stats.day, s.stats.hour)
      for (const missed of reconcileMissedShiftsRt(s.stats.day, s.stats.hour)) {
        careerNotifyShiftOutcome(missed.careerId, 'missed', 0, missed.id, s.stats.day, s.stats.hour)
      }
      careerReconcileRecs(s.stats.day, s.stats.hour) // warm employers put in a good word (§10)
      set((st) => ({ socialVersion: st.socialVersion + 1, careerVersion: st.careerVersion + 1 }))
    }
    set({
      ui: {
        ...s.ui,
        panel: s.ui.panel === 'phone' ? 'none' : 'phone',
        dialogueNpcId: null,
        activityId: null,
      },
    })
  },

  setPhoneApp: (app) => set((s) => ({ ui: { ...s.ui, activePhoneApp: app } })),

  toggleDebug: () => set((s) => ({ debugOpen: !s.debugOpen })),

  toggleAudio: () => {
    const enabled = !get().audioEnabled
    if (enabled) audioManager.enable()
    else audioManager.disable()
    set({ audioEnabled: enabled })
  },

  performActivityAction: (actionId) => {
    const s = get()
    // Loyalty discount at Maya's food truck (buy_coffee/buy_meal are hers alone):
    // a friendly Maya charges you less (§ economy consequence).
    const outcome = performAction(
      { stats: s.stats, inventory: s.inventory, questStates: s.questStates },
      actionId,
      vendorDiscountPct('npc_maya_01'),
    )
    // One capacity authority: if an action would grow the backpack past its slot
    // budget (e.g. buying coffee with a full bag), refuse rather than overflow.
    if (outcome.ok && occupiedSlots(outcome.state.inventory) > BACKPACK_CAPACITY) {
      get().showToast('Your bag is full.')
      return
    }
    audioManager.playClick()
    set({
      stats: outcome.state.stats,
      inventory: outcome.state.inventory,
      questStates: outcome.state.questStates,
    })
    get().showToast(outcome.message)
    // Sleeping advances the day — reconcile any accepted plan whose window lapsed
    // overnight into a no-show (PR#14 blocker 3), then close the panel.
    if (outcome.ok && actionId === 'sleep') {
      reconcileMissedInvitations(outcome.state.stats.day, outcome.state.stats.hour)
      for (const missed of reconcileMissedShiftsRt(outcome.state.stats.day, outcome.state.stats.hour)) {
        careerNotifyShiftOutcome(missed.careerId, 'missed', 0, missed.id, outcome.state.stats.day, outcome.state.stats.hour)
      }
      set((st) => ({ socialVersion: st.socialVersion + 1, careerVersion: st.careerVersion + 1 }))
      get().closePanel()
    }
  },

  performDialogueAction: (npcId, actionId) => {
    const s = get()
    const outcome = applyDialogueAction(
      {
        stats: s.stats,
        inventory: s.inventory,
        questStates: s.questStates,
        npcMemory: s.npcMemory,
      },
      npcId,
      actionId,
      s.stats.day,
    )
    audioManager.playClick()
    set({
      stats: outcome.state.stats,
      inventory: outcome.state.inventory,
      questStates: outcome.state.questStates,
      npcMemory: outcome.state.npcMemory,
    })
    if (outcome.message) get().showToast(outcome.message)
    // Coffee for Ravi (legacy quest) feeds the social system: a successful
    // hand-off is remembered as a gift Ravi loved (§ Coffee-for-Ravi compat).
    if (actionId === 'deliver_coffee' && outcome.close && npcId === 'npc_ravi_01') {
      ingestSocialEvent({ id: 'coffee_for_ravi:complete', kind: 'gift_liked', actorId: 'npc_ravi_01', gameDay: s.stats.day, gameHour: s.stats.hour })
      set((st) => ({ socialVersion: st.socialVersion + 1 }))
    }
    if (outcome.close) get().closePanel()
  },

  getSocialMenu: (npcId) => {
    if (!isSocialActor(npcId)) return null
    const actor = getSocialActor(npcId)
    if (!actor) return null
    const s = get()
    const ctx = buildSocialActionContext(s.inventory, s.stats.day, s.stats.hour, npcId)
    return { actions: availableSocialActions(actor, ctx), giftableItemIds: ctx.giftableItemIds }
  },

  performSocialAction: (npcId, actionId, opts = {}) => {
    const s = get()
    const actor = getSocialActor(npcId)
    if (!actor) return
    const ctx = buildSocialActionContext(s.inventory, s.stats.day, s.stats.hour, npcId)
    const res = resolveSocialAction(actor, actionId, ctx, opts)
    audioManager.playClick()

    // Gift: consume the real catalog item atomically BEFORE applying the effect,
    // so a gift is never free and a failed removal never half-applies (§ gifts).
    if (res.ok && res.consumeItemId) {
      const removal = removeStack(s.inventory, res.consumeItemId, 1)
      if (!removal.ok) {
        get().showToast('You no longer have that to give.')
        return
      }
      set({ inventory: removal.stacks })
    }

    let unlocked = false
    if (res.event) unlocked = ingestSocialEvent(res.event).contactUnlocked

    const line = socialActionResponse(actor, res.responseToken, ctx.gameDay)
    get().showToast(unlocked ? `${line} — ${actor.displayName} added to Contacts` : line)
    set((st) => ({ socialVersion: st.socialVersion + 1 }))
  },

  respondToInvitation: (invitationId, status) => {
    const s = get()
    const ok = respondToInvitationRt(invitationId, status, s.stats.day, s.stats.hour)
    if (!ok) return
    audioManager.playClick()
    set((st) => ({ socialVersion: st.socialVersion + 1 }))
    get().showToast(
      status === 'accepted' ? 'Plans set! 🎉' : status === 'declined' ? 'Maybe another time.' : 'Suggested a later time.',
    )
  },

  sendPlayerInvite: (npcId, activityKind) => {
    const s = get()
    const res = sendPlayerInviteRt(npcId, s.stats.day, s.stats.hour, {
      activityKind,
      missionBusy: missionRuntime.active !== null,
    })
    audioManager.playClick()
    set((st) => ({ socialVersion: st.socialVersion + 1 }))
    get().showToast(res.ok ? 'Invitation sent!' : res.reason ?? 'Can’t invite right now')
  },

  markContactRead: (npcId) => {
    markContactReadRt(npcId)
    set((st) => ({ socialVersion: st.socialVersion + 1 }))
  },

  startSocialActivity: (invitationId) => {
    const s = get()
    if (getActiveActivity()) {
      get().showToast('Wrap up your current plans first.')
      return
    }
    const inv = getInvitations().find((i) => i.id === invitationId && i.status === 'accepted')
    if (!inv) {
      get().showToast('No confirmed plans to start.')
      return
    }
    // Scheduling gate (PR#14 review): a confirmed plan can only be started inside its
    // window (from 1h before the proposed slot through the 3h no-show grace). Revalidate
    // HERE (the production entry point), not just in the disabled Start button, so a
    // future appointment can't be completed days early or the no-show model bypassed.
    const win = invitationStartWindow(inv, s.stats.day, s.stats.hour)
    if (!win.startable) {
      get().showToast(win.reason ?? 'You can’t start that plan yet.')
      return
    }
    const act = activityFromInvitation(inv.id, inv.actorId, inv.activityKind, s.stats.day)
    beginActivity(act)
    audioManager.playClick()
    set((st) => ({ socialVersion: st.socialVersion + 1 }))
    get().showToast(activityPrompt(act, getSocialActor(inv.actorId)?.displayName ?? 'them'))
  },

  startFavorFor: (npcId) => {
    const s = get()
    const actor = getSocialActor(npcId)
    if (!actor) return
    if (getActiveActivity()) {
      get().showToast('Wrap up your current plans first.')
      return
    }
    const tier = getDerivedRelationship(npcId).tier
    if (tier === 'stranger' || tier === 'acquaintance') {
      get().showToast(`${actor.displayName} wouldn’t ask you a favor yet.`)
      return
    }
    // Deterministic errand cargo: a giftable item the NPC likes (else a snack).
    const itemId =
      actor.giftLikes.find((id) => {
        const def = getItemDefinition(id)
        return def && def.discardable && !def.questReserved
      }) ?? 'snack'
    const act = favorActivity(npcId, itemId, { id: 'apartment', label: `${actor.displayName}'s place` }, s.stats.day, s.stats.hour)
    beginActivity(act)
    audioManager.playClick()
    set((st) => ({ socialVersion: st.socialVersion + 1 }))
    get().showToast(`Favor for ${actor.displayName}: bring a ${getItemDefinition(itemId)?.name ?? itemId} to ${act.venueLabel}`)
  },

  advanceSocialActivity: () => {
    const s = get()
    const act = getActiveActivity()
    if (!act) return
    // Destination integration (PR#14 blocker 4): you can't "arrive" until you're
    // actually AT the venue — reuse the existing proximity scanner's activeInteractableId.
    if (act.step === 'travel' && s.activeInteractableId !== act.venueId) {
      get().showToast(`Head to ${act.venueLabel} to meet ${getSocialActor(act.actorId)?.displayName ?? 'them'}.`)
      return
    }
    // A favor's delivery step hands over a REAL item — consume it atomically first.
    if (act.step === 'deliver' && act.requiredItemId) {
      const removal = removeStack(s.inventory, act.requiredItemId, 1)
      if (!removal.ok) {
        get().showToast(`You need a ${getItemDefinition(act.requiredItemId)?.name ?? 'item'} to hand over.`)
        return
      }
      set({ inventory: removal.stacks })
    }
    const result = stepActivity(s.stats.day, s.stats.hour)
    audioManager.playClick()
    set((st) => ({ socialVersion: st.socialVersion + 1 }))
    const actor = getSocialActor(act.actorId)
    if (result === null) {
      get().showToast(
        act.template === 'favor'
          ? `Favor done for ${actor?.displayName ?? 'them'} — they won’t forget it.`
          : `Great ${act.activityKind} with ${actor?.displayName ?? 'them'}!`,
      )
    } else {
      get().showToast(activityPrompt(result, actor?.displayName ?? 'them'))
    }
  },

  cancelSocialActivity: () => {
    const s = get()
    if (!getActiveActivity()) return
    cancelActivityRt(s.stats.day, s.stats.hour)
    audioManager.playClick()
    set((st) => ({ socialVersion: st.socialVersion + 1 }))
    get().showToast('You bailed on your plans.')
  },

  applyToCareer: (careerId) => {
    const s = get()
    const career = getCareer(careerId)
    if (!career) return
    const ctx: EligibilityContext = {
      skills: getCareerState().skills,
      reputation: s.stats.reputation,
      wanted: getWantedLevel(),
      activeJob: getActiveCareerJob(),
      hasRecommendation: (id) => hasCareerRecommendation(id),
    }
    const out = applyToCareerRt(careerId, ctx, s.stats.day, s.stats.hour)
    audioManager.playClick()
    if (!out.result.ok) {
      get().showToast(out.result.reason ?? 'Application refused.')
      return
    }
    careerNotifyHired(careerId, s.stats.day, s.stats.hour) // employer welcome message (§10)
    set((st) => ({ careerVersion: st.careerVersion + 1, socialVersion: st.socialVersion + 1 }))
    get().showToast(`Hired at ${career.employerDisplayName} — first shift scheduled.`)
  },

  quitCareerJob: () => {
    if (!getActiveCareerJob()) return
    quitCareerJobRt()
    audioManager.playClick()
    set((st) => ({ careerVersion: st.careerVersion + 1 }))
    get().showToast('You left the job.')
  },

  startCareerShift: (shiftId) => {
    const s = get()
    const shift = getCareerShiftById(shiftId)
    const career = shift ? getCareer(shift.careerId) : undefined
    if (!shift || !career) return
    const ctx: ShiftConflictContext = {
      wanted: getWantedLevel(),
      incapacitated: s.playerIncapacitated,
      hasActiveShift: getActiveCareerShift() !== null,
      missionBusy: missionRuntime.active !== null,
      socialActivityActive: getActiveActivity() !== null,
      atInteractableId: s.activeInteractableId,
    }
    const gate = evaluateShiftStart(career, shift, ctx, s.stats.day, s.stats.hour)
    if (!gate.canStart) {
      get().showToast(gate.reason ?? 'You can’t clock in yet.')
      return
    }
    const startAbs = shift.scheduledDay * 24 + shift.startHour
    const nowAbs = s.stats.day * 24 + s.stats.hour
    const onTime = nowAbs <= startAbs + 1 // clocked in within the first hour
    if (!startCareerShiftRt(shift.id, onTime, s.stats.hour)) return
    audioManager.playClick()
    set((st) => ({ careerVersion: st.careerVersion + 1 }))
    get().showToast(`Clocked in — ${career.displayName}${onTime ? '' : ' (late)'}`)
  },

  advanceCareerShift: () => {
    const s = get()
    const shift = getActiveCareerShift()
    if (!shift || !shift.objectives) return
    const step = currentStep(shift.objectives)
    if (!step) {
      get().finalizeCareerShift()
      return
    }
    // Each step gates on being AT its anchor (a real destination) or, for anchorless
    // workplace tasks, at the workplace — reusing the live proximity scanner.
    const target = step.anchorId ?? shift.workplaceInteractableId
    if (s.activeInteractableId !== target) {
      get().showToast(`Head to your next stop: ${step.description}`)
      return
    }
    let mistake = false
    // Cargo flows through the real inventory authority: load at the depot, return it.
    if (step.kind === 'collect' && step.itemId) {
      if (occupiedSlots(s.inventory) < BACKPACK_CAPACITY) get().giveItem(step.itemId, step.quantity ?? 1)
      else mistake = true // no room for the cargo
    }
    if (step.kind === 'wrap') {
      const removal = removeStack(s.inventory, 'restock_crate', 1)
      if (removal.ok) set({ inventory: removal.stacks })
    }
    advanceCareerShiftRt(mistake)
    audioManager.playClick()
    set((st) => ({ careerVersion: st.careerVersion + 1 }))
    if (careerShiftReadyRt()) get().finalizeCareerShift()
    else get().showToast(`Done: ${step.description}`)
  },

  cancelCareerShift: () => {
    if (!getActiveCareerShift()) return
    cancelCareerShiftRt()
    audioManager.playClick()
    set((st) => ({ careerVersion: st.careerVersion + 1 }))
    get().showToast('You walked off the shift.')
  },

  finalizeCareerShift: () => {
    const s = get()
    const shiftId = getActiveCareerShift()?.id ?? ''
    const out = finalizeCareerShiftRt(s.stats.day, s.stats.hour)
    if (!out) return
    // Pay flows through the money authority atomically (exact-once is enforced in the
    // runtime via the shift attemptKey — a repeat finalize reports total 0).
    if (out.pay.total > 0) set((st) => ({ stats: { ...st.stats, money: st.stats.money + out.pay.total } }))
    // Employer follow-up (praise + memory on a strong shift) + promotion message (§10).
    if (!out.alreadyFinalized) careerNotifyShiftOutcome(out.careerId, 'completed', out.performance.score, shiftId, s.stats.day, s.stats.hour)
    set((st) => ({ careerVersion: st.careerVersion + 1, socialVersion: st.socialVersion + 1 }))
    get().showToast(`Shift complete — ${out.performance.score}/100 · +$${out.pay.total}`)
    // A completed shift can earn a promotion — a rank up, higher pay, and a visible unlock.
    if (out.promotedTo) {
      careerNotifyPromoted(out.careerId, out.promotedTo.id, s.stats.day, s.stats.hour)
      const unlock = out.unlocks?.[0]
      get().showToast(`Promoted to ${out.promotedTo.displayName}!${unlock ? ` Unlocked: ${unlock.label}` : ''}`)
    }
  },

  completeCareerShiftBonus: () => {
    if (!getActiveCareerShift()) return
    completeCareerBonusRt()
    audioManager.playClick()
    set((st) => ({ careerVersion: st.careerVersion + 1 }))
    get().showToast('Bonus objective done.')
  },

  enterApartment: () => get().enterInterior('apartment'),
  exitApartment: () => get().exitInterior(),

  enterInterior: (interiorId) => {
    const s = get()
    const def = getInterior(interiorId)
    if (!def) return
    // On foot only — driving keeps E reserved for exiting the car.
    if (s.mode !== 'walking' || s.location !== 'city') return
    // The apartment is a private refuge the police can't enter, so ducking home
    // during a pursuit would trivially end a chase — forbid it while wanted.
    // Stores are PUBLIC robbery targets: you may enter while wanted, but the
    // crime director suppresses wanted DECAY inside so it's not an exploit.
    if (def.kind === 'apartment' && getWantedLevel() > 0) {
      get().showToast("Can't hide at home during a police pursuit!")
      return
    }
    const location: PlayerLocationMode = def.kind === 'apartment' ? 'apartment' : 'store'
    set({ location, currentInteriorId: interiorId })
    get().requestTeleport(def.spawn)
    if (def.kind === 'apartment') get().showToast('Home sweet home.')
    emitMissionEvent({ type: 'location_changed', location })
    get().syncActivityUI(0)
  },

  exitInterior: () => {
    const s = get()
    if (s.location === 'city') return
    const def = s.currentInteriorId ? getInterior(s.currentInteriorId) : undefined
    set({ location: 'city', currentInteriorId: null })
    get().requestTeleport(def?.streetExit ?? APARTMENT_STREET_EXIT)
    emitMissionEvent({ type: 'location_changed', location: 'city' })
    get().syncActivityUI(0)
  },

  setAppearance: (appearance) =>
    set((s) => ({ appearance: { ...s.appearance, ...appearance } })),

  setCharacterRenderMode: (mode) => set({ characterRenderMode: mode }),

  enterVehicle: () => {
    const body = registry.playerBody
    if (body) body.setEnabled(false)
    audioManager.playClick()
    set({ mode: 'driving', activeInteractableId: 'vehicle_compact_car_01' })
  },

  exitVehicle: () => {
    const playerBody = registry.playerBody
    const carPos = registry.vehiclePosition
    // Yaw-only body: rotation quaternion is (0, sin(h/2), 0, cos(h/2)).
    const rot = registry.vehicleBody?.rotation()
    const heading = rot ? 2 * Math.atan2(rot.y, rot.w) : 0
    const [sx, sz] = findClearExitPosition(carPos.x, carPos.z, heading)
    // Also clear the exit of dynamic hazards (citizens, ambient cars) that the
    // static-only findClearExitPosition can't see — no exiting onto a body.
    const [ex, ez] = findClearPlayerSpawn(sx, sz)
    const exit: [number, number, number] = [ex, 1.2, ez]
    if (playerBody) {
      playerBody.setEnabled(true)
      playerBody.setTranslation({ x: exit[0], y: exit[1], z: exit[2] }, true)
      playerBody.setLinvel({ x: 0, y: 0, z: 0 }, true)
    }
    registry.playerPosition.set(exit[0], exit[1], exit[2])
    registry.flags.drivingSpeed = 0
    audioManager.playClick()
    audioManager.setEngine(0)
    set({ mode: 'walking' })
  },

  setPlayerHealth: (value) => {
    const health = Math.max(0, Math.min(PLAYER_MAX_HEALTH, value))
    set({ playerHealth: health, playerIncapacitated: health === 0 })
  },

  applyPlayerDamage: (amount, _gameTime) => {
    const s = get()
    if (s.playerIncapacitated) return { health: 0, incapacitated: true }
    const health = Math.max(0, s.playerHealth - Math.max(0, amount))
    const incapacitated = health === 0
    set({ playerHealth: health, playerIncapacitated: incapacitated })
    return { health, incapacitated }
  },

  respawnAfterIncident: (kind) => {
    const s = get()
    if (s.recovery) return // already recovering — ignore re-entrancy
    // Mission + activity hooks FIRST (before crime/combat reset), so they resolve
    // on the real arrest/incapacitation rather than seeing already-cleared state.
    emitMissionEvent({ type: kind === 'arrest' ? 'player_arrested' : 'player_incapacitated' })
    // Career consequence: an arrest/incapacitation DURING an active shift FAILS it
    // through a typed outcome (reduced pay, standing ding) — no permanent criminal
    // record (§11). Resolve before the crime/combat reset clears the incident.
    if (getActiveCareerShift()) {
      const out = failCareerShiftRt(kind === 'arrest' ? 'arrested' : 'incapacitated', s.stats.day)
      if (out && out.pay.total > 0) set((st) => ({ stats: { ...st.stats, money: st.stats.money + out.pay.total } }))
      set((st) => ({ careerVersion: st.careerVersion + 1 }))
    }
    // Robbery: lose unsecured proceeds exactly once, end any active robbery, and
    // (if inside a store) fall back out to the street.
    onPlayerIncident(kind)
    if (s.location !== 'city') set({ location: 'city', currentInteriorId: null })
    // Social consequence: a public arrest is seen by nearby named NPCs (a trust
    // ding) — note it at the player's position BEFORE the reset + respawn.
    if (kind === 'arrest') {
      const t = registry.playerBody?.translation()
      if (t) noteArrestWitnessed([t.x, t.y, t.z], s.stats.day, s.stats.hour)
    }
    const penalty = Math.min(s.stats.money, kind === 'arrest' ? 150 : 100)
    if (s.mode === 'driving') get().exitVehicle()
    // Wanted, police, incidents, stolen-vehicle state, weapon, panic all clear.
    resetCrimeSystems()
    resetCombatSystems()
    const message =
      kind === 'arrest'
        ? `Busted! Lost $${Math.round(penalty)}.`
        : `Hospitalized! Lost $${Math.round(penalty)}.`
    // Mission cargo (Shelf Run crate) is dropped on a failed run; the rest of the
    // bag is preserved.
    const crate = s.inventory['restock_crate'] ?? 0
    const cleanedInv = crate > 0 ? (removeStack(s.inventory, 'restock_crate', crate).stacks ?? s.inventory) : s.inventory
    set({
      stats: { ...s.stats, money: s.stats.money - penalty },
      playerHealth: PLAYER_MAX_HEALTH,
      playerIncapacitated: false,
      // Quests + inventory (minus mission cargo) + npc memory are preserved.
      inventory: cleanedInv,
      recovery: { kind, message, seq: ++recoverySeq },
    })
    teleportPlayer(PLAYER_SPAWN)
    audioManager.playClick()
  },

  dismissRecovery: () => set({ recovery: null }),

  stealVehicle: (vehicleId) => {
    const target = getStealable(vehicleId)
    const ambient = registry.ambientCarPositions.get(vehicleId)
    if (!target && !ambient) return false
    // Can't steal the same car twice (and never re-eject a driver).
    if (getVehicleCrimeState(vehicleId).stolen) return false
    // The source the drivable car represented BEFORE this theft (for vehicle_lost).
    const prevSourceId = getPlayerCarSourceId()
    // A carjack of an occupied car must not race with an active pursuit that
    // already downed the player.
    if (get().playerIncapacitated) return false
    const pos: [number, number, number] = target
      ? [target.position[0], 0.8, target.position[1]]
      : [ambient!.x, 0.8, ambient!.z]
    const headingY = target?.headingY ?? 0
    const gameTime = getCrimeGameTime()
    const occupied = target?.access === 'civilian_occupied'

    // Occupied: eject the seated driver ONCE to a validated safe exit, on foot,
    // before control transfers — reusing the car exit-point search.
    if (occupied && target?.driverId) {
      const [ex, ez] = findClearExitPosition(target.position[0], target.position[1], headingY)
      ejectDriver({
        id: target.driverId,
        vehicleId,
        exit: [ex, ez],
        fleeFrom: [target.position[0], target.position[1]],
        color: target.driverColor ?? '#5a4632',
        gameTime,
      })
    }

    // Relocate the drivable car onto the stolen vehicle's spot + heading.
    const body = registry.vehicleBody
    if (body) {
      body.setTranslation({ x: pos[0], y: pos[1], z: pos[2] }, true)
      body.setRotation({ x: 0, y: Math.sin(headingY / 2), z: 0, w: Math.cos(headingY / 2) }, true)
      body.setLinvel({ x: 0, y: 0, z: 0 }, true)
      body.setAngvel({ x: 0, y: 0, z: 0 }, true)
    }
    registry.vehiclePosition.set(pos[0], pos[1], pos[2])
    const crimeType = recordTheft(vehicleId)
    const crime = emitCrimeEvent(
      { type: crimeType, position: pos, suspectEntityId: 'player', vehicleId: PLAYER_CAR_ID },
      gameTime,
    )
    // The ousted driver immediately reports their carjacking (deterministic
    // owner reaction → wanted), rather than waiting on an organic witness.
    if (occupied && crime && target?.driverId) {
      fileReport(crime, target.driverId, gameTime)
    }
    // Social consequence: any named NPC who sees the theft remembers it
    // (Officer Kim reacts hardest — crime_witnessed scales with sensitivity).
    if (crime) {
      const { day, hour } = get().stats
      const witnessed = noteCrimeWitnessed(crime.id, pos, day, hour)
      if (witnessed.length > 0) set((st) => ({ socialVersion: st.socialVersion + 1 }))
    }
    // The player takes control; hide the on-foot body like enterVehicle.
    registry.playerBody?.setEnabled(false)
    audioManager.playClick()
    set({ mode: 'driving', activeInteractableId: PLAYER_CAR_ID })
    // Mission hook: a boost of the marked target advances Hot Cargo (a wrong
    // vehicle is ignored by the engine).
    emitMissionEvent({ type: 'vehicle_stolen', vehicleId, theftKind: crimeType })
    // If this boost replaced the mission's boosted target, the target is lost.
    notifyVehicleStolen(prevSourceId, vehicleId)
    return true
  },

  requestTeleport: (position) => {
    teleportPlayer(position)
  },

  setQuestState: (questId, state) =>
    set((s) => ({ questStates: { ...s.questStates, [questId]: state } })),

  setWeather: (kind, options = {}) => {
    requestWeather(weatherRuntime, kind, { ...options, manual: true })
    set({ weather: kind })
  },

  giveItem: (itemId, quantity) => {
    if (quantity > 0) {
      // Capacity-aware grant through the ONE item service. A full bag refuses
      // (no silent overflow); mission/quest grants surface a toast.
      const r = addStack(get().inventory, itemId, quantity, BACKPACK_CAPACITY)
      if (!r.ok) {
        get().showToast(r.reason === 'capacity_full' ? 'Your bag is full.' : "Can't carry that.")
        return
      }
      set({ inventory: r.stacks })
      emitMissionEvent({ type: 'item_acquired', itemId, quantity })
    } else if (quantity < 0) {
      const r = removeStack(get().inventory, itemId, -quantity)
      if (r.ok) set({ inventory: r.stacks })
    }
  },

  openShop: (storeId) => {
    const def = getStoreDefinition(storeId)
    if (!def) return
    const s = get()
    reconcileStore(storeId, gameHoursOf(s)) // lazy time-based restock on open
    if (storeClosedForCommerce(def.activityId, gameHoursOf(s))) {
      get().showToast('The store is closed after the incident.')
      return
    }
    audioManager.playClick()
    set({
      ui: { ...s.ui, panel: 'shop', dialogueNpcId: null, activityId: null },
      shopView: projectShop(storeId, s),
    })
  },

  buyItem: (storeId, itemId) => {
    const def = getStoreDefinition(storeId)
    if (!def) return
    const s = get()
    const closed = storeClosedForCommerce(def.activityId, gameHoursOf(s))
    const check = canPurchase(itemId, {
      store: def,
      stock: getStoreStock(storeId),
      money: s.stats.money,
      backpack: s.inventory,
      backpackCapacity: BACKPACK_CAPACITY,
      storeClosed: closed,
    })
    if (!check.ok) {
      get().showToast(purchaseFailureMessage(check.reason))
      return
    }
    // Atomic transaction: charge, decrement stock, grant — all together.
    const granted = addStack(s.inventory, itemId, 1, BACKPACK_CAPACITY)
    if (!granted.ok) {
      get().showToast('Your bag is full.')
      return
    }
    recordSale(storeId, itemId, 1)
    nextPurchaseReceipt(storeId) // bounded receipt/sequence for idempotency + tooling
    audioManager.playClick()
    set({ stats: { ...s.stats, money: s.stats.money - (check.price ?? 0) }, inventory: granted.stacks })
    set({ shopView: projectShop(storeId, get()) })
    get().showToast(`Bought ${getItemDefinition(itemId)?.name ?? itemId} (-$${check.price}).`)
  },

  useItem: (itemId) => {
    const s = get()
    const def = getItemDefinition(itemId)
    if (!def || (s.inventory[itemId] ?? 0) <= 0) return
    if (def.questReserved || !def.usable) {
      get().showToast(def.questReserved ? 'That’s reserved for a job.' : "Can't use that.")
      return
    }
    const w = getWeaponSnapshot()
    const res = applyItemEffect(def.effect, {
      hunger: s.stats.hunger,
      energy: s.stats.energy,
      health: s.playerHealth,
      maxHealth: PLAYER_MAX_HEALTH,
      ammoReserve: w.reserve,
      ammoReserveMax: getWeaponDef()?.reserveMax ?? 0,
      incapacitated: s.playerIncapacitated,
      unlockedPalettes: new Set(s.wardrobeUnlocks),
      hasHandgun: w.equipped !== null,
    })
    if (!res.ok) {
      get().showToast(res.message)
      return
    }
    // Apply the typed patch to the relevant authority, then consume exactly one.
    if (res.patch.hunger !== undefined || res.patch.energy !== undefined) {
      set({
        stats: {
          ...s.stats,
          hunger: res.patch.hunger ?? s.stats.hunger,
          energy: res.patch.energy ?? s.stats.energy,
        },
      })
    }
    if (res.patch.health !== undefined) get().setPlayerHealth(res.patch.health)
    if (res.patch.ammoReserve !== undefined) setAmmo(w.magazine, res.patch.ammoReserve)
    if (res.patch.unlockPalette) {
      set({ wardrobeUnlocks: [...new Set([...get().wardrobeUnlocks, res.patch.unlockPalette])] })
    }
    if (res.consume) {
      const rem = removeStack(get().inventory, itemId, 1)
      if (rem.ok) set({ inventory: rem.stacks })
    }
    audioManager.playClick()
    get().showToast(res.message)
  },

  discardItem: (itemId, quantity = 1) => {
    const s = get()
    const def = getItemDefinition(itemId)
    if (!def) return
    if (def.questReserved || !def.discardable) {
      get().showToast('You can’t drop that.')
      return
    }
    const r = removeStack(s.inventory, itemId, quantity)
    if (!r.ok) return
    set({ inventory: r.stacks })
    get().showToast(`Discarded ${def.name}.`)
  },

  depositItem: (itemId, quantity = 1) => {
    const s = get()
    const def = getItemDefinition(itemId)
    if (!def) return
    if (def.questReserved || !def.storable) {
      get().showToast('That has to stay on you.')
      return
    }
    const qty = quantity === 'all' ? (s.inventory[itemId] ?? 0) : quantity
    const t = transferItem(s.inventory, s.storage, itemId, qty, STORAGE_CAPACITY)
    if (!t.ok) {
      get().showToast(t.reason === 'capacity_full' ? 'Storage is full.' : 'Nothing to store.')
      return
    }
    set({ inventory: t.from, storage: t.to })
  },

  withdrawItem: (itemId, quantity = 1) => {
    const s = get()
    const qty = quantity === 'all' ? (s.storage[itemId] ?? 0) : quantity
    const t = transferItem(s.storage, s.inventory, itemId, qty, BACKPACK_CAPACITY)
    if (!t.ok) {
      get().showToast(t.reason === 'capacity_full' ? 'Your bag is full.' : 'Nothing to withdraw.')
      return
    }
    set({ storage: t.from, inventory: t.to })
  },

  isPaletteUnlocked: (paletteId) =>
    !LOCKED_PALETTE_IDS.includes(paletteId) || get().wardrobeUnlocks.includes(paletteId),

  collectShelfCrate: () => {
    const active = missionRuntime.active
    // Only during an active Shelf Run, and never a second crate (idempotent).
    if (active?.missionId !== 'shelf_run') return
    if (hasItem(get().inventory, 'restock_crate')) return
    get().giveItem('restock_crate', 1) // normal item-grant path (emits item_acquired)
  },

  deliverShelfCrate: (storeId) => {
    const active = missionRuntime.active
    if (active?.missionId !== 'shelf_run') return
    if (!hasItem(get().inventory, 'restock_crate')) {
      get().showToast('You need the restock crate first.')
      return
    }
    // Remove the exact crate, restock the store exactly once (receipt = attempt),
    // and emit the typed event the mission OBSERVES.
    const rem = removeStack(get().inventory, 'restock_crate', 1)
    if (rem.ok) set({ inventory: rem.stacks })
    applyDeliveryRestock(storeId, `shelf_run:${active.attemptId}`)
    emitMissionEvent({ type: 'store_restocked', storeId })
    get().showToast('Delivered — store restocked.')
  },

  showToast: (text) => set({ toast: { text, seq: ++toastSeq } }),

  getCurrentDialogue: () => {
    const s = get()
    if (s.ui.panel !== 'dialogue' || !s.ui.dialogueNpcId) return null
    const npc = NPC_BY_ID[s.ui.dialogueNpcId]
    if (!npc) return null
    return getDialogue(npc, s.questStates, s.npcMemory[npc.id])
  },

  getCurrentActions: () => {
    const s = get()
    if (s.ui.panel !== 'activity' || !s.ui.activityId) return []
    const def = INTERACTABLE_BY_ID[s.ui.activityId]
    if (!def) return []
    return getActionsFor(def.kind, {
      stats: s.stats,
      inventory: s.inventory,
      questStates: s.questStates,
    })
  },

  saveNow: async () => {
    const s = get()
    // Safety over persistence: never bake a chase into a save.
    if (getWantedLevel() > 0) {
      get().showToast("Can't save during a police pursuit.")
      set({ saveStatus: 'error' })
      return false
    }
    // A save-blocking (criminal) mission mustn't be persisted mid-attempt.
    const activeDef = missionRuntime.active ? getMissionDefinition(missionRuntime.active.missionId) : undefined
    if (activeDef?.blockSaveWhenActive) {
      get().showToast("Can't save during this job.")
      set({ saveStatus: 'error' })
      return false
    }
    // Robbery: never bake an active heist or unsecured criminal cash into a save.
    if (activityRuntime.active || activityRuntime.unsecuredProceeds > 0) {
      get().showToast("Can't save with a job in progress.")
      set({ saveStatus: 'error' })
      return false
    }
    const pos =
      s.mode === 'driving' ? registry.vehiclePosition : registry.playerPosition
    // v1 limitation: saving inside an interior stores its street exit instead,
    // so every load starts safely in the city (documented in README).
    const interiorDef = s.location !== 'city' && s.currentInteriorId ? getInterior(s.currentInteriorId) : undefined
    const savedPosition: [number, number, number] =
      s.location !== 'city' ? (interiorDef?.streetExit ?? [...APARTMENT_STREET_EXIT]) : [pos.x, pos.y, pos.z]
    const snapshot = createSnapshot({
      stats: s.stats,
      inventory: s.inventory,
      questStates: s.questStates,
      npcMemory: s.npcMemory,
      playerPosition: savedPosition,
      weather: { kind: s.weather, wetness: weatherRuntime.wetness },
      appearance: { ...s.appearance },
      playerHealth: s.playerHealth,
      missions: serializeMissions(),
      activities: serializeActivities(),
      storage: s.storage,
      wardrobe: { unlocked: s.wardrobeUnlocks },
      commerce: serializeCommerce(),
      social: serializeSocial(),
      career: serializeCareers(),
    })
    try {
      await persistSave(snapshot)
      get().showToast('Game saved.')
      set({ saveStatus: 'saved' })
      return true
    } catch {
      get().showToast('Save failed.')
      set({ saveStatus: 'error' })
      return false
    }
  },

  loadNow: async () => {
    try {
      const data = await loadSave()
      if (!data) {
        get().showToast('No save found.')
        return false
      }
      get().applySnapshot(data)
      get().showToast('Game loaded.')
      set({ saveStatus: 'loaded' })
      return true
    } catch {
      get().showToast('Load failed.')
      set({ saveStatus: 'error' })
      return false
    }
  },

  resetSave: async () => {
    await clearSave()
    get().resetGame()
    get().showToast('Save cleared. Fresh start!')
  },

  resetGame: () => {
    if (get().mode === 'driving') get().exitVehicle()
    resetWeatherRuntime()
    resetCrimeSystems() // transient: wanted/crime/incidents clear on reset
    resetCombatSystems() // transient: weapon/health/damage/panic clear on reset
    resetMissionRuntime() // missions/cooldowns/history clear on a full reset
    resetActivityRuntime() // robbery cooldowns/history/proceeds clear on reset
    resetInteriorCivilians() // store cashier/customers snap home on reset
    resetCommerceRuntime() // store stock back to full defaults
    resetSocial() // relationships/memories/contacts back to canonical defaults
    resetCareers() // employment/skills/shifts/history back to canonical defaults
    resetIntegrityRuntime() // clear mirrored entities + anomaly history on reset
    set({ ...createInitialGameState() })
    teleportPlayer(PLAYER_SPAWN)
  },

  applySnapshot: (snapshot) => {
    if (get().mode === 'driving') get().exitVehicle()
    // Weather: restore when saved; pre-weather saves default to clear skies.
    const savedKind =
      snapshot.weather && isWeatherKind(snapshot.weather.kind) ? snapshot.weather.kind : 'clear'
    resetWeatherRuntime()
    requestWeather(weatherRuntime, savedKind, { instant: true })
    if (snapshot.weather) {
      weatherRuntime.wetness = Math.min(1, Math.max(0, snapshot.weather.wetness))
    }
    // Crime/combat are transient: a load never restores a chase, wanted, police
    // or drawn weapon — only player health carries over (default 100 for old
    // saves).
    resetCrimeSystems()
    resetCombatSystems()
    // Missions: restore persistent history/cooldowns + a safe lawful active
    // mission (its markers are rebuilt by the driver); never a criminal chase.
    applyMissionSave(snapshot.missions)
    // Robbery: restore per-store cooldowns/history; never an active heist or
    // unsecured proceeds.
    applyActivitySave(snapshot.activities)
    resetInteriorCivilians() // no heist loads → civilians start home
    clearTransientActivity() // drop any transient robbery + containment on load
    // Social: restore relationships/memories/contacts (sanitized, idempotent);
    // an old save (no `social` field) resets to canonical strangers.
    applySocialSave(snapshot.social)
    // Careers: restore employment/skills/ranks/history/schedule + reload-safe shift
    // counter (sanitized, idempotent); an active shift never restores mid-flight.
    applyCareerSave(snapshot.career)
    // Commerce: restore persistent store stock + restock clocks + receipts;
    // old saves (no field) get deterministic full stock.
    applyCommerceSave(snapshot.commerce)
    const loadedHealth =
      typeof snapshot.playerHealth === 'number' && Number.isFinite(snapshot.playerHealth)
        ? Math.max(0, Math.min(PLAYER_MAX_HEALTH, snapshot.playerHealth))
        : PLAYER_MAX_HEALTH
    set({
      socialVersion: get().socialVersion + 1, // refresh social-reading UI after load
      stats: { ...snapshot.stats },
      // Migrate the legacy inventory Record → sanitised backpack stacks (drops
      // unknown ids, floors quantities, trims to capacity; coffee is preserved).
      inventory: sanitizeStacks(snapshot.inventory, BACKPACK_CAPACITY),
      storage: sanitizeStacks(snapshot.storage, STORAGE_CAPACITY),
      wardrobeUnlocks: Array.isArray(snapshot.wardrobe?.unlocked)
        ? snapshot.wardrobe.unlocked.filter((p) => LOCKED_PALETTE_IDS.includes(p))
        : [],
      shopView: null,
      questStates: { ...snapshot.questStates },
      npcMemory: structuredClone(snapshot.npcMemory),
      mode: 'walking',
      weather: savedKind,
      // Saves always restore to the city (positions saved inside the
      // apartment were rewritten to the street entrance at save time).
      location: 'city',
      // Pre-appearance saves keep the classic default look.
      appearance: isPlayerAppearance(snapshot.appearance)
        ? { ...snapshot.appearance }
        : { ...DEFAULT_APPEARANCE },
      ui: { panel: 'none', dialogueNpcId: null, activityId: null, activePhoneApp: 'home' },
      playerHealth: loadedHealth,
      playerIncapacitated: loadedHealth === 0,
      currentInteriorId: null,
    })
    teleportPlayer([
      snapshot.playerPosition[0],
      Math.max(snapshot.playerPosition[1], 1.2),
      snapshot.playerPosition[2],
    ])
    get().syncMissionUI()
    get().syncActivityUI(0)
  },

  // ---- Missions (Mission & Activity Framework v1) ----------------------------

  acceptMissionById: (missionId) => {
    const r = bridgeAccept(missionId)
    if (r.ok) {
      const def = getMissionDefinition(missionId)
      get().showToast(`Job accepted: ${def?.title ?? missionId}`)
    } else if (r.reason === 'another_active') {
      get().showToast('Finish or cancel your current job first.')
    } else if (r.reason === 'on_cooldown') {
      get().showToast('That job is on cooldown.')
    } else if (r.reason === 'no_target') {
      get().showToast('No suitable vehicle is available right now.')
    }
  },

  cancelActiveMission: () => {
    if (bridgeCancel()) {
      // Cleanup policy: a cancelled Shelf Run's crate is not kept (mission cargo).
      const drop = removeStack(get().inventory, 'restock_crate', get().inventory['restock_crate'] ?? 0)
      if (drop.ok) set({ inventory: drop.stacks })
      get().showToast('Job cancelled.')
    }
  },

  retryLastMission: () => {
    const r = bridgeRetry()
    if (!r.ok && r.reason === 'on_cooldown') get().showToast('That job is on cooldown.')
  },

  dismissMissionResult: () => {
    engineDismissResult()
    get().syncMissionUI()
  },

  syncMissionUI: (distance) => {
    const active = missionRuntime.active
    const def = active ? getMissionDefinition(active.missionId) : undefined
    const obj = def?.objectives[active?.objectiveIndex ?? 0]
    const res = missionRuntime.result
    const resDef = res ? getMissionDefinition(res.missionId) : undefined
    set((s) => ({
      missionView: {
        activeMissionId: active?.missionId ?? null,
        title: def?.title ?? null,
        category: def?.category ?? null,
        objectiveText: obj?.description ?? null,
        objectiveIndex: active?.objectiveIndex ?? 0,
        objectiveCount: def?.objectives.length ?? 0,
        objectiveDistance: distance === undefined ? s.missionView.objectiveDistance : distance,
        result: res
          ? {
              outcome: res.outcome,
              title: resDef?.title ?? res.missionId,
              reason: res.reason ?? null,
              seq: res.seq,
            }
          : null,
        // Bump the list sequence so the phone re-reads availability/cooldowns.
        listSeq: s.missionView.listSeq + 1,
      },
    }))
  },

  lootStoreRegister: () => {
    const taken = tryLootRegister()
    if (taken > 0) get().showToast(`Grabbed $${taken} from the register`)
  },

  secureRobberyProceeds: () => {
    const before = activityRuntime.unsecuredProceeds
    if (before <= 0) return
    const secured = trySecureProceeds()
    if (secured > 0) get().showToast(`Laundered $${secured}. Clean money.`)
    else if (getWantedLevel() > 0) get().showToast('Lose the police before securing the cash.')
    else get().showToast('Holster your weapon before securing the cash.')
  },

  dismissRobberyResult: () => {
    dismissRobberyResult()
    get().syncActivityUI(get().activityView.threatProgress)
  },

  syncActivityUI: (threatProgress) => {
    const active = activityRuntime.active
    const interiorId = get().currentInteriorId
    // The store def is the active robbery's, else the one hosted by the current
    // interior (so the HUD/prompt shows even before a robbery begins).
    const storeDef =
      (active ? getRobberyDefinition(active.activityId) : undefined) ??
      (interiorId ? getRobberyForInterior(interiorId) : undefined)
    const p = registry.playerPosition
    const canLoot =
      active?.phase === 'demanding' && storeDef !== undefined
        ? distanceToRegister(storeDef, p.x, p.z) <= 2.2
        : false
    const res = activityRuntime.result
    set({
      activityView: {
        storeId: active?.storeId ?? storeDef?.id ?? null,
        storeTitle: storeDef?.title ?? null,
        phase: active?.phase ?? 'idle',
        cashierPhase: active?.cashierPhase ?? 'calm',
        threatProgress,
        canLoot,
        alarmArmed:
          active?.alarmReportsAtGameTime !== null && active?.alarmReportsAtGameTime !== undefined,
        unsecuredProceeds: activityRuntime.unsecuredProceeds,
        canSecure:
          activityRuntime.unsecuredProceeds > 0 &&
          getWantedLevel() === 0 &&
          getWeaponSnapshot().pose === 'holstered',
        containmentPhase: activityRuntime.containment.phase,
        breachSeconds:
          activityRuntime.containment.phase === 'warning'
            ? breachCountdown(activityRuntime.containment)
            : null,
        result: res ? { outcome: res.outcome, amount: res.amount } : null,
      },
    })
  },
}))

// Register the live mission bridge once (no circular import: missions never
// import the store; the store injects these hooks). Money rewards mutate the
// store's stats; item rewards go through giveItem.
registerMissionBridge({
  getGameHours: () => {
    const { day, hour } = useGameStore.getState().stats
    return day * 24 + hour
  },
  applyRewards: (rewards, moneyTotal) => {
    if (moneyTotal !== 0) {
      useGameStore.setState((s) => ({ stats: { ...s.stats, money: s.stats.money + moneyTotal } }))
    }
    for (const r of rewards) {
      if (r.kind === 'item') useGameStore.getState().giveItem(r.itemId, r.quantity)
    }
  },
  toast: (text) => useGameStore.getState().showToast(text),
  onUiChanged: () => useGameStore.getState().syncMissionUI(),
})

// Register the live criminal-activity bridge once (same sink pattern). Secured
// proceeds add to money; typed activity events feed the UI and any observing
// mission (Corner Take) via emitMissionEvent.
registerActivityBridge({
  getGameHours: () => {
    const { day, hour } = useGameStore.getState().stats
    return day * 24 + hour
  },
  applyMoney: (amount) => {
    if (amount !== 0) {
      useGameStore.setState((s) => ({ stats: { ...s.stats, money: s.stats.money + amount } }))
    }
  },
  toast: (text) => useGameStore.getState().showToast(text),
  onUiChanged: () => {
    const s = useGameStore.getState()
    s.syncActivityUI(s.activityView.threatProgress)
  },
  onActivityEvent: (event) => emitMissionEvent({ type: 'activity_event', event }),
})

// Route bullet/collision damage aimed at the player through the store so the
// HUD reacts. Registered once at module load.
registerPlayerDamageSink((amount, gameTime) => useGameStore.getState().applyPlayerDamage(amount, gameTime))
