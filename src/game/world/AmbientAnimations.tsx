import { useRef } from 'react'
import * as THREE from 'three'
import { useFrame } from '@react-three/fiber'
import { PARK } from './cityLayout'
import { useGameStore } from '../store/useGameStore'

// Shared bird pieces: a tiny body and two wing blades that flap.
const birdBodyGeometry = new THREE.SphereGeometry(0.09, 6, 5)
const birdWingGeometry = new THREE.PlaneGeometry(0.4, 0.13)
const birdMaterial = new THREE.MeshStandardMaterial({
  color: '#5d6478',
  roughness: 1,
  transparent: true,
  opacity: 0.85,
  side: THREE.DoubleSide,
})

interface BirdDef {
  phase: number
  radius: number
  height: number
  flapSpeed: number
}

const BIRDS: BirdDef[] = [
  { phase: 0, radius: 5.6, height: 9.2, flapSpeed: 6.5 },
  { phase: Math.PI, radius: 6.4, height: 10.1, flapSpeed: 7.5 },
]

/**
 * A tiny stylized bird gliding a slow circle high above the park pond:
 * body + two flapping wing blades. Reads as a distant silhouette from the
 * diorama camera — replaced the old grey debug-arrow-looking cones.
 */
function Bird({ def }: { def: BirdDef }) {
  const group = useRef<THREE.Group>(null)
  const leftWing = useRef<THREE.Mesh>(null)
  const rightWing = useRef<THREE.Mesh>(null)

  useFrame(({ clock }) => {
    const g = group.current
    if (!g) return
    const paused = useGameStore.getState().worldPaused
    const t = paused ? 0 : clock.elapsedTime

    const angle = def.phase + t * 0.28
    g.position.set(
      PARK.center[0] + Math.cos(angle) * def.radius,
      def.height + Math.sin(t * 0.5 + def.phase) * 0.35,
      PARK.center[1] + Math.sin(angle) * def.radius,
    )
    // Face along the direction of travel (the circle's tangent).
    g.rotation.y = -angle - Math.PI / 2

    const flap = paused ? 0 : Math.sin(t * def.flapSpeed + def.phase) * 0.45
    if (leftWing.current) leftWing.current.rotation.y = flap
    if (rightWing.current) rightWing.current.rotation.y = -flap
  })

  return (
    <group ref={group} name="park-bird">
      <mesh geometry={birdBodyGeometry} material={birdMaterial} />
      <mesh
        ref={leftWing}
        geometry={birdWingGeometry}
        material={birdMaterial}
        position={[-0.22, 0.02, 0]}
        rotation-x={-Math.PI / 2}
      />
      <mesh
        ref={rightWing}
        geometry={birdWingGeometry}
        material={birdMaterial}
        position={[0.22, 0.02, 0]}
        rotation-x={-Math.PI / 2}
      />
    </group>
  )
}

/** Ambient park life: two birds, slow and soft — ambience, not clutter. */
export function AmbientAnimations() {
  return (
    <group name="ambient-animations">
      <group name="park-birds">
        {BIRDS.map((def, i) => (
          <Bird key={i} def={def} />
        ))}
      </group>
    </group>
  )
}
