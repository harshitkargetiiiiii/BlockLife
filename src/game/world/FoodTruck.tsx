import { useMemo, useRef } from 'react'
import * as THREE from 'three'
import { useFrame } from '@react-three/fiber'
import { FOOD_TRUCK } from './cityLayout'
import { useGameStore } from '../store/useGameStore'
import { LandmarkAsset } from '../assets/LandmarkAsset'

const SMOKE_COUNT = 4

/**
 * Steam tuning, exported so tests can pin the "no weird current" fix: puffs
 * rise near-vertically (tiny drift), slowly, and stay faint. Larger drift or
 * opacity made the steam read as a strange sideways "electric current".
 */
export const SMOKE_TUNING = {
  /** Total sideways drift over a puff's lifetime (world units). */
  drift: 0.12,
  /** Lifetime speed — lower is calmer. */
  speed: 0.22,
  /** Peak opacity of a puff. */
  maxOpacity: 0.3,
  /** Amplitude of the wobble as puffs rise. */
  wobble: 0.04,
}

/**
 * Steam puffs from the kitchen vent: soft, slow and almost vertical —
 * cozy kitchen steam, not an electric arc.
 */
function Smoke() {
  const puffs = useRef<THREE.Mesh[]>([])
  const seeds = useMemo(
    () => Array.from({ length: SMOKE_COUNT }, (_, i) => i / SMOKE_COUNT),
    [],
  )
  useFrame(({ clock }) => {
    // While paused, freeze each puff at its seed phase for deterministic frames.
    const paused = useGameStore.getState().worldPaused
    const t = paused ? 0 : clock.elapsedTime * SMOKE_TUNING.speed
    puffs.current.forEach((mesh, i) => {
      if (!mesh) return
      const phase = (t + seeds[i]) % 1
      mesh.position.set(
        phase * SMOKE_TUNING.drift + Math.sin(phase * 4 + i * 2) * SMOKE_TUNING.wobble,
        0.1 + phase * 1.7,
        Math.cos(phase * 3 + i) * SMOKE_TUNING.wobble,
      )
      const s = 0.08 + phase * 0.24
      mesh.scale.setScalar(s)
      const mat = mesh.material as THREE.MeshBasicMaterial
      // Fade in quickly, then out slowly — avoids popping at the vent.
      mat.opacity = SMOKE_TUNING.maxOpacity * Math.min(1, phase * 4) * (1 - phase)
    })
  })
  return (
    <group position={[-1.4, 2.6, -0.5]} name="food-truck-smoke">
      {seeds.map((_, i) => (
        <mesh
          key={i}
          ref={(m) => {
            if (m) puffs.current[i] = m
          }}
        >
          <sphereGeometry args={[1, 8, 8]} />
          <meshBasicMaterial color="#f2f0ec" transparent opacity={0.5} depthWrite={false} />
        </mesh>
      ))}
    </group>
  )
}

/**
 * The procedural truck body (asset manifest fallbackKey: FoodTruckMesh).
 * Serving window faces +z. Pure visuals — the collider lives in CityColliders.
 */
export function FoodTruckMesh() {
  return (
    <>
      {/* Truck body */}
      <mesh position={[0, 1.25, 0]} castShadow>
        <boxGeometry args={[4.4, 1.9, 2.4]} />
        <meshStandardMaterial color={FOOD_TRUCK.bodyColor} roughness={0.5} />
      </mesh>
      {/* Cab at the west end */}
      <mesh position={[-2.6, 0.85, 0]} castShadow>
        <boxGeometry args={[1.1, 1.1, 2.2]} />
        <meshStandardMaterial color={FOOD_TRUCK.bodyColor} roughness={0.5} />
      </mesh>
      <mesh position={[-2.75, 1.15, 0]}>
        <boxGeometry args={[0.5, 0.5, 1.9]} />
        <meshStandardMaterial color="#cfe3ea" roughness={0.2} />
      </mesh>
      {/* Wheels */}
      {[
        [-2.6, 0.85],
        [1.4, 0.85],
        [-2.6, -0.85],
        [1.4, -0.85],
      ].map(([x, z], i) => (
        <mesh key={i} position={[x, 0.35, z]} rotation-x={Math.PI / 2}>
          <cylinderGeometry args={[0.35, 0.35, 0.3, 12]} />
          <meshStandardMaterial color="#26262c" />
        </mesh>
      ))}
      {/* Serving window (south face) */}
      <mesh position={[0.3, 1.45, 1.22]}>
        <planeGeometry args={[2.2, 0.9]} />
        <meshStandardMaterial color="#4a3b30" />
      </mesh>
      {/* Counter shelf under the window */}
      <mesh position={[0.3, 0.95, 1.35]} castShadow>
        <boxGeometry args={[2.4, 0.08, 0.35]} />
        <meshStandardMaterial color={FOOD_TRUCK.trimColor} />
      </mesh>
      {/* Awning above the window */}
      <mesh position={[0.3, 2.25, 1.5]} rotation-x={0.4} castShadow>
        <boxGeometry args={[2.8, 0.08, 0.9]} />
        <meshStandardMaterial color={FOOD_TRUCK.trimColor} />
      </mesh>
      {/* Rooftop sign */}
      <mesh position={[0, 2.55, 0]} castShadow>
        <boxGeometry args={[2.6, 0.6, 0.25]} />
        <meshStandardMaterial color={FOOD_TRUCK.trimColor} />
      </mesh>
      {/* Kitchen vent */}
      <mesh position={[-1.4, 2.35, -0.5]}>
        <cylinderGeometry args={[0.14, 0.18, 0.5, 8]} />
        <meshStandardMaterial color="#8d939c" />
      </mesh>
    </>
  )
}

/** Maya's snack truck: the social heart of the block. Serving window faces +z. */
export function FoodTruck() {
  return (
    <group
      name={FOOD_TRUCK.id}
      position={[FOOD_TRUCK.position[0], 0, FOOD_TRUCK.position[1]]}
      rotation-y={FOOD_TRUCK.rotationY}
    >
      {/* Swappable visual: GLB from the manifest when enabled, else FoodTruckMesh. */}
      <LandmarkAsset assetId={FOOD_TRUCK.id}>
        <FoodTruckMesh />
      </LandmarkAsset>
      {/* Ambience stays regardless of which visual renders. */}
      <Smoke />
      {/* Cozy warm light spilling from the serving window */}
      <pointLight position={[0.3, 1.8, 2]} intensity={6} distance={7} color="#ffc27a" />
    </group>
  )
}
