import * as THREE from 'three'
import { useMemo } from 'react'
import { BUILDINGS } from './cityLayout'
import { Occludable } from '../visibility/Occludable'
import { getBuildingOccluderDescriptor } from '../visibility/occluderData'
import type { BuildingDef } from './worldTypes'
import { seededRandom, shade, windowDimMaterial, windowLitMaterial } from './materials'
import { computeFacadeDetails, type FacadeBox } from './surfaces/facadeDetails'
import { WorldLabel } from '../ui3d/WorldLabel'
import { LandmarkAsset } from '../assets/LandmarkAsset'
import { getManifestEntry, hasRealModel } from '../assets/modelRegistry'
import { BuildingWindowOverlays } from './WindowOverlays'

const windowGeometry = new THREE.PlaneGeometry(0.85, 1.05)

/** Small rooftop flavor: a water tank on the apartment, antennas on towers. */
function RooftopExtras({ def }: { def: BuildingDef }) {
  const h = def.size[1]
  if (def.id === 'building_apartment_01') {
    return (
      <group position={[-def.size[0] * 0.22, h + 0.45, def.size[2] * 0.2]}>
        <mesh position={[0, 0.75, 0]} castShadow>
          <cylinderGeometry args={[0.75, 0.75, 1.3, 10]} />
          <meshStandardMaterial color="#8a6b4f" roughness={0.9} />
        </mesh>
        <mesh position={[0, 1.55, 0]} castShadow>
          <coneGeometry args={[0.82, 0.5, 10]} />
          <meshStandardMaterial color={shade('#8a6b4f', 0.75)} />
        </mesh>
      </group>
    )
  }
  if (def.id.startsWith('building_tower')) {
    return (
      <group position={[def.size[0] * 0.25, h + 0.45, -def.size[2] * 0.2]}>
        <mesh position={[0, 1, 0]}>
          <cylinderGeometry args={[0.05, 0.08, 2, 6]} />
          <meshStandardMaterial color="#3c4048" />
        </mesh>
        <mesh position={[0, 2.05, 0]}>
          <sphereGeometry args={[0.12, 8, 8]} />
          <meshStandardMaterial color="#d1495b" />
        </mesh>
      </group>
    )
  }
  return null
}

interface FaceSpec {
  /** Rotation of the window plane so it faces outward. */
  rotationY: number
  /** Outward axis: 'x' or 'z', and its sign. */
  axis: 'x' | 'z'
  sign: 1 | -1
}

const FACES: FaceSpec[] = [
  { rotationY: 0, axis: 'z', sign: 1 },
  { rotationY: Math.PI, axis: 'z', sign: -1 },
  { rotationY: Math.PI / 2, axis: 'x', sign: 1 },
  { rotationY: -Math.PI / 2, axis: 'x', sign: -1 },
]

function BuildingWindows({ def, index }: { def: BuildingDef; index: number }) {
  const [w, h, d] = def.size
  const windows: React.ReactElement[] = []
  const floorYs: number[] = []
  for (let y = 1.6; y < h - 0.9; y += 1.7) floorYs.push(y)

  FACES.forEach((face, f) => {
    const faceWidth = face.axis === 'z' ? w : d
    const cols = Math.max(1, Math.floor((faceWidth - 1.6) / 1.5))
    const startOffset = -((cols - 1) * 1.5) / 2
    floorYs.forEach((y, row) => {
      for (let c = 0; c < cols; c++) {
        const lateral = startOffset + c * 1.5
        const out = (face.axis === 'z' ? d / 2 : w / 2) + 0.03
        const px = face.axis === 'z' ? lateral : face.sign * out
        const pz = face.axis === 'z' ? face.sign * out : lateral
        const lit = seededRandom(index * 31 + f * 7 + row * 13 + c * 3) < 0.68
        windows.push(
          <mesh
            key={`${f}-${row}-${c}`}
            geometry={windowGeometry}
            material={lit ? windowLitMaterial : windowDimMaterial}
            position={[px, y, pz]}
            rotation-y={face.rotationY}
          />,
        )
      }
    })
  })
  return <>{windows}</>
}

const DOOR_OFFSETS: Record<NonNullable<BuildingDef['door']>, { rotationY: number; dir: [number, number] }> = {
  south: { rotationY: 0, dir: [0, 1] },
  north: { rotationY: Math.PI, dir: [0, -1] },
  east: { rotationY: Math.PI / 2, dir: [1, 0] },
  west: { rotationY: -Math.PI / 2, dir: [-1, 0] },
}

/** Palette-role → color for a building's facade accents (Art Polish v1). */
function facadeColor(def: BuildingDef, role: FacadeBox['role']): string {
  switch (role) {
    case 'trim':
      return shade(def.color, 0.78)
    case 'frame':
      return shade(def.color, 0.62)
    case 'accent':
      return def.accentColor ?? def.roofColor
    case 'dark':
      return '#2c2f36'
    case 'vent':
      return '#7d838d'
  }
}

/** Facade accents live INSIDE the Occludable — they fade with the parent. */
function FacadeDetails({ def }: { def: BuildingDef }) {
  return (
    <>
      {computeFacadeDetails(def).map((box, i) => (
        <mesh key={i} position={[box.x, box.y + box.h / 2, box.z]} castShadow>
          <boxGeometry args={[box.w, box.h, box.d]} />
          <meshStandardMaterial color={facadeColor(def, box.role)} roughness={0.85} />
        </mesh>
      ))}
    </>
  )
}

/**
 * The procedural building visual (asset manifest fallbackKey: BuildingMesh).
 * Pure visuals only — colliders live in CityColliders, driven by layout data.
 */
export function BuildingMesh({ def, index }: { def: BuildingDef; index: number }) {
  const [w, h, d] = def.size
  const door = def.door ? DOOR_OFFSETS[def.door] : null
  const doorDist = def.door === 'east' || def.door === 'west' ? w / 2 : d / 2
  return (
    <>
      <mesh position={[0, h / 2, 0]} castShadow receiveShadow>
        <boxGeometry args={[w, h, d]} />
        <meshStandardMaterial color={def.color} roughness={0.85} />
      </mesh>
      {/* Plinth grounds the building visually */}
      <mesh position={[0, 0.3, 0]} receiveShadow>
        <boxGeometry args={[w + 0.24, 0.6, d + 0.24]} />
        <meshStandardMaterial color={shade(def.color, 0.72)} roughness={0.95} />
      </mesh>
      {/* Roof slab */}
      <mesh position={[0, h + 0.22, 0]} castShadow>
        <boxGeometry args={[w + 0.5, 0.45, d + 0.5]} />
        <meshStandardMaterial color={def.roofColor} roughness={0.9} />
      </mesh>
      {/* Rooftop AC unit on every other building */}
      {index % 2 === 0 && (
        <mesh position={[w * 0.2, h + 0.75, -d * 0.15]} castShadow>
          <boxGeometry args={[1, 0.7, 1]} />
          <meshStandardMaterial color="#8d939c" />
        </mesh>
      )}
      <RooftopExtras def={def} />
      <FacadeDetails def={def} />
      {def.windows !== false && <BuildingWindows def={def} index={index} />}
      {door && (
        <group
          position={[door.dir[0] * doorDist, 0, door.dir[1] * doorDist]}
          rotation-y={door.rotationY}
        >
          {/* Door */}
          <mesh position={[0, 1.1, 0.04]}>
            <boxGeometry args={[1.4, 2.2, 0.12]} />
            <meshStandardMaterial color="#3a2f28" />
          </mesh>
          {/* Awning */}
          <mesh position={[0, 2.5, 0.5]} rotation-x={0.35} castShadow>
            <boxGeometry args={[2.4, 0.1, 1.2]} />
            <meshStandardMaterial color={def.accentColor ?? def.roofColor} />
          </mesh>
        </group>
      )}
    </>
  )
}

function Building({ def, index }: { def: BuildingDef; index: number }) {
  // Real models are usually taller than the primitive, so the sign height
  // comes from the manifest while a GLB is active.
  const entry = getManifestEntry(def.id)
  const labelOffset =
    hasRealModel(def.id) && entry?.labelHeight ? entry.labelHeight : def.size[1] + 1.6
  // Occluder bounds derive from the same layout data as the colliders.
  const occluder = useMemo(() => getBuildingOccluderDescriptor(def), [def])
  return (
    <group name={def.id} position={[def.position[0], 0, def.position[1]]}>
      {/* Everything inside Occludable fades together when this building
          blocks the camera: the GLB clone OR the procedural mesh, plus the
          window overlays — lit windows never float over a faded façade.
          The label stays outside: signs are HUD-like chips by policy. */}
      <Occludable descriptor={occluder}>
        {/* Swappable visual: GLB from the manifest when enabled, else BuildingMesh.
            A def.paletteVariant recolors this instance's declared slots (§6) — the
            GLB clone still shares geometry with every other use of the archetype. */}
        <LandmarkAsset assetId={def.id} variant={def.paletteVariant}>
          <BuildingMesh def={def} index={index} />
        </LandmarkAsset>
        {/* GLB exports have no emissive windows; add the night glow procedurally.
            The primitive fallback has its own lit windows, so only GLB gets this. */}
        {hasRealModel(def.id) && <BuildingWindowOverlays assetId={def.id} />}
      </Occludable>
      {/* The sign is UI, not part of the asset — it survives a GLB swap. */}
      {def.label && (
        <WorldLabel text={def.label} className="building-sign" offset={labelOffset} />
      )}
    </group>
  )
}

/**
 * All buildings, or a sector-owned subset via `only`. The window-seed index
 * stays the def's position in BUILDINGS so a filtered render is pixel-equal
 * to the same building in a full render.
 */
export function Buildings({ only }: { only?: readonly string[] }) {
  return (
    <group name="buildings">
      {BUILDINGS.map((def, i) =>
        only && !only.includes(def.id) ? null : <Building key={def.id} def={def} index={i} />,
      )}
    </group>
  )
}
