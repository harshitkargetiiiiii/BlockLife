import * as THREE from 'three'
import type { RapierRigidBody } from '@react-three/rapier'
import { PLAYER_SPAWN } from '../player/playerTypes'
import { CAR_SPAWN } from './cityLayout'
import {
  completeTeleport,
  isTeleportDestinationReady,
  prepareTeleport,
} from './sectors/teleportCoordinator'

/**
 * Mutable per-frame runtime state shared between physics, camera, NPCs and
 * the interaction system. Deliberately outside the zustand store: these
 * values change every frame and must never trigger React re-renders.
 */
export const registry = {
  playerBody: null as RapierRigidBody | null,
  vehicleBody: null as RapierRigidBody | null,
  playerPosition: new THREE.Vector3(...PLAYER_SPAWN),
  vehiclePosition: new THREE.Vector3(...CAR_SPAWN),
  /** Player facing heading (radians, atan2(dx,dz)); aim direction fallback. */
  playerHeading: Math.PI,
  npcPositions: new Map<string, THREE.Vector3>(),
  /**
   * Ids of people (citizens + NPCs) currently WALKING. Person separation only
   * pushes moving people apart from OTHER moving people, so a walker is never
   * shoved backward by a stationary blocker (idler/sitter/queuer) it's passing
   * or arriving beside — which would otherwise deadlock trips at chokepoints.
   */
  movingPersonIds: new Set<string>(),
  /** Live positions of the decorative ambient cars (for avoidance checks). */
  ambientCarPositions: new Map<string, THREE.Vector3>(),
  flags: {
    running: false,
    drivingSpeed: 0,
    drivingBraking: false,
  },
  /** Set true by WorldDirector after the first rendered frame. */
  gameReady: false,
  frameCount: 0,
  /** Mounted LandmarkAsset instances that want a GLB (buildings + props). */
  glbLandmarksExpected: 0,
  /** GLB landmark instances that have actually committed to the scene. */
  glbLandmarksActive: 0,
  /** GLB landmark instances that failed to load and fell back to primitives. */
  glbLandmarksFailed: 0,
  /**
   * Monotonic counter bumped on EVERY change to the three counters above — a mount, an
   * unmount, a commit or a load failure (issue #46 §4).
   *
   * The counters alone are a snapshot, and a snapshot cannot tell "settled" from "between
   * scenes". A sector remount (`resetGame`, a teleport, a streaming crossing) tears the old
   * instances down before the new ones register, so all three counters pass through a trough
   * reading 0 — where `expected <= active + failed` is VACUOUSLY true. Visual baselines were
   * captured in exactly that window, holding a procedural fallback where the GLB belongs.
   *
   * The epoch closes it: it starts at 0, so the predicate can distinguish "no landmark has
   * ever mounted" from "everything mounted and committed", and any churn moves it.
   */
  glbLandmarkEpoch: 0,
  /** `performance.now()` of the last such change — the settle gate's quiescence clock. */
  glbLandmarkChangedAt: 0,
  /**
   * PER-ASSET render branch, keyed by manifest id (issue #44 Codex review).
   *
   * `hasRealModel()` only answers "is a model registered and enabled" — a manifest fact known
   * before any fetch. It cannot tell a caller which body is actually ON SCREEN, because a
   * registered GLB still falls back to its procedural sibling when the file is missing or
   * corrupt. Anything that must not double up with the procedural body (the garage's painted
   * rolling door) needs the real branch, not the manifest's intent.
   *
   * 'active' = the GLB committed to the scene; 'failed' = AssetErrorBoundary caught and the
   * procedural fallback is rendering. An id absent from the map is still loading (Suspense is
   * showing the fallback) or was never asked for.
   *
   * REFERENCE-COUNTED per branch, not a single value (issue #46 §4). One archetype backs several
   * placements — `arch_house_01` renders four houses — and sector streaming mounts and unmounts
   * them independently. With a single value, the first instance to unmount cleared the branch for
   * the three still on screen, and one instance's 'active' silently overwrote another's 'failed'.
   * Counting per branch makes the answer instance-independent: any active instance means the GLB
   * body is what renders; only when none is active and at least one has failed does the fallback
   * win.
   */
  glbAssetState: new Map<string, { expected: number; active: number; failed: number }>(),
  /**
   * Bumped every time the world is paused. Animated actors (NPCs, ambient
   * cars, smoke, birds) snap to canonical poses once per pause so paused
   * frames are pixel-deterministic for visual regression tests.
   */
  pauseSeq: 0,
}

/**
 * Record that the GLB landmark mount graph changed (issue #46 §4). Called by every site that
 * moves `glbLandmarksExpected/Active/Failed`, so the settle gate can require quiescence rather
 * than trusting a counter comparison that is briefly true between scenes.
 */
export function noteGlbLandmarkChange(): void {
  registry.glbLandmarkEpoch++
  registry.glbLandmarkChangedAt = performance.now()
}

export function getFollowTargetPosition(mode: 'walking' | 'driving'): THREE.Vector3 {
  return mode === 'driving' ? registry.vehiclePosition : registry.playerPosition
}

/**
 * Every teleport path (test API, save/load, apartment exit, debug) funnels
 * through here. If the destination sector isn't streamed in yet, the move
 * DEFERS: the coordinator makes the destination the top streaming priority
 * and SectorDirector commits the move once visuals + colliders report
 * ready — the player never lands in an unready sector.
 */
export function teleportPlayer(position: [number, number, number]): void {
  const seq = prepareTeleport(position)
  if (isTeleportDestinationReady()) {
    commitPlayerTeleport(position)
    completeTeleport(seq)
  }
}

/** The raw, immediate move (coordinator-committed once safe). */
export function commitPlayerTeleport(position: [number, number, number]): void {
  registry.playerPosition.set(position[0], position[1], position[2])
  const body = registry.playerBody
  if (body) {
    body.setTranslation({ x: position[0], y: position[1], z: position[2] }, true)
    body.setLinvel({ x: 0, y: 0, z: 0 }, true)
  }
}
