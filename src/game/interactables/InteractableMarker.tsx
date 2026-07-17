import { useRef } from 'react'
import * as THREE from 'three'
import { useFrame } from '@react-three/fiber'
import type { InteractableDef } from './interactableTypes'
import { WorldLabel } from '../ui3d/WorldLabel'
import { useGameStore } from '../store/useGameStore'

/**
 * Ring tuning, exported for tests: kept thin, dim and slow so markers read
 * as gentle hints instead of a noisy energy-field effect around places.
 */
export const MARKER_RING = {
  idleOpacity: 0.28,
  activeOpacity: 0.65,
  pulseAmplitude: 0.035,
  pulseSpeed: 1.6,
}

/**
 * A softly pulsing ground ring + floating label marking an interactable
 * place. Brightens when it's the player's active interactable.
 */
export function InteractableMarker({ def }: { def: InteractableDef }) {
  const ring = useRef<THREE.Mesh>(null)
  const isActive = useGameStore((s) => s.activeInteractableId === def.id)
  const position = def.position ?? [0, 0, 0]

  useFrame(({ clock }) => {
    if (!ring.current) return
    const paused = useGameStore.getState().worldPaused
    const pulse = paused
      ? 1
      : 1 + Math.sin(clock.elapsedTime * MARKER_RING.pulseSpeed) * MARKER_RING.pulseAmplitude
    ring.current.scale.setScalar(isActive ? pulse * 1.1 : pulse)
    const mat = ring.current.material as THREE.MeshBasicMaterial
    mat.opacity = isActive ? MARKER_RING.activeOpacity : MARKER_RING.idleOpacity
  })

  return (
    <group name={`marker:${def.id}`} position={[position[0], 0, position[2]]}>
      <mesh ref={ring} rotation-x={-Math.PI / 2} position={[0, 0.08, 0]}>
        <ringGeometry args={[def.radius * 0.54, def.radius * 0.62, 36]} />
        <meshBasicMaterial
          color={def.markerColor ?? '#ffd166'}
          transparent
          opacity={MARKER_RING.idleOpacity}
          depthWrite={false}
        />
      </mesh>
      <WorldLabel
        text={def.name}
        icon={def.icon}
        className={`place-label ${isActive ? 'place-label-active' : ''}`}
        offset={3}
      />
    </group>
  )
}
