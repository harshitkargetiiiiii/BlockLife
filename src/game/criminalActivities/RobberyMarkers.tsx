import { useRef } from 'react'
import * as THREE from 'three'
import { useFrame } from '@react-three/fiber'
import { useGameStore } from '../store/useGameStore'
import { InteractableMarker } from '../interactables/InteractableMarker'
import { STORE_INTERACTABLES } from '../../data/interactables'
import { getMissionAnchor } from '../missions/missionAnchors'

/**
 * Markers for the criminal-activity layer: a gentle ring + label over each
 * store's exterior door (data-driven, exactly like the place markers), plus a
 * pulsing "secure here" beacon over the fixer's garage while the player is
 * carrying unsecured proceeds. Data-driven, bounded — no scene traversal.
 */

const ENTRANCE_MARKERS = STORE_INTERACTABLES.filter((d) => d.marker)
const FIXER = getMissionAnchor('hotcargo_garage')

const beaconMat = new THREE.MeshBasicMaterial({
  color: '#f2c14e',
  transparent: true,
  opacity: 0.7,
  depthWrite: false,
})

function SecureBeacon() {
  const ring = useRef<THREE.Mesh>(null)
  const carrying = useGameStore((s) => s.activityView.unsecuredProceeds > 0)
  useFrame(({ clock }) => {
    if (!ring.current) return
    const paused = useGameStore.getState().worldPaused
    const s = paused ? 1 : 1 + Math.sin(clock.elapsedTime * 2) * 0.06
    ring.current.scale.setScalar(s)
  })
  if (!carrying || !FIXER) return null
  return (
    <group position={[FIXER.position[0], 0, FIXER.position[2]]}>
      <mesh ref={ring} rotation-x={-Math.PI / 2} position={[0, 0.12, 0]} material={beaconMat}>
        <ringGeometry args={[1.4, 1.9, 36]} />
      </mesh>
    </group>
  )
}

export function RobberyMarkers() {
  return (
    <group name="robbery-markers">
      {ENTRANCE_MARKERS.map((def) => (
        <InteractableMarker key={def.id} def={def} />
      ))}
      <SecureBeacon />
    </group>
  )
}
