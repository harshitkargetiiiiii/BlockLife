import { useRef } from 'react'
import * as THREE from 'three'
import { useFrame } from '@react-three/fiber'
import { CuboidCollider, RigidBody } from '@react-three/rapier'
import type { CompiledSectorContent } from './authoringTypes'
import { Buildings } from '../Buildings'
import { Props } from '../Props'
import { roadMaterial, sidewalkMaterial } from '../materials'
import { BUILDINGS, PROPS } from '../cityLayout'
import { PROP_SOLIDITY } from '../solidFootprints'
import { useGameStore } from '../../store/useGameStore'
import { SurfaceDetailLayer } from '../surfaces/SurfaceDetailLayer'
import { getSurfaceDetailsForSector } from '../surfaces/sectorSurfaceDetails'
import { CrossingArtLayer } from '../surfaces/CrossingArtLayer'
import { getCrossingArtForSector } from '../surfaces/crossingArt'
import { trafficRuntime } from '../../traffic/trafficRuntime'
import {
  getMovementSignal,
  type ApproachId,
  type CompiledCrossIntersection,
} from '../../traffic/intersections/crossIntersection'

/**
 * Ambient motion, kit-wide and pause-aware (visual tests freeze on
 * pauseWorld like the park pond): a breathing shimmer over each water
 * band, and a soft steam puff above every kiosk pavilion. No React state,
 * no particles — two oscillating meshes per instance.
 */
function WaterShimmer({ rect }: { rect: { minX: number; maxX: number; minZ: number; maxZ: number } }) {
  const mesh = useRef<THREE.Mesh>(null)
  useFrame(({ clock }) => {
    const m = mesh.current
    if (!m) return
    const t = useGameStore.getState().worldPaused ? 0 : clock.elapsedTime
    const mat = m.material as THREE.MeshBasicMaterial
    mat.opacity = 0.16 + Math.sin(t * 0.6) * 0.07
    m.scale.set(1 + Math.sin(t * 0.4) * 0.03, 1, 1)
  })
  const w = (rect.maxX - rect.minX) * 0.8
  const d = (rect.maxZ - rect.minZ) * 0.5
  return (
    <mesh
      ref={mesh}
      rotation-x={-Math.PI / 2}
      position={[(rect.minX + rect.maxX) / 2, 0.055, (rect.minZ + rect.maxZ) / 2]}
    >
      <planeGeometry args={[w, d]} />
      <meshBasicMaterial color="#cfeaf4" transparent opacity={0.2} depthWrite={false} />
    </mesh>
  )
}

function KioskSteam({ x, y, z }: { x: number; y: number; z: number }) {
  const puff = useRef<THREE.Mesh>(null)
  useFrame(({ clock }) => {
    const m = puff.current
    if (!m) return
    const t = useGameStore.getState().worldPaused ? 0 : clock.elapsedTime
    const cycle = (t * 0.35) % 1
    m.position.y = y + cycle * 1.6
    m.scale.setScalar(0.35 + cycle * 0.5)
    const mat = m.material as THREE.MeshBasicMaterial
    mat.opacity = 0.3 * (1 - cycle)
  })
  return (
    <mesh ref={puff} position={[x, y, z]}>
      <sphereGeometry args={[0.4, 8, 8]} />
      <meshBasicMaterial color="#f4f2ec" transparent opacity={0.3} depthWrite={false} />
    </mesh>
  )
}

/**
 * Signal pole: a low-poly mast with a head that follows the intersection's
 * phase for ITS approach. Color reads the global traffic clock each frame
 * (no React state); pausing freezes the clock, so visual tests are
 * deterministic. Streaming remounts read the same clock — no phase reset.
 */
function SignalPole({
  intersection,
  position,
  facing,
}: {
  intersection: CompiledCrossIntersection
  position: [number, number]
  facing: ApproachId
}) {
  const head = useRef<THREE.Mesh>(null)
  useFrame(() => {
    const m = head.current
    if (!m) return
    const signal = getMovementSignal(intersection, facing, trafficRuntime.signal.elapsed)
    ;(m.material as THREE.MeshStandardMaterial).color.set(signal === 'green' ? '#5fce6d' : '#d1495b')
    ;(m.material as THREE.MeshStandardMaterial).emissive.set(signal === 'green' ? '#1d5a26' : '#5a1d24')
  })
  return (
    <group position={[position[0], 0, position[1]]}>
      <mesh position={[0, 1.9, 0]} castShadow>
        <cylinderGeometry args={[0.09, 0.12, 3.8, 8]} />
        <meshStandardMaterial color="#3c4048" />
      </mesh>
      <mesh ref={head} position={[0, 3.6, 0]} castShadow>
        <boxGeometry args={[0.4, 0.9, 0.4]} />
        <meshStandardMaterial color="#d1495b" />
      </mesh>
    </group>
  )
}

/**
 * Generic renderer for kit-compiled sectors: surfaces (grass/road/
 * sidewalk/plaza), lane dashes, sector-owned buildings/props from the
 * shared data arrays, plus walls and cuboid colliders. Register the pair
 * in sectorComponents and a compiled sector renders with zero bespoke
 * scene code.
 */

const SURFACE_STYLE: Record<string, { color?: string; material?: 'road' | 'sidewalk'; y: number; rough?: number }> = {
  grass: { color: '#7ba05f', y: 0.005 },
  road: { material: 'road', y: 0.02 },
  sidewalk: { material: 'sidewalk', y: 0.03 },
  plaza: { material: 'sidewalk', y: 0.03 },
  // Stylized flat water matching the park pond's palette.
  water: { color: '#3f87ad', y: 0.045, rough: 0.25 },
}

export function CompiledSectorVisuals({ compiled }: { compiled: CompiledSectorContent }) {
  const buildingIds = compiled.buildings.map((b) => b.id)
  const propIds = compiled.props.map((p) => p.id)
  return (
    <group name={`compiled-${compiled.sectorId}`}>
      {compiled.surfaces.map((surface) => {
        const style = SURFACE_STYLE[surface.kind]
        const w = surface.rect.maxX - surface.rect.minX
        const d = surface.rect.maxZ - surface.rect.minZ
        return (
          <mesh
            key={surface.id}
            rotation-x={-Math.PI / 2}
            position={[
              (surface.rect.minX + surface.rect.maxX) / 2,
              style.y,
              (surface.rect.minZ + surface.rect.maxZ) / 2,
            ]}
            material={
              style.material === 'road'
                ? roadMaterial
                : style.material === 'sidewalk'
                  ? sidewalkMaterial
                  : undefined
            }
            receiveShadow
          >
            <planeGeometry args={[w, d]} />
            {style.color && (
              <meshStandardMaterial color={style.color} roughness={style.rough ?? 1} />
            )}
          </mesh>
        )
      })}
      {compiled.laneDashes.map((dash, i) => (
        <mesh
          key={i}
          rotation-x={-Math.PI / 2}
          rotation-z={dash.rotated ? Math.PI / 2 : 0}
          position={[dash.x, 0.035, dash.z]}
        >
          <planeGeometry args={[0.35, 2.4]} />
          <meshStandardMaterial color="#d8c46a" />
        </mesh>
      ))}
      <SurfaceDetailLayer details={getSurfaceDetailsForSector(compiled.sectorId)} />
      <CrossingArtLayer art={getCrossingArtForSector(compiled.sectorId)} />
      <Buildings only={buildingIds} />
      <Props only={propIds} kiosk={false} />
      {compiled.intersections.flatMap((x) =>
        x.signalPoles.map((pole) => (
          <SignalPole key={pole.id} intersection={x} position={pole.position} facing={pole.facing} />
        )),
      )}
      {compiled.waterRects.map((rect) => (
        <WaterShimmer key={`shimmer-${rect.id}`} rect={rect} />
      ))}
      {compiled.buildings
        .filter((b) => compiled.sourceRefs.get(b.id)?.templateId === 'kiosk_pavilion')
        .map((b) => (
          <KioskSteam
            key={`steam-${b.id}`}
            x={b.position[0] + 1.2}
            y={b.size[1] + 0.4}
            z={b.position[1] - 1}
          />
        ))}
    </group>
  )
}

export function CompiledSectorColliders({ compiled }: { compiled: CompiledSectorContent }) {
  // Physical floor under everything this sector authored: the walled area,
  // greenbelt shoulders and the FULL road corridors (roads may run far
  // outside the area to reach their fork nodes — the global city slab ends
  // near the old city edge, so each sector carries its own ground).
  const floors = [
    compiled.spec.area,
    ...(compiled.spec.greenbelts ?? []),
    ...compiled.roadRects.map((r) => ({ minX: r.minX - 4, maxX: r.maxX + 4, minZ: r.minZ - 4, maxZ: r.maxZ + 4 })),
  ]
  return (
    <RigidBody type="fixed" colliders={false}>
      {floors.map((rect, i) => (
        <CuboidCollider
          key={`floor-${i}`}
          args={[(rect.maxX - rect.minX) / 2, 0.5, (rect.maxZ - rect.minZ) / 2]}
          position={[(rect.minX + rect.maxX) / 2, -0.5, (rect.minZ + rect.maxZ) / 2]}
        />
      ))}
      {BUILDINGS.filter((b) => compiled.buildings.some((c) => c.id === b.id)).map((b) => (
        <CuboidCollider
          key={b.id}
          args={[b.size[0] / 2, b.size[1] / 2, b.size[2] / 2]}
          position={[b.position[0], b.size[1] / 2, b.position[1]]}
        />
      ))}
      {PROPS.filter((p) => compiled.props.some((c) => c.id === p.id)).map((p) => {
        const spec = PROP_SOLIDITY[p.type]
        if (!spec?.half) return null
        const [dx, dz] = spec.offset ?? [0, 0]
        return (
          <CuboidCollider
            key={p.id}
            args={spec.half}
            position={[p.position[0] + dx, spec.half[1], p.position[1] + dz]}
            rotation={[0, p.rotationY ?? 0, 0]}
          />
        )
      })}
      {compiled.walls.map((wall, i) => (
        <CuboidCollider key={`wall-${i}`} args={wall.half} position={wall.position} />
      ))}
      {/* Water is solid: a low box keeps players, citizens and props out. */}
      {compiled.waterRects.map((water) => (
        <CuboidCollider
          key={water.id}
          args={[(water.maxX - water.minX) / 2, 0.9, (water.maxZ - water.minZ) / 2]}
          position={[(water.minX + water.maxX) / 2, 0.9, (water.minZ + water.maxZ) / 2]}
        />
      ))}
    </RigidBody>
  )
}
