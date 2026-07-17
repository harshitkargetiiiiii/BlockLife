import { useRef } from 'react'
import * as THREE from 'three'
import { useFrame } from '@react-three/fiber'
import type { CompiledCrossingArt, CrossingFurniture } from './crossingArt'
import { getIntersection } from '../../traffic/intersections/intersectionRegistry'
import { getCrossingSignal } from '../../traffic/intersections/crossIntersection'
import { trafficRuntime } from '../../traffic/trafficRuntime'

/**
 * Renderer for compiled crossing art: static stripe/pad decals on shared
 * geometry + the small crossing palette below, plus waiting furniture.
 * The ONLY per-frame work is one material color per pedestrian signal
 * head, driven by the global clock (pause-pin deterministic, streaming
 * remounts read the same clock).
 */

const unitPlane = new THREE.PlaneGeometry(1, 1)
const postGeometry = new THREE.CylinderGeometry(0.07, 0.09, 2.6, 8)
const headGeometry = new THREE.BoxGeometry(0.34, 0.5, 0.22)
const signGeometry = new THREE.BoxGeometry(0.55, 0.55, 0.08)

const flat = (color: string) => new THREE.MeshStandardMaterial({ color, roughness: 1 })

/** The crossing palette — eight shared materials, nothing per-crossing. */
export const CROSSING_PALETTE = {
  stripe: flat('#e8e4d8'),
  wornStripe: flat('#c9c5b8'),
  tactile: flat('#caa66a'),
  curbRamp: flat('#b8b4a6'),
  signalPost: flat('#3c4048'),
  unsignaledPost: flat('#8a6f3c'),
  walkHead: new THREE.MeshStandardMaterial({ color: '#e8f4ea', emissive: '#3c7a46', roughness: 0.6 }),
  dontWalkHead: new THREE.MeshStandardMaterial({ color: '#e8b4a0', emissive: '#7a3c2c', roughness: 0.6 }),
}

function PedestrianSignalHead({ furniture }: { furniture: CrossingFurniture }) {
  const head = useRef<THREE.Mesh>(null)
  const intersection = furniture.intersectionId ? getIntersection(furniture.intersectionId) : undefined
  useFrame(() => {
    const m = head.current
    if (!m || !intersection) return
    const walk = getCrossingSignal(intersection, trafficRuntime.signal.elapsed) === 'walk'
    m.material = walk ? CROSSING_PALETTE.walkHead : CROSSING_PALETTE.dontWalkHead
  })
  return (
    <mesh
      ref={head}
      geometry={headGeometry}
      material={CROSSING_PALETTE.dontWalkHead}
      position={[0, 2.35, 0]}
      castShadow
    />
  )
}

function CrossingPost({ furniture }: { furniture: CrossingFurniture }) {
  return (
    <group position={[furniture.position[0], 0, furniture.position[1]]}>
      <mesh
        geometry={postGeometry}
        material={
          furniture.kind === 'signalPost'
            ? CROSSING_PALETTE.signalPost
            : CROSSING_PALETTE.unsignaledPost
        }
        position={[0, 1.3, 0]}
        castShadow
      />
      {furniture.kind === 'signalPost' ? (
        <PedestrianSignalHead furniture={furniture} />
      ) : (
        // Static crossing sign (diamond) — no fake signal state.
        <mesh
          geometry={signGeometry}
          material={CROSSING_PALETTE.tactile}
          position={[0, 2.3, 0]}
          rotation-y={Math.PI / 4}
          castShadow
        />
      )}
    </group>
  )
}

export function CrossingArtLayer({ art }: { art: CompiledCrossingArt[] }) {
  return (
    <group name="crossing-art">
      {art.map((crossing) => (
        <group key={crossing.spec.crossingId} name={`crossing-art:${crossing.spec.crossingId}`}>
          {crossing.stripes.map((s) => (
            <mesh
              key={s.id}
              geometry={unitPlane}
              material={CROSSING_PALETTE[s.material]}
              rotation-x={-Math.PI / 2}
              // Above lane dashes (0.035): crossings paint over lane
              // markings inside the band, exactly like real asphalt.
              position={[s.x, 0.042, s.z]}
              scale={[s.w, s.d, 1]}
            />
          ))}
          {crossing.pads.map((p) => (
            <mesh
              key={p.id}
              geometry={unitPlane}
              material={p.kind === 'tactile' ? CROSSING_PALETTE.tactile : CROSSING_PALETTE.curbRamp}
              rotation-x={-Math.PI / 2}
              position={[p.x, p.kind === 'tactile' ? 0.048 : 0.045, p.z]}
              scale={[p.w, p.d, 1]}
            />
          ))}
          {crossing.furniture.map((f) => (
            <CrossingPost key={f.id} furniture={f} />
          ))}
        </group>
      ))}
    </group>
  )
}
