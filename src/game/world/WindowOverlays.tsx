import { useLayoutEffect, useMemo, useRef } from 'react'
import * as THREE from 'three'
import { glbWindowGlowMaterial, seededRandom } from './materials'
import {
  WINDOW_OVERLAYS,
  type FacadeDirection,
  type WindowOverlayDef,
} from './windowOverlayData'

// One shared unit plane; per-window size comes from the instance matrix.
const windowPlane = new THREE.PlaneGeometry(1, 1)

const FACADE_ROTATION: Record<FacadeDirection, number> = {
  south: 0,
  north: Math.PI,
  east: Math.PI / 2,
  west: -Math.PI / 2,
}

interface InstanceData {
  count: number
  matrices: THREE.Matrix4[]
  colors: THREE.Color[]
}

/** Lays out the lit subset of a façade grid. Deterministic per seed. */
function buildInstances(def: WindowOverlayDef): InstanceData {
  const matrices: THREE.Matrix4[] = []
  const colors: THREE.Color[] = []
  const quaternion = new THREE.Quaternion().setFromAxisAngle(
    new THREE.Vector3(0, 1, 0),
    FACADE_ROTATION[def.facade],
  )
  const scale = new THREE.Vector3(def.windowSize[0], def.windowSize[1], 1)
  const warm = new THREE.Color('#ffffff')

  let cell = 0
  for (let row = 0; row < def.rows; row++) {
    for (let col = 0; col < def.columns; col++) {
      cell++
      if (seededRandom(def.seed * 97 + cell * 13) > def.litRatio) continue
      const lateral = def.start[0] + col * def.spacing[0]
      const y = def.start[1] + row * def.spacing[1]
      const position = new THREE.Vector3()
      switch (def.facade) {
        case 'south':
          position.set(lateral, y, def.facadeDistance)
          break
        case 'north':
          position.set(lateral, y, -def.facadeDistance)
          break
        case 'east':
          position.set(def.facadeDistance, y, lateral)
          break
        case 'west':
          position.set(-def.facadeDistance, y, lateral)
          break
      }
      matrices.push(new THREE.Matrix4().compose(position, quaternion, scale))
      // Subtle per-window brightness variation keeps the grid organic.
      const variation = 0.75 + seededRandom(def.seed * 31 + cell * 7) * 0.3
      colors.push(warm.clone().multiplyScalar(def.emissiveIntensity * variation))
    }
  }
  return { count: matrices.length, matrices, colors }
}

function OverlayFacade({ def }: { def: WindowOverlayDef }) {
  const meshRef = useRef<THREE.InstancedMesh>(null)
  const data = useMemo(() => buildInstances(def), [def])

  // Static layout: matrices/colors are written once, never per frame.
  useLayoutEffect(() => {
    const mesh = meshRef.current
    if (!mesh) return
    data.matrices.forEach((m, i) => mesh.setMatrixAt(i, m))
    data.colors.forEach((c, i) => mesh.setColorAt(i, c))
    mesh.instanceMatrix.needsUpdate = true
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true
  }, [data])

  if (data.count === 0) return null
  return (
    <instancedMesh
      ref={meshRef}
      args={[windowPlane, glbWindowGlowMaterial, data.count]}
      name={`overlay-facade:${def.buildingAssetId}:${def.facade}`}
    />
  )
}

/**
 * Night-glow window grid for one GLB-skinned building. Rendered inside the
 * building's group; purely decorative — no colliders, no gameplay reads.
 * Brightness is driven globally through glbWindowGlowMaterial (lamp glow
 * curve), so overlays are invisible by day and fade in at dusk.
 */
export function BuildingWindowOverlays({ assetId, seed }: { assetId: string; seed?: number }) {
  const defs = useMemo(() => {
    const base = WINDOW_OVERLAYS.filter((d) => d.buildingAssetId === assetId)
    // Issue #25: a reused archetype passes a per-building seed so every instance shows a
    // DISTINCT deterministic lit-window pattern (legacy single-placement buildings pass
    // none → unchanged authored seed).
    if (seed === undefined) return base
    return base.map((d) => ({ ...d, seed: (d.seed ^ seed) >>> 0 || d.seed }))
  }, [assetId, seed])
  if (defs.length === 0) return null
  return (
    <group name={`window-overlay:${assetId}`}>
      {defs.map((def, i) => (
        <OverlayFacade key={`${def.facade}-${i}`} def={def} />
      ))}
    </group>
  )
}
