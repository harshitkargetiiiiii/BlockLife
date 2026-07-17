import type * as THREE from 'three'

/**
 * Building Occlusion & Player Visibility v1.
 *
 * Ownership boundaries:
 * - solidFootprints.ts owns PHYSICAL occupancy (colliders, placement rules).
 * - This module owns CAMERA-TO-SUBJECT visibility only. It never becomes a
 *   second source of world-geometry truth: occluder bounds are derived from
 *   the same layout data (BUILDINGS) that drives rendering and colliders.
 * - The camera provides position context; it does not own fade state.
 * - Gameplay systems never read visibility state.
 */

/** Who the camera is trying to keep readable. */
export interface VisibilitySubject {
  id: string
  kind: 'player' | 'vehicle' | 'npc' | 'focusTarget'
  /** Ground-plane position (x, z) and the ground height the samples sit on. */
  x: number
  z: number
  groundY: number
  radius: number
  /** Sample heights above groundY, ordered bottom → top. */
  sampleHeights: number[]
  /** Minimum number of blocked samples that counts as "occluded". */
  minBlockedSamples: number
}

/** Axis-aligned 2D rectangle on the ground plane. */
export interface Rect2D {
  minX: number
  maxX: number
  minZ: number
  maxZ: number
}

export type OccluderCategory = 'building' | 'roof' | 'largeProp' | 'interiorWall'

/**
 * Fade policies. v1 implements 'wholeObject'; 'roofOnly' / 'facadeOnly' are
 * reserved extension points — detection and runtime are policy-agnostic, so
 * adding them only requires a new material-application strategy in
 * materialFade.ts (see applyFade).
 */
export type FadeMode = 'wholeObject' | 'roofOnly' | 'facadeOnly'

export interface OccluderDescriptor {
  id: string
  category: OccluderCategory
  bounds2D: Rect2D
  minY: number
  maxY: number
  fadeMode: FadeMode
  minimumOpacity: number
  /** Opacity units per second toward the target while fading out. */
  fadeSpeed: number
  /** Opacity units per second while restoring (slower for polish). */
  restoreSpeed: number
  enabled: boolean
  /** Mirror the fade of another occluder instead of detecting independently
      (used by detached decals that visually belong to a building). */
  linkedTo?: string
  /** Material names that must never fade (GLB overrides). */
  excludeMaterialNames?: string[]
}

/** Per-occluder live occlusion/fade state (runtime registry, not React). */
export interface OcclusionState {
  targetOpacity: number
  currentOpacity: number
  /** Wall-clock seconds when continuous occlusion started (null = clear). */
  occludedSince: number | null
  /** Wall-clock seconds when continuous clearance started (null = occluded). */
  clearSince: number | null
  reason: string
  /** Blocked-sample count from the last precise test (debug/ranking). */
  blockedSamples: number
}

/** Snapshot of everything applyFade may touch, for exact restoration. */
export interface OriginalMaterialState {
  opacity: number
  transparent: boolean
  depthWrite: boolean
  alphaTest: number
}

/** One fade-capable mesh discovered inside an occludable group. */
export interface FadeMeshEntry {
  mesh: THREE.Mesh
  /** Original material(s), swapped back on full restore. */
  originalMaterial: THREE.Material | THREE.Material[]
  /** Per-occludable clone(s) used while fading. */
  fadeMaterial: THREE.Material | THREE.Material[]
  originalCastShadow: boolean
}

/** A registered occludable: descriptor + scene hookup + live state. */
export interface RegisteredOccluder {
  descriptor: OccluderDescriptor
  object: THREE.Object3D
  state: OcclusionState
  /** Lazily built at first fade; null until then. */
  meshes: FadeMeshEntry[] | null
  /** True while fade materials are swapped in. */
  swapped: boolean
}
