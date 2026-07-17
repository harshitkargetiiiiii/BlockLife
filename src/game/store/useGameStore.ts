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
import { requestWeather, resetWeatherRuntime, weatherRuntime } from '../weather/weatherSystem'
import { isWeatherKind, type WeatherKind } from '../weather/weatherTypes'
import { getCrimeGameTime, resetCrimeSystems } from '../crime/crimeSystem'
import { emitCrime as emitCrimeEvent } from '../crime/crimeRuntime'
import { getWantedLevel } from '../crime/wantedRuntime'
import {
  getStealable,
  getVehicleCrimeState,
  PLAYER_CAR_ID,
  recordTheft,
} from '../vehicles/vehicleCrimeState'
import { ejectDriver } from '../vehicles/ejectedDriverRuntime'
import { fileReport } from '../crime/reportingSystem'
import { registerPlayerDamageSink } from '../combat/damageRuntime'
import { resetCombatSystems } from '../combat/combatSystem'
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
import { APARTMENT_SPAWN, APARTMENT_STREET_EXIT } from '../interiors/apartmentLayout'
import {
  acceptMission as bridgeAccept,
  cancelActiveMission as bridgeCancel,
  discoverAndOfferMission,
  emitMissionEvent,
  registerMissionBridge,
  retryLastMission as bridgeRetry,
} from '../missions/missionBridge'
import { missionRuntime, resetMissionRuntime } from '../missions/missionRuntime'
import { MISSION_DEFINITIONS, getMissionDefinition } from '../missions/missionDefinitions'
import { dismissMissionResult as engineDismissResult } from '../missions/missionEngine'
import { applyMissionSave, serializeMissions } from '../missions/missionPersistence'

export type PanelKind = 'none' | 'dialogue' | 'activity' | 'phone' | 'wardrobe' | 'storage'
export type PlayMode = 'walking' | 'driving'

export type PhoneAppId =
  | 'home'
  | 'map'
  | 'quests'
  | 'missions'
  | 'messages'
  | 'contacts'
  | 'jobs'
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
  saveStatus: string | null
  /** Player health 0–100 (HUD-reactive). Persists across save/load. */
  playerHealth: number
  /** True while incapacitated (health hit 0), until the recovery flow runs. */
  playerIncapacitated: boolean
  /** Active BUSTED/WASTED recovery overlay, or null. */
  recovery: { kind: 'arrest' | 'incapacitation'; message: string; seq: number } | null
  /** UI mirror of the mission runtime (Mission & Activity Framework v1). */
  missionView: MissionView
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
  }
}

let toastSeq = 0
let recoverySeq = 0

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
    } else if (def.kind === 'wardrobe') {
      set((s) => ({ ui: { ...s.ui, panel: 'wardrobe', dialogueNpcId: null, activityId: null } }))
    } else if (def.kind === 'storage') {
      set((s) => ({ ui: { ...s.ui, panel: 'storage', dialogueNpcId: null, activityId: null } }))
    } else if (def.kind === 'mission_offer' || def.kind === 'mission_objective') {
      handleMissionInteract(id, def.kind, get)
    } else {
      get().openActivity(id)
      // Feed the interaction to the active mission (a no-op unless a mission's
      // current objective targets this interactable).
      emitMissionEvent({ type: 'interactable_used', interactableId: id })
    }
  },

  openDialogue: (npcId) =>
    set((s) => ({ ui: { ...s.ui, panel: 'dialogue', dialogueNpcId: npcId, activityId: null } })),

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
    const outcome = performAction(
      { stats: s.stats, inventory: s.inventory, questStates: s.questStates },
      actionId,
    )
    audioManager.playClick()
    set({
      stats: outcome.state.stats,
      inventory: outcome.state.inventory,
      questStates: outcome.state.questStates,
    })
    get().showToast(outcome.message)
    // Sleeping closes the panel so the player sees the new morning.
    if (outcome.ok && actionId === 'sleep') get().closePanel()
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
    if (outcome.close) get().closePanel()
  },

  enterApartment: () => {
    const s = get()
    // On foot only — driving keeps E reserved for exiting the car.
    if (s.mode !== 'walking' || s.location !== 'city') return
    // No ducking home to shake a pursuit: the interior is a separate scene the
    // police can't enter, so allowing this would trivially end a chase. Same
    // policy as the phone block and the save block (wanted is never persisted).
    if (getWantedLevel() > 0) {
      get().showToast("Can't hide at home during a police pursuit!")
      return
    }
    set({ location: 'apartment' })
    get().requestTeleport(APARTMENT_SPAWN)
    get().showToast('Home sweet home.')
    emitMissionEvent({ type: 'location_changed', location: 'apartment' })
  },

  exitApartment: () => {
    if (get().location !== 'apartment') return
    set({ location: 'city' })
    get().requestTeleport(APARTMENT_STREET_EXIT)
    emitMissionEvent({ type: 'location_changed', location: 'city' })
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
    const [ex, ez] = findClearExitPosition(carPos.x, carPos.z, heading)
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
    // Mission hook FIRST (before crime/combat reset), so an active mission fails
    // on the real arrest/incapacitation rather than seeing already-cleared state.
    emitMissionEvent({ type: kind === 'arrest' ? 'player_arrested' : 'player_incapacitated' })
    const penalty = Math.min(s.stats.money, kind === 'arrest' ? 150 : 100)
    if (s.mode === 'driving') get().exitVehicle()
    // Wanted, police, incidents, stolen-vehicle state, weapon, panic all clear.
    resetCrimeSystems()
    resetCombatSystems()
    const message =
      kind === 'arrest'
        ? `Busted! Lost $${Math.round(penalty)}.`
        : `Hospitalized! Lost $${Math.round(penalty)}.`
    set({
      stats: { ...s.stats, money: s.stats.money - penalty },
      playerHealth: PLAYER_MAX_HEALTH,
      playerIncapacitated: false,
      // Quests + inventory + npc memory are deliberately preserved.
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
    // The player takes control; hide the on-foot body like enterVehicle.
    registry.playerBody?.setEnabled(false)
    audioManager.playClick()
    set({ mode: 'driving', activeInteractableId: PLAYER_CAR_ID })
    // Mission hook: a boost of the marked target advances Hot Cargo (a wrong
    // vehicle is ignored by the engine).
    emitMissionEvent({ type: 'vehicle_stolen', vehicleId, theftKind: crimeType })
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
    set((s) => {
      const next = { ...s.inventory, [itemId]: (s.inventory[itemId] ?? 0) + quantity }
      if (next[itemId] <= 0) delete next[itemId]
      return { inventory: next }
    })
    // Mission hook: acquiring items can satisfy a collect_item objective.
    if (quantity > 0) emitMissionEvent({ type: 'item_acquired', itemId, quantity })
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
    const pos =
      s.mode === 'driving' ? registry.vehiclePosition : registry.playerPosition
    // v1 limitation: saving inside the apartment stores the street entrance
    // instead, so every load starts safely in the city (documented in README).
    const savedPosition: [number, number, number] =
      s.location === 'apartment' ? [...APARTMENT_STREET_EXIT] : [pos.x, pos.y, pos.z]
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
    const loadedHealth =
      typeof snapshot.playerHealth === 'number' && Number.isFinite(snapshot.playerHealth)
        ? Math.max(0, Math.min(PLAYER_MAX_HEALTH, snapshot.playerHealth))
        : PLAYER_MAX_HEALTH
    set({
      stats: { ...snapshot.stats },
      inventory: { ...snapshot.inventory },
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
    })
    teleportPlayer([
      snapshot.playerPosition[0],
      Math.max(snapshot.playerPosition[1], 1.2),
      snapshot.playerPosition[2],
    ])
    get().syncMissionUI()
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
    if (bridgeCancel()) get().showToast('Job cancelled.')
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

// Route bullet/collision damage aimed at the player through the store so the
// HUD reacts. Registered once at module load.
registerPlayerDamageSink((amount, gameTime) => useGameStore.getState().applyPlayerDamage(amount, gameTime))
