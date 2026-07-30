import * as THREE from 'three'
import { CuboidCollider, RigidBody } from '@react-three/rapier'
import {
  LOFT_ORIGIN,
  LOFT_ROOM_WIDTH,
  LOFT_ROOM_DEPTH,
  LOFT_WALL_HEIGHT,
  LOFT_WALL_THICKNESS,
} from './loftLayout'
import {
  PREMIUM_ORIGIN,
  PREMIUM_ROOM_WIDTH,
  PREMIUM_ROOM_DEPTH,
  PREMIUM_WALL_HEIGHT,
  PREMIUM_WALL_THICKNESS,
} from './premiumLayout'

/**
 * City Loft + Premium Apartment interiors (issue #17 §4). Same always-mounted,
 * far-off-grid diorama contract as the Studio (ApartmentInterior): a floor + a
 * north/west wall backdrop with the south/east sides left open as baseboards so
 * the follow camera sees inside. Furniture the player OWNS is rendered separately
 * by the placement renderer (issue §6); this file draws only the fixed shell +
 * a few authored fixtures. Distinct palettes make each tier read as a step up.
 */

interface Palette {
  floor: string
  plank: string
  wall: string
  accent: string
  base: string
  fixture: string
  fixtureDark: string
  window: string
}

const LOFT_PALETTE: Palette = {
  floor: '#b9a488',
  plank: '#ab967a',
  wall: '#e7e0d4',
  accent: '#6f8394',
  base: '#7c6f5e',
  fixture: '#8a8f96',
  fixtureDark: '#5c6066',
  window: '#bfe0f2',
}
const PREMIUM_PALETTE: Palette = {
  floor: '#8f8577',
  plank: '#7f7568',
  wall: '#efe9df',
  accent: '#4a5560',
  base: '#3f4650',
  fixture: '#c9a86a',
  fixtureDark: '#8a7038',
  window: '#cfe8f6',
}

function mats(p: Palette) {
  return {
    floor: new THREE.MeshStandardMaterial({ color: p.floor, roughness: 0.85 }),
    plank: new THREE.MeshStandardMaterial({ color: p.plank, roughness: 0.85 }),
    wall: new THREE.MeshStandardMaterial({ color: p.wall, roughness: 0.95 }),
    accent: new THREE.MeshStandardMaterial({ color: p.accent, roughness: 0.95 }),
    base: new THREE.MeshStandardMaterial({ color: p.base, roughness: 0.9 }),
    fixture: new THREE.MeshStandardMaterial({ color: p.fixture, roughness: 0.6, metalness: 0.2 }),
    fixtureDark: new THREE.MeshStandardMaterial({ color: p.fixtureDark, roughness: 0.7 }),
    window: new THREE.MeshStandardMaterial({ color: p.window, emissive: p.window, emissiveIntensity: 0.4, roughness: 0.3 }),
  }
}
const LOFT_MATS = mats(LOFT_PALETTE)
const PREMIUM_MATS = mats(PREMIUM_PALETTE)

interface Dims {
  origin: readonly [number, number]
  width: number
  depth: number
  wallHeight: number
  wallThickness: number
}
const LOFT_DIMS: Dims = { origin: LOFT_ORIGIN, width: LOFT_ROOM_WIDTH, depth: LOFT_ROOM_DEPTH, wallHeight: LOFT_WALL_HEIGHT, wallThickness: LOFT_WALL_THICKNESS }
const PREMIUM_DIMS: Dims = { origin: PREMIUM_ORIGIN, width: PREMIUM_ROOM_WIDTH, depth: PREMIUM_ROOM_DEPTH, wallHeight: PREMIUM_WALL_HEIGHT, wallThickness: PREMIUM_WALL_THICKNESS }

/** Floor + north/west walls + south/east baseboards + big windows + a kitchen block. */
function HomeShell({ dims, m, luxe }: { dims: Dims; m: ReturnType<typeof mats>; luxe: boolean }) {
  const [OX, OZ] = dims.origin
  const HW = dims.width / 2
  const HD = dims.depth / 2
  const WT = dims.wallThickness
  const WH = dims.wallHeight
  const planks = [-HW * 0.6, -HW * 0.2, HW * 0.2, HW * 0.6]
  return (
    <group>
      <mesh material={m.floor} rotation-x={-Math.PI / 2} position={[OX, 0.02, OZ]} receiveShadow>
        <planeGeometry args={[dims.width, dims.depth]} />
      </mesh>
      {planks.map((px) => (
        <mesh key={px} material={m.plank} rotation-x={-Math.PI / 2} position={[OX + px, 0.03, OZ]}>
          <planeGeometry args={[0.5, dims.depth]} />
        </mesh>
      ))}
      {/* North accent wall + west wall (backdrop). South/east stay low baseboards. */}
      <mesh material={m.accent} position={[OX, WH / 2, OZ - HD - WT / 2]}>
        <boxGeometry args={[dims.width + WT * 2, WH, WT]} />
      </mesh>
      <mesh material={m.wall} position={[OX - HW - WT / 2, WH / 2, OZ]}>
        <boxGeometry args={[WT, WH, dims.depth]} />
      </mesh>
      <mesh material={m.base} position={[OX, 0.22, OZ + HD + WT / 2]}>
        <boxGeometry args={[dims.width + WT * 2, 0.44, WT]} />
      </mesh>
      <mesh material={m.base} position={[OX + HW + WT / 2, 0.22, OZ]}>
        <boxGeometry args={[WT, 0.44, dims.depth]} />
      </mesh>
      {/* Big picture windows on the north wall (fixture: light + view). */}
      {[-HW * 0.5, HW * 0.4].map((wx) => (
        <mesh key={wx} material={m.window} position={[OX + wx, WH * 0.55, OZ - HD - WT * 0.1]}>
          <boxGeometry args={[luxe ? 2.6 : 2.0, WH * 0.6, 0.08]} />
        </mesh>
      ))}
      {/* Kitchen counter block against the east baseboard (fixed fixture). */}
      <group position={[OX + HW - 0.7, 0, OZ - HD * 0.2]}>
        <mesh material={m.fixtureDark} position={[0, 0.45, 0]} castShadow>
          <boxGeometry args={[1.1, 0.9, dims.depth * 0.4]} />
        </mesh>
        <mesh material={m.fixture} position={[0, 0.92, 0]}>
          <boxGeometry args={[1.2, 0.08, dims.depth * 0.42]} />
        </mesh>
      </group>
      {luxe && (
        // Premium: a kitchen island centrepiece.
        <group position={[OX + HW * 0.2, 0, OZ + HD * 0.15]}>
          <mesh material={m.fixtureDark} position={[0, 0.45, 0]} castShadow>
            <boxGeometry args={[1.8, 0.9, 1.0]} />
          </mesh>
          <mesh material={m.fixture} position={[0, 0.92, 0]}>
            <boxGeometry args={[2.0, 0.08, 1.2]} />
          </mesh>
        </group>
      )}
    </group>
  )
}

function ShellColliders({ dims }: { dims: Dims }) {
  const [OX, OZ] = dims.origin
  const HW = dims.width / 2
  const HD = dims.depth / 2
  const WT = dims.wallThickness
  return (
    <RigidBody type="fixed" colliders={false}>
      <CuboidCollider args={[HW + 1, 0.5, HD + 1]} position={[OX, -0.5, OZ]} />
      <CuboidCollider args={[HW + 0.5, 2, WT]} position={[OX, 2, OZ - HD - 0.15]} />
      <CuboidCollider args={[HW + 0.5, 2, WT]} position={[OX, 2, OZ + HD + 0.15]} />
      <CuboidCollider args={[WT, 2, HD + 0.5]} position={[OX - HW - 0.15, 2, OZ]} />
      <CuboidCollider args={[WT, 2, HD + 0.5]} position={[OX + HW + 0.15, 2, OZ]} />
    </RigidBody>
  )
}

export function HomeInteriors() {
  return (
    <group name="home-interiors">
      <group name="city-loft-interior">
        <HomeShell dims={LOFT_DIMS} m={LOFT_MATS} luxe={false} />
      </group>
      <group name="premium-apartment-interior">
        <HomeShell dims={PREMIUM_DIMS} m={PREMIUM_MATS} luxe />
      </group>
    </group>
  )
}

export function HomeColliders() {
  return (
    <>
      <ShellColliders dims={LOFT_DIMS} />
      <ShellColliders dims={PREMIUM_DIMS} />
    </>
  )
}
