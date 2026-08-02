import { useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import type { InteractableDef } from './interactableTypes'
import { ALL_INTERACTABLES } from '../../data/interactables'
import { registry } from '../world/runtimeRegistry'
import { useGameStore } from '../store/useGameStore'
import { isDrivingShellActive } from '../vehicles/vehicleProjection'

// The one drivable shell is only offered on foot when it is present (an owned vehicle is active or
// a stolen identity is projected). On a new game the shell is hidden, so there is no free car (§3).
const ON_FOOT_INTERACTABLES = ALL_INTERACTABLES.filter((d) => d.dynamic !== 'vehicle')

interface Candidate {
  id: string
  distance: number
}

// Hysteresis: the current interactable keeps a grace margin beyond its
// radius, and a challenger must be meaningfully closer to steal focus. This
// stops the prompt flickering when the player stands between two places.
const STICKY_RADIUS_FACTOR = 1.2
const CHALLENGER_ADVANTAGE = 0.75

/**
 * Pure proximity resolution so it can be unit tested: returns the id of the
 * best interactable near the player, or null. `currentId` gets stickiness.
 */
export function findNearestInteractable(
  playerPos: { x: number; z: number },
  defs: InteractableDef[],
  resolveDynamic: (def: InteractableDef) => { x: number; z: number } | null,
  currentId: string | null = null,
): string | null {
  let best: Candidate | null = null
  let current: Candidate | null = null
  for (const def of defs) {
    const pos = def.position
      ? { x: def.position[0], z: def.position[2] }
      : resolveDynamic(def)
    if (!pos) continue
    const d = Math.hypot(pos.x - playerPos.x, pos.z - playerPos.z)
    if (def.id === currentId && d <= def.radius * STICKY_RADIUS_FACTOR) {
      current = { id: def.id, distance: d }
    }
    if (d <= def.radius && (!best || d < best.distance)) {
      best = { id: def.id, distance: d }
    }
  }
  if (current && best && best.id !== current.id) {
    // Keep the current one unless the challenger is clearly closer.
    return best.distance < current.distance * CHALLENGER_ADVANTAGE ? best.id : current.id
  }
  return (best ?? current)?.id ?? null
}

export function resolveDynamicPosition(def: InteractableDef): { x: number; z: number } | null {
  if (def.dynamic === 'vehicle') {
    return { x: registry.vehiclePosition.x, z: registry.vehiclePosition.z }
  }
  if (def.dynamic === 'npc') {
    const p = registry.npcPositions.get(def.id)
    return p ? { x: p.x, z: p.z } : null
  }
  return null
}

const SCAN_INTERVAL = 0.15

/**
 * Scans a few times per second (inside the Canvas loop) and pushes the active
 * interactable id into the store only when it changes.
 */
export function useNearbyInteractable(): void {
  const acc = useRef(0)
  useFrame((_, dt) => {
    acc.current += dt
    if (acc.current < SCAN_INTERVAL) return
    acc.current = 0

    const state = useGameStore.getState()
    let next: string | null
    if (state.mode === 'driving') {
      // While driving the only interaction is exiting the car.
      next = 'vehicle_compact_car_01'
    } else {
      const p = registry.playerPosition
      // Offer the drivable shell's "enter" interactable only when it is actually present.
      const defs = isDrivingShellActive() ? ALL_INTERACTABLES : ON_FOOT_INTERACTABLES
      next = findNearestInteractable(
        { x: p.x, z: p.z },
        defs,
        resolveDynamicPosition,
        state.activeInteractableId,
      )
    }
    if (next !== state.activeInteractableId) {
      state.setActiveInteractable(next)
    }
  })
}
