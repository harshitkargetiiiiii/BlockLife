import * as THREE from 'three'
import type { AssetManifestEntry } from '../assets/assetManifest'

/**
 * Central Plaza shopfront accents (graphics sprint, issue #71). Purely visual and kept OUT of
 * `BUILDINGS`, so ids, footprints, doors, colliders, occlusion, routing and the placement
 * contracts that digest that table are untouched.
 *
 * The café, the Mini Mart and the Book Nook all draw the one approved shop body, whose single
 * baked atlas holds walls, glass, roof and trim together — it cannot be tinted selectively. So the
 * body keeps its own colours, and each placement adds one modest accent in the shop's identity
 * colour: the awning fabric (slope and valance) with a cream sign board on it. Glass, roof, trim
 * and walls keep the body's own colours. Every
 * other reuse of the shop body is unaffected.
 */
const SHOPFRONT_ACCENTS: Readonly<Record<string, string>> = {
  building_cafe_01: '#b5543a', // terracotta
  building_shop_01: '#c8962c', // mustard
  building_shop_02: '#6f8f5e', // sage
}

// Model-local placement on the shop body (`arch_shop_01.glb`, before the manifest scale),
// measured from its vertex data. The awning spans x −0.78…2.15: its sloped fabric runs from the
// front edge (z 2.02, y 2.30) back to the wall (z ≈ 1.45, y ≈ 2.64), about 31°, and a flat valance
// hangs from that edge down to y 2.0. The camera sees mostly the slope, which also carries the
// body's blank sign panel (centred near x 0.2), so the accent covers the slope and the valance and
// a cream board takes the place of that panel. Each piece sits 1–2 cm proud of the surface.
const AWNING_X = 0.685
const AWNING_W = 2.95
const SLOPE_TILT = Math.atan2(2.64 - 2.3, 2.02 - 1.45)
const SLOPE_LEN = Math.hypot(2.64 - 2.3, 2.02 - 1.45)
const SLOPE = { y: 2.47 + 0.02, z: 1.735 + 0.012 }
const VALANCE = { y: 2.15, z: 2.035, h: 0.3, d: 0.03 }
const SIGN = { x: 0.2, w: 1.2, len: 0.4, lift: 0.018 }
const SIGN_COLOR = '#f3ead8'

// Shared, created once per colour for the session (at most four materials and one geometry), so
// mounting or streaming a shop never allocates per instance or per frame.
const box = new THREE.BoxGeometry(1, 1, 1)
const materials = new Map<string, THREE.MeshStandardMaterial>()
function material(color: string): THREE.MeshStandardMaterial {
  let m = materials.get(color)
  if (!m) {
    m = new THREE.MeshStandardMaterial({ color, roughness: 0.8 })
    materials.set(color, m)
  }
  return m
}

/** The accent for one placement, in the body's own transform (manifest scale/rotation/offset). */
export function ShopfrontAccent({ buildingId, entry }: { buildingId: string; entry: AssetManifestEntry }) {
  const color = SHOPFRONT_ACCENTS[buildingId]
  if (!color) return null
  return (
    <group position={entry.positionOffset} rotation={entry.rotation} scale={entry.scale} name="shopfront-accent">
      {/* Sloped awning fabric */}
      <mesh
        geometry={box}
        material={material(color)}
        position={[AWNING_X, SLOPE.y, SLOPE.z]}
        rotation-x={SLOPE_TILT}
        scale={[AWNING_W, 0.025, SLOPE_LEN + 0.04]}
        castShadow
      />
      {/* Valance on the front edge */}
      <mesh
        geometry={box}
        material={material(color)}
        position={[AWNING_X, VALANCE.y, VALANCE.z]}
        scale={[AWNING_W, VALANCE.h, VALANCE.d]}
      />
      {/* Cream sign board on the slope, over the body's blank panel */}
      <mesh
        geometry={box}
        material={material(SIGN_COLOR)}
        position={[SIGN.x, SLOPE.y + SIGN.lift * Math.cos(SLOPE_TILT), SLOPE.z + SIGN.lift * Math.sin(SLOPE_TILT)]}
        rotation-x={SLOPE_TILT}
        scale={[SIGN.w, 0.02, SIGN.len]}
      />
    </group>
  )
}
