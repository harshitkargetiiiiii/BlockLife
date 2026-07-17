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
   * Bumped every time the world is paused. Animated actors (NPCs, ambient
   * cars, smoke, birds) snap to canonical poses once per pause so paused
   * frames are pixel-deterministic for visual regression tests.
   */
  pauseSeq: 0,
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
