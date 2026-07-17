import { useRef } from 'react'
import * as THREE from 'three'
import { useFrame, useThree } from '@react-three/fiber'
import { CuboidCollider, RigidBody } from '@react-three/rapier'
import {
  APARTMENT_FURNITURE,
  INTERIOR_ORIGIN,
  ROOM_DEPTH,
  ROOM_WIDTH,
  WALL_HEIGHT,
  WALL_THICKNESS,
} from './apartmentLayout'
import { useGameStore } from '../store/useGameStore'

const [OX, OZ] = INTERIOR_ORIGIN
const HW = ROOM_WIDTH / 2
const HD = ROOM_DEPTH / 2

/* Shared materials — one per surface family, reused by every mesh. */
const floorMaterial = new THREE.MeshStandardMaterial({ color: '#c89b6c', roughness: 0.85 })
const plankMaterial = new THREE.MeshStandardMaterial({ color: '#b78a5d', roughness: 0.85 })
const wallMaterial = new THREE.MeshStandardMaterial({ color: '#e9dcc7', roughness: 0.95 })
const accentWallMaterial = new THREE.MeshStandardMaterial({ color: '#a86f6f', roughness: 0.95 })
const baseboardMaterial = new THREE.MeshStandardMaterial({ color: '#8a6a4e', roughness: 0.9 })
const woodMaterial = new THREE.MeshStandardMaterial({ color: '#9a6b45', roughness: 0.8 })
const woodDarkMaterial = new THREE.MeshStandardMaterial({ color: '#7c5233', roughness: 0.8 })
const beddingMaterial = new THREE.MeshStandardMaterial({ color: '#7a9cc6', roughness: 0.9 })
const pillowMaterial = new THREE.MeshStandardMaterial({ color: '#f2ede2', roughness: 0.95 })
const rugMaterial = new THREE.MeshStandardMaterial({ color: '#c96f6f', roughness: 0.95 })
const rugInnerMaterial = new THREE.MeshStandardMaterial({ color: '#e8b98a', roughness: 0.95 })
const mirrorMaterial = new THREE.MeshStandardMaterial({
  color: '#bcd6e8',
  roughness: 0.1,
  metalness: 0.6,
})
const plantPotMaterial = new THREE.MeshStandardMaterial({ color: '#b3573f', roughness: 0.9 })
const plantMaterial = new THREE.MeshStandardMaterial({ color: '#5e9e4e', roughness: 0.9 })
const shadeMaterial = new THREE.MeshStandardMaterial({
  color: '#f2b263',
  roughness: 0.8,
  emissive: '#ffb45e',
  emissiveIntensity: 0.55,
})
const doorMaterial = new THREE.MeshStandardMaterial({ color: '#7c5233', roughness: 0.8 })
const posterAMaterial = new THREE.MeshStandardMaterial({ color: '#7a9cc6', roughness: 0.95 })
const posterBMaterial = new THREE.MeshStandardMaterial({ color: '#e07a5f', roughness: 0.95 })
// The window pane tracks the live sky (time of day AND weather tint), so a
// rainy evening really reads as rain on the glass.
const windowPaneMaterial = new THREE.MeshStandardMaterial({
  color: '#a8ddff',
  emissive: '#a8ddff',
  emissiveIntensity: 0.55,
  roughness: 0.3,
})

function positionOf(id: string): [number, number] {
  const f = APARTMENT_FURNITURE.find((f) => f.id === id)!
  return [OX + f.position[0], OZ + f.position[1]]
}

function Bed() {
  const [x, z] = positionOf('bed')
  return (
    <group position={[x, 0, z]}>
      <mesh material={woodDarkMaterial} position={[0, 0.22, 0]} castShadow>
        <boxGeometry args={[2.1, 0.44, 3.3]} />
      </mesh>
      <mesh material={beddingMaterial} position={[0, 0.5, 0.25]} castShadow>
        <boxGeometry args={[1.9, 0.24, 2.6]} />
      </mesh>
      <mesh material={pillowMaterial} position={[0, 0.56, -1.15]} castShadow>
        <boxGeometry args={[1.5, 0.2, 0.7]} />
      </mesh>
      {/* headboard against the north wall side */}
      <mesh material={woodDarkMaterial} position={[0, 0.75, -1.6]}>
        <boxGeometry args={[2.1, 1.1, 0.12]} />
      </mesh>
    </group>
  )
}

function Wardrobe() {
  const [x, z] = positionOf('wardrobe')
  return (
    <group position={[x, 0, z]}>
      <mesh material={woodMaterial} position={[0, 1.15, 0]} castShadow>
        <boxGeometry args={[1.9, 2.3, 0.8]} />
      </mesh>
      {/* door seam + handles */}
      <mesh material={woodDarkMaterial} position={[0, 1.15, 0.41]}>
        <boxGeometry args={[0.04, 2.1, 0.02]} />
      </mesh>
      <mesh material={woodDarkMaterial} position={[-0.14, 1.15, 0.42]}>
        <boxGeometry args={[0.06, 0.3, 0.04]} />
      </mesh>
      <mesh material={woodDarkMaterial} position={[0.14, 1.15, 0.42]}>
        <boxGeometry args={[0.06, 0.3, 0.04]} />
      </mesh>
    </group>
  )
}

function Mirror() {
  const [x, z] = positionOf('mirror')
  return (
    <group position={[x, 0, z]}>
      <mesh material={woodDarkMaterial} position={[0, 1.5, 0]}>
        <boxGeometry args={[0.76, 1.6, 0.06]} />
      </mesh>
      <mesh material={mirrorMaterial} position={[0, 1.5, 0.04]}>
        <boxGeometry args={[0.6, 1.44, 0.02]} />
      </mesh>
    </group>
  )
}

function StorageChest() {
  const [x, z] = positionOf('storage')
  return (
    <group position={[x, 0, z]}>
      <mesh material={woodMaterial} position={[0, 0.42, 0]} castShadow>
        <boxGeometry args={[1.4, 0.84, 1.0]} />
      </mesh>
      <mesh material={woodDarkMaterial} position={[0, 0.87, 0]}>
        <boxGeometry args={[1.46, 0.1, 1.06]} />
      </mesh>
      <mesh material={baseboardMaterial} position={[0, 0.6, 0.51]}>
        <boxGeometry args={[0.25, 0.16, 0.04]} />
      </mesh>
    </group>
  )
}

function DeskAndChair() {
  const [dx, dz] = positionOf('desk')
  const [cx, cz] = positionOf('chair')
  return (
    <group>
      <group position={[dx, 0, dz]}>
        <mesh material={woodMaterial} position={[0, 0.78, 0]} castShadow>
          <boxGeometry args={[1.0, 0.08, 2.2]} />
        </mesh>
        {[-0.4, 0.4].map((ox) =>
          [-0.95, 0.95].map((oz) => (
            <mesh key={`${ox}${oz}`} material={woodDarkMaterial} position={[ox, 0.38, oz]}>
              <boxGeometry args={[0.08, 0.76, 0.08]} />
            </mesh>
          )),
        )}
        {/* a little notebook + mug */}
        <mesh material={pillowMaterial} position={[0.1, 0.84, -0.4]} rotation-y={0.4}>
          <boxGeometry args={[0.34, 0.04, 0.26]} />
        </mesh>
        <mesh material={rugMaterial} position={[-0.15, 0.88, 0.35]}>
          <cylinderGeometry args={[0.07, 0.07, 0.12, 10]} />
        </mesh>
      </group>
      <group position={[cx, 0, cz]}>
        <mesh material={woodDarkMaterial} position={[0, 0.42, 0]} castShadow>
          <boxGeometry args={[0.5, 0.08, 0.5]} />
        </mesh>
        <mesh material={woodDarkMaterial} position={[-0.23, 0.7, 0]}>
          <boxGeometry args={[0.06, 0.7, 0.5]} />
        </mesh>
        {[-0.2, 0.2].map((oz) => (
          <mesh key={oz} material={woodDarkMaterial} position={[0.18, 0.2, oz]}>
            <boxGeometry args={[0.06, 0.4, 0.06]} />
          </mesh>
        ))}
      </group>
    </group>
  )
}

function LampAndPlant() {
  const [lx, lz] = positionOf('lamp')
  const [px, pz] = positionOf('plant')
  const location = useGameStore((s) => s.location)
  return (
    <group>
      <group position={[lx, 0, lz]}>
        <mesh material={woodDarkMaterial} position={[0, 0.05, 0]}>
          <cylinderGeometry args={[0.24, 0.28, 0.1, 10]} />
        </mesh>
        <mesh material={woodDarkMaterial} position={[0, 0.85, 0]}>
          <cylinderGeometry args={[0.04, 0.04, 1.6, 8]} />
        </mesh>
        <mesh material={shadeMaterial} position={[0, 1.75, 0]} castShadow>
          <coneGeometry args={[0.34, 0.42, 12, 1, true]} />
        </mesh>
        {/* Warm fill light, only paid for while the player is inside. */}
        {location === 'apartment' && (
          <pointLight position={[0, 1.9, 0]} intensity={14} distance={12} color="#ffd9a0" />
        )}
      </group>
      <group position={[px, 0, pz]}>
        <mesh material={plantPotMaterial} position={[0, 0.25, 0]} castShadow>
          <cylinderGeometry args={[0.24, 0.3, 0.5, 10]} />
        </mesh>
        <mesh material={plantMaterial} position={[0, 0.75, 0]} castShadow>
          <sphereGeometry args={[0.34, 10, 10]} />
        </mesh>
        <mesh material={plantMaterial} position={[0.15, 1.0, 0.05]}>
          <sphereGeometry args={[0.2, 8, 8]} />
        </mesh>
      </group>
    </group>
  )
}

function WindowPosterDoor() {
  const [wx, wz] = positionOf('window')
  const [pax, paz] = positionOf('poster_a')
  const [pbx, pbz] = positionOf('poster_b')
  const [dx, dz] = positionOf('door')
  const scene = useThree((s) => s.scene)
  const pane = useRef<THREE.Mesh>(null)

  useFrame(() => {
    // Mirror the live sky color (already tinted by weather) onto the glass.
    if (scene.background instanceof THREE.Color && pane.current) {
      const m = pane.current.material as THREE.MeshStandardMaterial
      m.color.copy(scene.background)
      m.emissive.copy(scene.background)
    }
  })

  return (
    <group>
      {/* Window on the north wall: frame, cross bar, sky-lit pane */}
      <group position={[wx, 2.1, wz]}>
        <mesh material={woodDarkMaterial}>
          <boxGeometry args={[1.9, 1.5, 0.1]} />
        </mesh>
        <mesh ref={pane} material={windowPaneMaterial} position={[0, 0, 0.04]}>
          <boxGeometry args={[1.66, 1.26, 0.03]} />
        </mesh>
        <mesh material={woodDarkMaterial} position={[0, 0, 0.07]}>
          <boxGeometry args={[0.06, 1.26, 0.02]} />
        </mesh>
        <mesh material={woodDarkMaterial} position={[0, 0, 0.07]}>
          <boxGeometry args={[1.66, 0.06, 0.02]} />
        </mesh>
      </group>
      {/* Posters */}
      <mesh material={posterAMaterial} position={[pax, 2.5, paz]}>
        <boxGeometry args={[0.6, 0.85, 0.04]} />
      </mesh>
      <mesh material={posterBMaterial} position={[pbx, 1.95, pbz]} rotation-z={0.05}>
        <boxGeometry args={[0.7, 0.5, 0.04]} />
      </mesh>
      {/* Door on the south edge (low wall side) — frame + slab */}
      <group position={[dx, 0, dz]}>
        <mesh material={doorMaterial} position={[0, 1.1, 0]}>
          <boxGeometry args={[1.1, 2.2, 0.14]} />
        </mesh>
        <mesh material={baseboardMaterial} position={[-0.35, 1.05, 0.09]}>
          <sphereGeometry args={[0.06, 8, 8]} />
        </mesh>
      </group>
    </group>
  )
}

function Rug() {
  const [x, z] = positionOf('rug')
  return (
    <group position={[x, 0.045, z]} rotation-x={-Math.PI / 2}>
      <mesh material={rugMaterial}>
        <circleGeometry args={[1.9, 24]} />
      </mesh>
      <mesh material={rugInnerMaterial} position={[0, 0, 0.005]}>
        <circleGeometry args={[1.3, 24]} />
      </mesh>
    </group>
  )
}

/**
 * The cozy studio interior. Always mounted: it sits far outside the city
 * bounds, costs a handful of shared-material meshes, and never appears in
 * outdoor shots. The lamp's point light only turns on while inside.
 */
export function ApartmentInterior() {
  return (
    <group name="apartment-interior">
      {/* Floor with a couple of darker planks for texture */}
      <mesh material={floorMaterial} rotation-x={-Math.PI / 2} position={[OX, 0.02, OZ]} receiveShadow>
        <planeGeometry args={[ROOM_WIDTH, ROOM_DEPTH]} />
      </mesh>
      {[-3.2, -0.8, 1.6, 4].map((px) => (
        <mesh key={px} material={plankMaterial} rotation-x={-Math.PI / 2} position={[OX + px, 0.03, OZ]}>
          <planeGeometry args={[0.5, ROOM_DEPTH]} />
        </mesh>
      ))}

      {/* North (accent) + west walls form the diorama backdrop; the south and
          east sides stay open as low baseboards so the camera sees inside. */}
      <mesh material={accentWallMaterial} position={[OX, WALL_HEIGHT / 2, OZ - HD - WALL_THICKNESS / 2]}>
        <boxGeometry args={[ROOM_WIDTH + WALL_THICKNESS * 2, WALL_HEIGHT, WALL_THICKNESS]} />
      </mesh>
      <mesh material={wallMaterial} position={[OX - HW - WALL_THICKNESS / 2, WALL_HEIGHT / 2, OZ]}>
        <boxGeometry args={[WALL_THICKNESS, WALL_HEIGHT, ROOM_DEPTH]} />
      </mesh>
      <mesh material={baseboardMaterial} position={[OX, 0.22, OZ + HD + WALL_THICKNESS / 2]}>
        <boxGeometry args={[ROOM_WIDTH + WALL_THICKNESS * 2, 0.44, WALL_THICKNESS]} />
      </mesh>
      <mesh material={baseboardMaterial} position={[OX + HW + WALL_THICKNESS / 2, 0.22, OZ]}>
        <boxGeometry args={[WALL_THICKNESS, 0.44, ROOM_DEPTH]} />
      </mesh>

      <Rug />
      <Bed />
      <Wardrobe />
      <Mirror />
      <StorageChest />
      <DeskAndChair />
      <LampAndPlant />
      <WindowPosterDoor />
    </group>
  )
}

/** Static physics for the interior: room shell + solid furniture. */
export function ApartmentColliders() {
  return (
    <RigidBody type="fixed" colliders={false}>
      {/* Floor */}
      <CuboidCollider args={[HW + 1, 0.5, HD + 1]} position={[OX, -0.5, OZ]} />
      {/* Four walls (invisible on the open south/east sides, so the player
          can't wander off the diorama) */}
      <CuboidCollider args={[HW + 0.5, 2, WALL_THICKNESS]} position={[OX, 2, OZ - HD - 0.15]} />
      <CuboidCollider args={[HW + 0.5, 2, WALL_THICKNESS]} position={[OX, 2, OZ + HD + 0.15]} />
      <CuboidCollider args={[WALL_THICKNESS, 2, HD + 0.5]} position={[OX - HW - 0.15, 2, OZ]} />
      <CuboidCollider args={[WALL_THICKNESS, 2, HD + 0.5]} position={[OX + HW + 0.15, 2, OZ]} />
      {/* Solid furniture from the layout data */}
      {APARTMENT_FURNITURE.filter((f) => f.solid && f.colliderHalf).map((f) => (
        <CuboidCollider
          key={f.id}
          args={f.colliderHalf!}
          position={[OX + f.position[0], f.colliderHalf![1], OZ + f.position[1]]}
          rotation={[0, f.rotationY ?? 0, 0]}
        />
      ))}
    </RigidBody>
  )
}
