import * as THREE from 'three'
import { headlightMaterial, taillightMaterial } from '../world/materials'

// Geometry/material shared across every car instance (drivable, ambient,
// parked) — one allocation each instead of one per car.
const bodyGeometry = new THREE.BoxGeometry(2, 0.62, 3.9)
const cabinGeometry = new THREE.BoxGeometry(1.7, 0.55, 1.9)
const wheelGeometry = new THREE.CylinderGeometry(0.34, 0.34, 0.28, 14)
const lightGeometry = new THREE.BoxGeometry(0.34, 0.2, 0.08)
const driverGeometry = new THREE.SphereGeometry(0.24, 12, 12)
const cabinMaterial = new THREE.MeshStandardMaterial({
  color: '#d7e6ee',
  roughness: 0.15,
  metalness: 0.3,
})
const wheelMaterial = new THREE.MeshStandardMaterial({ color: '#26262c', roughness: 0.9 })
const driverMaterial = new THREE.MeshStandardMaterial({ color: '#ffd7b0' })

// Body materials cached per paint color (a handful of colors total).
const bodyMaterials = new Map<string, THREE.MeshStandardMaterial>()
function bodyMaterialFor(color: string): THREE.MeshStandardMaterial {
  let mat = bodyMaterials.get(color)
  if (!mat) {
    mat = new THREE.MeshStandardMaterial({ color, roughness: 0.4, metalness: 0.15 })
    bodyMaterials.set(color, mat)
  }
  return mat
}

const WHEEL_POSITIONS: [number, number][] = [
  [-0.92, 1.25],
  [0.92, 1.25],
  [-0.92, -1.25],
  [0.92, -1.25],
]

/**
 * Shared low-poly car body used by the drivable car, ambient cars and parked
 * cars. Nose faces +z. Roughly 2 wide × 1.6 tall × 3.9 long.
 */
export function CarMesh({ color, showDriver = false }: { color: string; showDriver?: boolean }) {
  return (
    <group name="car-mesh">
      <mesh geometry={bodyGeometry} material={bodyMaterialFor(color)} position={[0, 0.55, 0]} castShadow />
      <mesh geometry={cabinGeometry} material={cabinMaterial} position={[0, 1.08, -0.35]} castShadow />
      {WHEEL_POSITIONS.map(([x, z], i) => (
        <mesh
          key={i}
          geometry={wheelGeometry}
          material={wheelMaterial}
          position={[x, 0.34, z]}
          rotation-z={Math.PI / 2}
        />
      ))}
      {/* Headlights (front, +z) and taillights */}
      <mesh geometry={lightGeometry} material={headlightMaterial} position={[-0.6, 0.58, 1.96]} />
      <mesh geometry={lightGeometry} material={headlightMaterial} position={[0.6, 0.58, 1.96]} />
      <mesh
        name="taillight"
        geometry={lightGeometry}
        material={taillightMaterial}
        position={[-0.6, 0.58, -1.96]}
      />
      <mesh
        name="taillight"
        geometry={lightGeometry}
        material={taillightMaterial}
        position={[0.6, 0.58, -1.96]}
      />
      {showDriver && (
        <mesh geometry={driverGeometry} material={driverMaterial} position={[0, 1.25, -0.2]} />
      )}
    </group>
  )
}
