import { useRef } from 'react'
import * as THREE from 'three'
import { useFrame } from '@react-three/fiber'
import { PARK, PARKING_LOT } from './cityLayout'
import { useGameStore } from '../store/useGameStore'

// Little flower clusters scattered on the park lawn: [x, z, color].
const FLOWERS: [number, number, string][] = [
  [-9.2, 9.4, '#e8927c'],
  [-8.6, 9.9, '#ffd166'],
  [-9, 10.3, '#c86b85'],
  [-16.2, 12.2, '#ffd166'],
  [-16.8, 12.7, '#e8927c'],
  [-11.5, 18.2, '#c86b85'],
  [-12.1, 18.6, '#ffd166'],
  [-6.9, 15.4, '#e8927c'],
]

/**
 * The park pond as layered stylized water: a sandy bank rim, deep water,
 * an offset lighter shallow, a softly breathing shimmer highlight, and two
 * lily pads. Layers sit at staggered heights so nothing z-fights.
 */
function Pond() {
  const shimmer = useRef<THREE.Mesh>(null)
  const r = PARK.pond.radius

  useFrame(({ clock }) => {
    const mesh = shimmer.current
    if (!mesh) return
    const paused = useGameStore.getState().worldPaused
    const t = paused ? 0 : clock.elapsedTime
    // A slow breathing glimmer — opacity and scale drift gently, no jitter.
    const mat = mesh.material as THREE.MeshBasicMaterial
    mat.opacity = 0.3 + Math.sin(t * 0.7) * 0.12
    mesh.scale.setScalar(1 + Math.sin(t * 0.45) * 0.05)
  })

  return (
    <group name="pond" position={[PARK.pond.center[0], 0, PARK.pond.center[1]]}>
      {/* Sandy bank rim grounds the water in the lawn */}
      <mesh rotation-x={-Math.PI / 2} position={[0, 0.05, 0]} name="pond-bank">
        <circleGeometry args={[r + 0.55, 28]} />
        <meshStandardMaterial color="#c4b189" roughness={1} />
      </mesh>
      {/* Deep water */}
      <mesh rotation-x={-Math.PI / 2} position={[0, 0.065, 0]} name="pond-water">
        <circleGeometry args={[r, 28]} />
        <meshStandardMaterial color="#3f87ad" roughness={0.25} metalness={0.15} />
      </mesh>
      {/* Lighter shallow, offset toward the sun side */}
      <mesh rotation-x={-Math.PI / 2} position={[-0.35, 0.078, -0.3]} name="pond-shallow">
        <circleGeometry args={[r * 0.6, 24]} />
        <meshStandardMaterial color="#63aecb" roughness={0.2} />
      </mesh>
      {/* Breathing shimmer highlight */}
      <mesh ref={shimmer} rotation-x={-Math.PI / 2} position={[0.45, 0.09, 0.4]} name="pond-shimmer">
        <circleGeometry args={[r * 0.28, 20]} />
        <meshBasicMaterial color="#cfeaf4" transparent opacity={0.35} depthWrite={false} />
      </mesh>
      {/* Lily pads */}
      <mesh rotation-x={-Math.PI / 2} position={[-r * 0.55, 0.095, r * 0.45]} name="pond-lily">
        <circleGeometry args={[0.24, 12]} />
        <meshStandardMaterial color="#5e9e4e" roughness={0.9} />
      </mesh>
      <mesh rotation-x={-Math.PI / 2} position={[r * 0.35, 0.095, -r * 0.55]} name="pond-lily">
        <circleGeometry args={[0.17, 10]} />
        <meshStandardMaterial color="#6fae57" roughness={0.9} />
      </mesh>
    </group>
  )
}

/** Base terrain: grass, central plaza, park lawn + pond, parking asphalt. */
export function Ground() {
  return (
    <group name="ground">
      {/* Grass base under the whole three-district city (+ margins) */}
      <mesh rotation-x={-Math.PI / 2} position={[16, 0, -13]} receiveShadow>
        <planeGeometry args={[230, 210]} />
        <meshStandardMaterial color="#6f9e58" />
      </mesh>

      {/* Plaza pavement inside the road loop */}
      <mesh rotation-x={-Math.PI / 2} position={[0, 0.02, 0]} receiveShadow>
        <planeGeometry args={[42, 42]} />
        <meshStandardMaterial color="#cfc9bd" />
      </mesh>

      {/* Park lawn (south-west corner) */}
      <group name="park">
        <mesh
          rotation-x={-Math.PI / 2}
          position={[PARK.center[0], 0.04, PARK.center[1]]}
          receiveShadow
        >
          <planeGeometry args={[PARK.size[0], PARK.size[1]]} />
          <meshStandardMaterial color="#8cc084" />
        </mesh>
        <Pond />
        {/* Flower dots give the lawn a hand-placed feel */}
        {FLOWERS.map(([x, z, color], i) => (
          <mesh key={i} position={[x, 0.16, z]}>
            <sphereGeometry args={[0.11, 6, 6]} />
            <meshStandardMaterial color={color} />
          </mesh>
        ))}
      </group>

      {/* Parking lot asphalt (south-east corner) */}
      <group name="parking-lot">
        <mesh
          rotation-x={-Math.PI / 2}
          position={[PARKING_LOT.center[0], 0.04, PARKING_LOT.center[1]]}
          receiveShadow
        >
          <planeGeometry args={[PARKING_LOT.size[0], PARKING_LOT.size[1]]} />
          <meshStandardMaterial color="#4c4c55" />
        </mesh>
        {/* Slot markings along the east edge */}
        {[10, 13, 16, 19].map((z) => (
          <mesh
            key={z}
            rotation-x={-Math.PI / 2}
            position={[15.5, 0.06, z]}
          >
            <planeGeometry args={[4.5, 0.16]} />
            <meshStandardMaterial color="#e8e4da" />
          </mesh>
        ))}
      </group>
    </group>
  )
}
