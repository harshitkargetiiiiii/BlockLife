import { useRef } from 'react'
import * as THREE from 'three'
import { useFrame } from '@react-three/fiber'
import { PROPS, JOB_KIOSK } from './cityLayout'
import type { PropDef } from './worldTypes'
import { lampBulbMaterial, lampGlowMaterial } from './materials'
import { CarMesh } from '../vehicles/CarMesh'
import { useGameStore } from '../store/useGameStore'
import { LandmarkAsset } from '../assets/LandmarkAsset'
import { getManifestEntry } from '../assets/modelRegistry'
import { STREET_PROP_ASSET_IDS } from './propAssetIds'

// Repeated props share geometry + materials: one allocation per shape for
// the whole city (11 trees, 9 lamps, 3 benches, 3 cans, ...).
const lampPoleGeometry = new THREE.CylinderGeometry(0.07, 0.1, 3.8, 8)
/** The one shared bulb sphere; a lamp head of another size scales it rather than allocating. */
const LAMP_BULB_RADIUS = 0.26
/** Where the bulb sits on the PROCEDURAL pole (unchanged since the lamp was authored). */
const PROCEDURAL_LAMP_BULB: [number, number, number] = [0, 3.85, 0]
const lampBulbGeometry = new THREE.SphereGeometry(LAMP_BULB_RADIUS, 12, 12)
const lampGlowGeometry = new THREE.CircleGeometry(1.7, 20)
const lampPoleMaterial = new THREE.MeshStandardMaterial({ color: '#3c4048' })

const trunkGeometry = new THREE.CylinderGeometry(0.15, 0.22, 1, 8)
const foliageGeometry = new THREE.SphereGeometry(1.05, 12, 10)
const foliageTopGeometry = new THREE.SphereGeometry(0.65, 10, 8)
const trunkMaterial = new THREE.MeshStandardMaterial({ color: '#7a5230' })
const foliageMaterial = new THREE.MeshStandardMaterial({ color: '#5e9e4e', roughness: 0.9 })
const foliageTopMaterial = new THREE.MeshStandardMaterial({ color: '#6fae57', roughness: 0.9 })

const woodMaterial = new THREE.MeshStandardMaterial({ color: '#a8703f' })
const ironMaterial = new THREE.MeshStandardMaterial({ color: '#44484f' })

/**
 * The FUNCTIONAL night illumination of a street lamp: the emissive bulb in the lamp head plus
 * the warm pool it casts on the ground. Both use the shared city materials that
 * `updateGlowMaterials` drives once per frame, so this adds no light source and no per-lamp
 * cost — it is the same two meshes the lamp has always rendered.
 *
 * It is a separate component because the lamp BODY can now come from a GLB (issue #42) that is
 * geometry only. The head is not in the same place on both bodies, so the caller supplies where
 * this one's bulb sits; the ground pool is cast from the prop's own origin either way.
 */
function StreetLampLight({
  bulbPosition,
  bulbRadius,
}: {
  bulbPosition: [number, number, number]
  bulbRadius: number
}) {
  return (
    <>
      <mesh
        name="street_lamp-bulb"
        geometry={lampBulbGeometry}
        material={lampBulbMaterial}
        position={bulbPosition}
        scale={bulbRadius / LAMP_BULB_RADIUS}
      />
      {/* Warm pool of light on the ground at night */}
      <mesh
        name="street_lamp-glow"
        geometry={lampGlowGeometry}
        material={lampGlowMaterial}
        rotation-x={-Math.PI / 2}
        position={[0, 0.09, 0]}
      />
    </>
  )
}

/**
 * The complete procedural street lamp — pole + light. Still the authoritative visual: it is the
 * LandmarkAsset fallback for a missing, disabled, still-loading or broken streetlight GLB, and
 * it renders exactly as it always has (bulb at 3.85, unit-scaled shared sphere).
 */
function StreetLamp() {
  return (
    <group>
      <mesh
        name="street_lamp-pole"
        geometry={lampPoleGeometry}
        material={lampPoleMaterial}
        position={[0, 1.9, 0]}
        castShadow
      />
      <StreetLampLight bulbPosition={PROCEDURAL_LAMP_BULB} bulbRadius={LAMP_BULB_RADIUS} />
    </group>
  )
}

/**
 * The GLB streetlight's light, read from the manifest entry's measured lantern anchor. Falls
 * back to the procedural placement if the entry is ever missing one, so a lamp is never dark.
 */
function GlbStreetLampLight() {
  const light = getManifestEntry(STREET_PROP_ASSET_IDS.street_lamp!)?.nightLight
  return (
    <StreetLampLight
      bulbPosition={light?.position ?? PROCEDURAL_LAMP_BULB}
      bulbRadius={light?.bulbRadius ?? LAMP_BULB_RADIUS}
    />
  )
}

function TreeMesh({ trunkHeight = 1.1 }: { trunkHeight?: number }) {
  return (
    <>
      <mesh
        geometry={trunkGeometry}
        material={trunkMaterial}
        position={[0, trunkHeight / 2, 0]}
        scale={[1, trunkHeight, 1]}
        castShadow
      />
      <mesh
        geometry={foliageGeometry}
        material={foliageMaterial}
        position={[0, trunkHeight + 0.9, 0]}
        castShadow
      />
      <mesh
        geometry={foliageTopGeometry}
        material={foliageTopMaterial}
        position={[0.35, trunkHeight + 1.55, 0.15]}
        castShadow
      />
    </>
  )
}

/** Park trees sway gently; street trees stand still. */
function SwayingTree({ seed }: { seed: number }) {
  const group = useRef<THREE.Group>(null)
  useFrame(({ clock }) => {
    if (!group.current) return
    if (useGameStore.getState().worldPaused) {
      group.current.rotation.z = 0
      return
    }
    group.current.rotation.z = Math.sin(clock.elapsedTime * 0.9 + seed) * 0.035
  })
  return (
    <group ref={group}>
      <TreeMesh trunkHeight={1.3} />
    </group>
  )
}

function Bench() {
  return (
    <group>
      <mesh material={woodMaterial} position={[0, 0.45, 0]} castShadow>
        <boxGeometry args={[1.8, 0.1, 0.55]} />
      </mesh>
      <mesh material={woodMaterial} position={[0, 0.78, -0.25]} rotation-x={-0.18} castShadow>
        <boxGeometry args={[1.8, 0.55, 0.08]} />
      </mesh>
      {[-0.75, 0.75].map((x) => (
        <mesh key={x} material={ironMaterial} position={[x, 0.2, 0]}>
          <boxGeometry args={[0.1, 0.4, 0.5]} />
        </mesh>
      ))}
    </group>
  )
}

function TrashCan() {
  return (
    <group name="trash_can-fallback">
      <mesh position={[0, 0.42, 0]} castShadow>
        <cylinderGeometry args={[0.3, 0.26, 0.84, 10]} />
        <meshStandardMaterial color="#4f6a5a" />
      </mesh>
      <mesh position={[0, 0.88, 0]}>
        <cylinderGeometry args={[0.32, 0.32, 0.08, 10]} />
        <meshStandardMaterial color="#3a4f43" />
      </mesh>
    </group>
  )
}

function Hydrant({ color = '#d1495b' }: { color?: string }) {
  return (
    <group name="hydrant-fallback">
      <mesh position={[0, 0.3, 0]} castShadow>
        <cylinderGeometry args={[0.16, 0.2, 0.6, 8]} />
        <meshStandardMaterial color={color} />
      </mesh>
      <mesh position={[0, 0.62, 0]}>
        <sphereGeometry args={[0.14, 8, 8]} />
        <meshStandardMaterial color={color} />
      </mesh>
    </group>
  )
}

function Planter() {
  return (
    <group>
      <mesh position={[0, 0.25, 0]} castShadow>
        <boxGeometry args={[1.4, 0.5, 0.55]} />
        <meshStandardMaterial color="#8a6b4f" />
      </mesh>
      {[-0.4, 0, 0.4].map((x) => (
        <mesh key={x} material={foliageTopMaterial} position={[x, 0.62, 0]}>
          <sphereGeometry args={[0.22, 8, 8]} />
        </mesh>
      ))}
    </group>
  )
}

/**
 * The procedural kiosk visual (asset manifest fallbackKey: JobKioskMesh).
 * Pure visuals — its collider lives in CityColliders.
 */
export function JobKioskMesh() {
  return (
    <>
      <mesh position={[0, 1.1, 0]} castShadow>
        <boxGeometry args={[1.7, 2.2, 0.5]} />
        <meshStandardMaterial color={JOB_KIOSK.color} />
      </mesh>
      <mesh position={[0, 2.35, 0]} castShadow>
        <boxGeometry args={[2, 0.16, 0.8]} />
        <meshStandardMaterial color="#3e6b6d" />
      </mesh>
      {/* Pinned job posters */}
      <mesh position={[-0.35, 1.3, 0.27]}>
        <planeGeometry args={[0.5, 0.65]} />
        <meshStandardMaterial color="#f6efdb" />
      </mesh>
      <mesh position={[0.35, 1.15, 0.27]}>
        <planeGeometry args={[0.5, 0.5]} />
        <meshStandardMaterial color="#ffd166" />
      </mesh>
      <mesh position={[0.2, 1.75, 0.27]}>
        <planeGeometry args={[0.75, 0.3]} />
        <meshStandardMaterial color="#e8927c" />
      </mesh>
    </>
  )
}

/** The job board kiosk in front of the office — where shifts get picked up. */
function JobKiosk() {
  return (
    <group
      name={JOB_KIOSK.id}
      position={[JOB_KIOSK.position[0], 0, JOB_KIOSK.position[1]]}
      rotation-y={JOB_KIOSK.rotationY}
    >
      <LandmarkAsset assetId={JOB_KIOSK.id}>
        <JobKioskMesh />
      </LandmarkAsset>
    </group>
  )
}

/* ---- Primitive fallbacks for the Quaternius street props ---- */

function ACUnitFallback() {
  return (
    <mesh position={[0, 0.3, 0]} castShadow>
      <boxGeometry args={[0.9, 0.6, 0.35]} />
      <meshStandardMaterial color="#8d939c" roughness={0.8} />
    </mesh>
  )
}

function BollardFallback() {
  return (
    <mesh position={[0, 0.45, 0]} castShadow>
      <cylinderGeometry args={[0.1, 0.11, 0.9, 8]} />
      <meshStandardMaterial color="#3c4048" />
    </mesh>
  )
}

function ManholeFallback() {
  return (
    <mesh rotation-x={-Math.PI / 2} position={[0, 0.028, 0]}>
      <circleGeometry args={[0.46, 14]} />
      <meshStandardMaterial color="#232228" />
    </mesh>
  )
}

function DrainFallback() {
  return (
    <mesh rotation-x={-Math.PI / 2} position={[0, 0.028, 0]}>
      <planeGeometry args={[0.6, 0.6]} />
      <meshStandardMaterial color="#232228" />
    </mesh>
  )
}

/* ---- Procedural district props (City Expansion v1) ---- */

function TrafficCone() {
  return (
    <group>
      <mesh position={[0, 0.28, 0]} castShadow>
        <coneGeometry args={[0.26, 0.56, 10]} />
        <meshStandardMaterial color="#e8702a" />
      </mesh>
      <mesh position={[0, 0.3, 0]}>
        <coneGeometry args={[0.19, 0.2, 10]} />
        <meshStandardMaterial color="#f2f0ec" />
      </mesh>
      <mesh position={[0, 0.02, 0]}>
        <boxGeometry args={[0.5, 0.05, 0.5]} />
        <meshStandardMaterial color="#c9571d" />
      </mesh>
    </group>
  )
}

function UtilityBox({ color = '#4a7fd4' }: { color?: string }) {
  return (
    <group>
      <mesh position={[0, 0.5, 0]} castShadow>
        <boxGeometry args={[0.7, 1, 0.5]} />
        <meshStandardMaterial color={color} roughness={0.7} />
      </mesh>
      <mesh position={[0, 1.03, 0]}>
        <boxGeometry args={[0.76, 0.08, 0.56]} />
        <meshStandardMaterial color="#2c2f36" />
      </mesh>
    </group>
  )
}

function StopSignMesh() {
  return (
    <group>
      <mesh position={[0, 1.25, 0]} castShadow>
        <cylinderGeometry args={[0.05, 0.06, 2.5, 8]} />
        <meshStandardMaterial color="#3c4048" />
      </mesh>
      {/* Octagon face */}
      <mesh position={[0, 2.45, 0]} rotation-x={Math.PI / 2}>
        <cylinderGeometry args={[0.42, 0.42, 0.06, 8]} />
        <meshStandardMaterial color="#d1352b" />
      </mesh>
      <mesh position={[0, 2.45, 0.04]} rotation-x={Math.PI / 2}>
        <cylinderGeometry args={[0.3, 0.3, 0.02, 8]} />
        <meshStandardMaterial color="#f6f2ea" />
      </mesh>
    </group>
  )
}

/* ---- City Life Density v1: street-life texture props (shared pieces) ---- */

const crateGeometry = new THREE.BoxGeometry(0.7, 0.7, 0.7)
const crateMaterial = new THREE.MeshStandardMaterial({ color: '#b48a5a', roughness: 0.95 })
const crateDarkMaterial = new THREE.MeshStandardMaterial({ color: '#96714a', roughness: 0.95 })
const barrelGeometry = new THREE.CylinderGeometry(0.35, 0.35, 0.9, 12)
const barrelMaterial = new THREE.MeshStandardMaterial({ color: '#4a6a8a', roughness: 0.6 })
const palletGeometry = new THREE.BoxGeometry(1.2, 0.14, 1.2)
const palletMaterial = new THREE.MeshStandardMaterial({ color: '#a5824f', roughness: 1 })
const potGeometry = new THREE.CylinderGeometry(0.24, 0.18, 0.4, 10)
const potMaterial = new THREE.MeshStandardMaterial({ color: '#a5623f', roughness: 0.9 })
const bushGeometry = new THREE.SphereGeometry(0.26, 8, 8)
const bushMaterial = new THREE.MeshStandardMaterial({ color: '#6fae57', roughness: 0.9 })

function CrateStack() {
  return (
    <group>
      <mesh geometry={crateGeometry} material={crateMaterial} position={[0, 0.35, 0]} castShadow />
      <mesh
        geometry={crateGeometry}
        material={crateDarkMaterial}
        position={[0.55, 0.35, 0.2]}
        rotation-y={0.4}
        scale={0.85}
        castShadow
      />
      <mesh
        geometry={crateGeometry}
        material={crateMaterial}
        position={[0.2, 0.95, 0.05]}
        rotation-y={-0.3}
        scale={0.7}
        castShadow
      />
    </group>
  )
}

function Barrel() {
  return (
    <group>
      <mesh geometry={barrelGeometry} material={barrelMaterial} position={[0, 0.45, 0]} castShadow />
      <mesh position={[0, 0.68, 0]}>
        <torusGeometry args={[0.35, 0.03, 6, 14]} />
        <meshStandardMaterial color="#38506a" />
      </mesh>
    </group>
  )
}

function Pallet() {
  return (
    <group>
      <mesh geometry={palletGeometry} material={palletMaterial} position={[0, 0.07, 0]} castShadow />
      <mesh geometry={crateGeometry} material={crateDarkMaterial} position={[-0.2, 0.5, 0.1]} scale={0.8} castShadow />
    </group>
  )
}

function Dumpster() {
  return (
    <group>
      <mesh position={[0, 0.6, 0]} castShadow>
        <boxGeometry args={[1.9, 1.1, 1]} />
        <meshStandardMaterial color="#3f5a4a" roughness={0.7} />
      </mesh>
      <mesh position={[0, 1.18, -0.1]} rotation-x={-0.15}>
        <boxGeometry args={[1.94, 0.08, 1.0]} />
        <meshStandardMaterial color="#324a3c" />
      </mesh>
    </group>
  )
}

/** Sandwich board / menu board with a gentle deterministic sway. */
function Signboard() {
  const board = useRef<THREE.Group>(null)
  useFrame(({ clock }) => {
    if (!board.current) return
    board.current.rotation.z = useGameStore.getState().worldPaused
      ? 0
      : Math.sin(clock.elapsedTime * 1.1) * 0.03
  })
  return (
    <group ref={board}>
      <mesh position={[0, 0.5, 0.16]} rotation-x={-0.22} castShadow>
        <boxGeometry args={[0.7, 1, 0.05]} />
        <meshStandardMaterial color="#f2e3c6" />
      </mesh>
      <mesh position={[0, 0.5, -0.16]} rotation-x={0.22} castShadow>
        <boxGeometry args={[0.7, 1, 0.05]} />
        <meshStandardMaterial color="#f2e3c6" />
      </mesh>
      <mesh position={[0, 0.62, 0.195]} rotation-x={-0.22}>
        <planeGeometry args={[0.52, 0.5]} />
        <meshStandardMaterial color="#e07a5f" />
      </mesh>
    </group>
  )
}

function TableSet() {
  return (
    <group>
      <mesh position={[0, 0.62, 0]} castShadow>
        <cylinderGeometry args={[0.5, 0.5, 0.05, 12]} />
        <meshStandardMaterial color="#f2f0ec" />
      </mesh>
      <mesh position={[0, 0.3, 0]}>
        <cylinderGeometry args={[0.06, 0.09, 0.6, 8]} />
        <meshStandardMaterial color="#44484f" />
      </mesh>
      {[0.75, -0.75].map((x) => (
        <mesh key={x} position={[x, 0.28, 0]} castShadow>
          <boxGeometry args={[0.45, 0.56, 0.45]} />
          <meshStandardMaterial color="#a8703f" />
        </mesh>
      ))}
    </group>
  )
}

function FlowerPot() {
  return (
    <group>
      <mesh geometry={potGeometry} material={potMaterial} position={[0, 0.2, 0]} castShadow />
      <mesh geometry={bushGeometry} material={bushMaterial} position={[0, 0.52, 0]} />
      <mesh position={[0.1, 0.66, 0.05]}>
        <sphereGeometry args={[0.07, 6, 6]} />
        <meshStandardMaterial color="#e8927c" />
      </mesh>
    </group>
  )
}

/** Small glowing lamp over a door — shares the street-lamp bulb material. */
function PorchLight() {
  return (
    <mesh material={lampBulbMaterial} position={[0, 2.5, 0]}>
      <boxGeometry args={[0.22, 0.16, 0.14]} />
    </mesh>
  )
}

/** Boxy delivery truck: cab + cargo box. Nose faces +z like CarMesh. */
function TruckMesh({ color = '#c9803d' }: { color?: string }) {
  return (
    <group>
      <mesh position={[0, 0.75, 1.55]} castShadow>
        <boxGeometry args={[2, 1.1, 1.3]} />
        <meshStandardMaterial color="#5a6478" roughness={0.4} />
      </mesh>
      <mesh position={[0, 1.15, -0.7]} castShadow>
        <boxGeometry args={[2.2, 1.9, 3.2]} />
        <meshStandardMaterial color={color} roughness={0.6} />
      </mesh>
      {[
        [-0.95, 1.5],
        [0.95, 1.5],
        [-0.95, -1.5],
        [0.95, -1.5],
      ].map(([x, z], i) => (
        <mesh key={i} position={[x, 0.36, z]} rotation-z={Math.PI / 2}>
          <cylinderGeometry args={[0.36, 0.36, 0.3, 12]} />
          <meshStandardMaterial color="#26262c" roughness={0.9} />
        </mesh>
      ))}
    </group>
  )
}

/** GLB street props route through the same manifest pipeline as landmarks. */

function PropByType({ def, seed }: { def: PropDef; seed: number }) {
  switch (def.type) {
    case 'street_lamp':
      // Issue #42 Wave 2. The approved lantern is GEOMETRY ONLY, so the functional night light
      // rides along as a `glbSiblings` child — present exactly when the model is, absent the
      // moment the complete procedural lamp takes over. No duplicate pole or lantern is kept.
      return (
        <LandmarkAsset
          assetId={STREET_PROP_ASSET_IDS.street_lamp!}
          glbSiblings={<GlbStreetLampLight />}
        >
          <StreetLamp />
        </LandmarkAsset>
      )
    case 'tree':
      return <TreeMesh />
    case 'park_tree':
      return <SwayingTree seed={seed} />
    case 'bench':
      return (
        <LandmarkAsset assetId={STREET_PROP_ASSET_IDS.bench!}>
          <Bench />
        </LandmarkAsset>
      )
    case 'trash_can':
      return (
        <LandmarkAsset assetId={STREET_PROP_ASSET_IDS.trash_can!}>
          <TrashCan />
        </LandmarkAsset>
      )
    case 'hydrant':
      // `def.color` still drives the procedural fallback. The GLB is one baked atlas with no
      // recolorable slot (issue #42), so it honestly retains its source colours.
      return (
        <LandmarkAsset assetId={STREET_PROP_ASSET_IDS.hydrant!}>
          <Hydrant color={def.color} />
        </LandmarkAsset>
      )
    case 'planter':
      return <Planter />
    case 'parked_car':
      return <CarMesh color={def.color ?? '#7a9cc6'} />
    case 'ac_unit':
      return (
        <LandmarkAsset assetId={STREET_PROP_ASSET_IDS.ac_unit!}>
          <ACUnitFallback />
        </LandmarkAsset>
      )
    case 'bollard':
      return (
        <LandmarkAsset assetId={STREET_PROP_ASSET_IDS.bollard!}>
          <BollardFallback />
        </LandmarkAsset>
      )
    case 'street_planter':
      return (
        <LandmarkAsset assetId={STREET_PROP_ASSET_IDS.street_planter!}>
          <Planter />
        </LandmarkAsset>
      )
    case 'manhole':
      return (
        <LandmarkAsset assetId={STREET_PROP_ASSET_IDS.manhole!} receiveShadow={false}>
          <ManholeFallback />
        </LandmarkAsset>
      )
    case 'drain':
      return (
        <LandmarkAsset assetId={STREET_PROP_ASSET_IDS.drain!} receiveShadow={false}>
          <DrainFallback />
        </LandmarkAsset>
      )
    case 'cone':
      return <TrafficCone />
    case 'utility_box':
      return <UtilityBox color={def.color} />
    case 'stop_sign':
      return <StopSignMesh />
    case 'parked_truck':
      return <TruckMesh color={def.color} />
    case 'crate':
      return <CrateStack />
    case 'barrel':
      return <Barrel />
    case 'pallet':
      return <Pallet />
    case 'dumpster':
      return <Dumpster />
    case 'signboard':
      return <Signboard />
    case 'table_set':
      return <TableSet />
    case 'flower_pot':
      return <FlowerPot />
    case 'porch_light':
      return <PorchLight />
  }
}

/** All props, or a sector-owned subset via `only` (seeds stay stable). */
export function Props({ only, kiosk = true }: { only?: readonly string[]; kiosk?: boolean }) {
  return (
    <group name="props">
      {PROPS.map((def, i) =>
        only && !only.includes(def.id) ? null : (
          <group
            key={def.id}
            name={def.id}
            position={[def.position[0], 0, def.position[1]]}
            rotation-y={def.rotationY ?? 0}
          >
            <PropByType def={def} seed={i} />
          </group>
        ),
      )}
      {kiosk && <JobKiosk />}
    </group>
  )
}
