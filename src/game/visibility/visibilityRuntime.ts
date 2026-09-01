import type * as THREE from 'three'
import type {
  OccluderDescriptor,
  RegisteredOccluder,
  VisibilitySubject,
} from './visibilityTypes'
import { createOcclusionState, resetOcclusionState } from './occlusionDetection'
import { restoreOriginalMaterials } from './materialFade'
import { registry } from '../world/runtimeRegistry'
import { useGameStore } from '../store/useGameStore'
import { CHARACTER_ASSETS, PLAYER_CHARACTER_ASSET_ID } from '../characters/characterManifest'
import { getVisibilitySampleHeights } from '../characters/characterBounds'

/**
 * Module-singleton visibility registry (same pattern as trafficRuntime /
 * weatherRuntime): per-frame consumers read and mutate it imperatively; no
 * React state is touched inside the frame loop.
 */
export interface VisibilityRuntime {
  occluders: Map<string, RegisteredOccluder>
  /** Rebuilt on register/unregister only — the frame loop never allocates. */
  descriptorCache: OccluderDescriptor[]
  enabled: boolean
  /** Live debug counters (read by the debug panel + test API). */
  debug: {
    subjectId: string | null
    subjectKind: string | null
    candidateCount: number
    fadedIds: string[]
    registeredCount: number
    lastPrecise: string
  }
  /** Subject position last frame — jumps beyond this clear stale fades. */
  lastSubjectX: number
  lastSubjectZ: number
  hasLastSubject: boolean
}

export const visibilityRuntime: VisibilityRuntime = {
  occluders: new Map(),
  descriptorCache: [],
  enabled: true,
  debug: {
    subjectId: null,
    subjectKind: null,
    candidateCount: 0,
    fadedIds: [],
    registeredCount: 0,
    lastPrecise: '',
  },
  lastSubjectX: 0,
  lastSubjectZ: 0,
  hasLastSubject: false,
}

function rebuildDescriptorCache(): void {
  visibilityRuntime.descriptorCache.length = 0
  for (const occ of visibilityRuntime.occluders.values()) {
    visibilityRuntime.descriptorCache.push(occ.descriptor)
  }
  visibilityRuntime.debug.registeredCount = visibilityRuntime.occluders.size
}

export function registerOccluder(descriptor: OccluderDescriptor, object: THREE.Object3D): void {
  visibilityRuntime.occluders.set(descriptor.id, {
    descriptor,
    object,
    state: createOcclusionState(),
    meshes: null,
    swapped: false,
  })
  rebuildDescriptorCache()
}

export function unregisterOccluder(id: string): void {
  const occ = visibilityRuntime.occluders.get(id)
  if (occ) restoreOriginalMaterials(occ)
  visibilityRuntime.occluders.delete(id)
  rebuildDescriptorCache()
}

/** Restore every fade instantly (teleports, apartment entry, save/load). */
export function clearAllFades(): void {
  for (const occ of visibilityRuntime.occluders.values()) {
    resetOcclusionState(occ.state)
    restoreOriginalMaterials(occ)
  }
  visibilityRuntime.debug.fadedIds.length = 0
  visibilityRuntime.hasLastSubject = false
}

// ---- Active subject resolution (single source of truth) -------------------

/** Subject-position jumps beyond this are treated as teleports. */
export const TELEPORT_DISTANCE = 12

// Must track the asset the player actually renders as, not the crowd default.
const playerCharacterDef = CHARACTER_ASSETS[PLAYER_CHARACTER_ASSET_ID]

const playerSubject: VisibilitySubject = {
  id: 'player',
  kind: 'player',
  x: 0,
  z: 0,
  groundY: 0,
  radius: playerCharacterDef.bounds.radius,
  // Feet, torso, head from the actual character bounds — a fade needs a
  // majority hidden.
  sampleHeights: getVisibilitySampleHeights(playerCharacterDef),
  minBlockedSamples: 2,
}

const vehicleSubject: VisibilitySubject = {
  id: 'vehicle_compact_car_01',
  kind: 'vehicle',
  x: 0,
  z: 0,
  groundY: 0,
  radius: 2,
  // Body and roof — half hidden is enough (the car is wide, and stronger
  // effective hysteresis suits high-speed driving).
  sampleHeights: [0.5, 1.4],
  minBlockedSamples: 1,
}

/**
 * Who should stay readable right now. Null disables outdoor occlusion
 * (inside the apartment the outdoor city is off-screen by construction).
 * Future systems (cinematic focus targets, NPC close-ups) extend HERE, not
 * in per-component checks.
 */
export function getActiveVisibilitySubject(): VisibilitySubject | null {
  const store = useGameStore.getState()
  if (store.location === 'apartment') return null
  if (store.mode === 'driving') {
    vehicleSubject.x = registry.vehiclePosition.x
    vehicleSubject.z = registry.vehiclePosition.z
    vehicleSubject.groundY = 0
    return vehicleSubject
  }
  playerSubject.x = registry.playerPosition.x
  playerSubject.z = registry.playerPosition.z
  playerSubject.groundY = 0
  return playerSubject
}
