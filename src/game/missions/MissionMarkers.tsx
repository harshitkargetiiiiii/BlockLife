import { useMemo, useRef } from 'react'
import * as THREE from 'three'
import { useFrame } from '@react-three/fiber'
import { useGameStore } from '../store/useGameStore'
import { registry } from '../world/runtimeRegistry'
import { getStealable } from '../vehicles/vehicleCrimeState'
import { getSectorAtWorldPosition } from '../world/sectors/sectorRegistry'
import { streamingRuntime, isSectorMounted } from '../world/sectors/sectorStreaming'
import { missionRuntime } from './missionRuntime'
import { getMissionDefinition } from './missionDefinitions'
import { getMissionAnchor } from './missionAnchors'
import type { MissionMarkerKind } from './missionTypes'

/**
 * The world-space objective beacon — a single GLOBAL component (mounted at the
 * app root, one instance) that tracks the ACTIVE mission's current objective.
 * Being global-single, it can never duplicate across sector streaming. It draws
 * only when the objective's position is in a MOUNTED sector (the phone map
 * covers unloaded destinations), clears the instant the objective changes, and
 * uses unlit shared materials — no per-marker dynamic lights. Pause-aware so
 * visual baselines are deterministic.
 */

const MARKER_COLORS: Record<MissionMarkerKind, string> = {
  destination: '#8fe3ff',
  pickup: '#7fd4c1',
  delivery: '#78e08f',
  target_vehicle: '#ff9a3c',
  return: '#ffd166',
}

interface MarkerTarget {
  x: number
  z: number
  color: string
}

/** Resolve the current objective's world marker (position + color), or null. */
function resolveMarker(): MarkerTarget | null {
  const active = missionRuntime.active
  if (!active) return null
  const def = getMissionDefinition(active.missionId)
  const obj = def?.objectives[active.objectiveIndex]
  if (!obj || !obj.marker) return null
  const color = MARKER_COLORS[obj.marker.kind]

  if (
    obj.kind === 'reach_zone' ||
    obj.kind === 'drive_vehicle_to_zone' ||
    obj.kind === 'rob_store' ||
    obj.kind === 'secure_proceeds' ||
    obj.kind === 'deliver_restock'
  ) {
    const a = getMissionAnchor(obj.anchorId)
    return a ? { x: a.position[0], z: a.position[2], color } : null
  }
  if (obj.kind === 'interact' || obj.kind === 'deliver_vehicle' || obj.kind === 'return_to_giver') {
    const anchorId =
      obj.interactableId === 'hotcargo_fixer'
        ? 'hotcargo_garage'
        : obj.interactableId === 'shelf_depot'
          ? 'shelfrun_depot'
          : obj.interactableId
    const a = getMissionAnchor(anchorId)
    return a ? { x: a.position[0], z: a.position[2], color } : null
  }
  if (obj.kind === 'steal_vehicle') {
    const targetId = active.variables[obj.writeTargetToVariable] as string | undefined
    const v = targetId ? getStealable(targetId) : undefined
    return v ? { x: v.position[0], z: v.position[1], color } : null
  }
  if (obj.kind === 'enter_vehicle') {
    // Beacon over the parked getaway car (the single drivable body's live spot).
    const v = registry.vehiclePosition
    return { x: v.x, z: v.z, color }
  }
  return null
}

function sectorMounted(x: number, z: number): boolean {
  const sector = getSectorAtWorldPosition(x, z)
  if (!sector) return true // outside authored sectors (backdrop) — show anyway
  const state = streamingRuntime.states.get(sector.id)
  return state ? isSectorMounted(state) : false
}

export function MissionMarkers() {
  const group = useRef<THREE.Group>(null)
  // Unlit materials so a marker stays equally readable at night / in fog+rain.
  const beamMat = useMemo(
    () => new THREE.MeshBasicMaterial({ transparent: true, opacity: 0.7, depthWrite: false }),
    [],
  )
  const diamondMat = useMemo(() => new THREE.MeshBasicMaterial({ transparent: false }), [])
  const ringMat = useMemo(
    () => new THREE.MeshBasicMaterial({ transparent: true, opacity: 0.7, side: THREE.DoubleSide, depthWrite: false }),
    [],
  )

  useFrame(({ clock }) => {
    const g = group.current
    if (!g) return
    const paused = useGameStore.getState().worldPaused
    const target = resolveMarker()
    if (!target || !sectorMounted(target.x, target.z)) {
      g.visible = false
      return
    }
    g.visible = true
    g.position.set(target.x, 0, target.z)
    const color = new THREE.Color(target.color)
    beamMat.color.copy(color)
    diamondMat.color.copy(color)
    ringMat.color.copy(color)
    // Gentle bob + spin; frozen on pause for deterministic screenshots.
    const t = paused ? 0 : clock.elapsedTime
    const diamond = g.children[0]
    diamond.position.y = 3.5 + Math.sin(t * 2) * 0.25
    diamond.rotation.y = t * 1.4
  })

  return (
    <group ref={group} name="mission-marker" visible={false}>
      {/* Floating diamond — the eye-catcher, sized to read at a distance */}
      <mesh material={diamondMat} position={[0, 3.5, 0]} rotation={[0, 0, 0]}>
        <octahedronGeometry args={[0.62, 0]} />
      </mesh>
      {/* Beam from the ground up to the diamond */}
      <mesh material={beamMat} position={[0, 1.65, 0]}>
        <cylinderGeometry args={[0.19, 0.19, 3.3, 10, 1, true]} />
      </mesh>
      {/* Ground ring marking the zone */}
      <mesh material={ringMat} position={[0, 0.06, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <ringGeometry args={[1.15, 1.7, 32]} />
      </mesh>
    </group>
  )
}
