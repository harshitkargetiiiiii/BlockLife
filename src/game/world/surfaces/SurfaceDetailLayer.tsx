import * as THREE from 'three'
import type { SurfaceDetail } from './surfaceDetails'

/**
 * Renderer for the surface-detail layer: one static group per sector,
 * SHARED geometry (unit plane / unit disc) and one SHARED material per
 * detail kind — hundreds of decals cost zero per-frame work and add no
 * new material variety beyond the palette below.
 */

const unitPlane = new THREE.PlaneGeometry(1, 1)
const unitDisc = new THREE.CircleGeometry(0.5, 12)

const mat = (color: string, opacity = 1) =>
  new THREE.MeshStandardMaterial({
    color,
    roughness: 1,
    ...(opacity < 1 ? { transparent: true, opacity } : {}),
  })

/** District-neutral surface palette (kept small on purpose). */
export const SURFACE_PALETTE: Record<SurfaceDetail['kind'], THREE.MeshStandardMaterial> = {
  manhole: mat('#1d1f26'),
  drain: mat('#33363f'),
  road_patch: mat('#2f313a'),
  sidewalk_seam: mat('#9d9a90'),
  curb_strip: mat('#c9c5b8'),
  grass_patch: mat('#86ad68'),
  dirt_patch: mat('#9b8a68'),
  paving_band: mat('#c6c1b2'),
  zone_paint: mat('#d8b34e'),
}

const DISC_KINDS = new Set<SurfaceDetail['kind']>(['manhole', 'drain'])

export function SurfaceDetailLayer({ details }: { details: SurfaceDetail[] }) {
  return (
    <group name="surface-details">
      {details.map((detail) => (
        <mesh
          key={detail.id}
          geometry={DISC_KINDS.has(detail.kind) ? unitDisc : unitPlane}
          material={SURFACE_PALETTE[detail.kind]}
          rotation-x={-Math.PI / 2}
          rotation-z={detail.rotated ? Math.PI / 7 : 0}
          position={[detail.x, detail.y, detail.z]}
          scale={[detail.w, detail.d, 1]}
        />
      ))}
    </group>
  )
}
