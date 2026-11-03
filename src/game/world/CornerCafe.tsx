import * as THREE from 'three'
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js'
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js'
import { createRng, hashString } from '../traffic/routing/routeRng'

/**
 * Corner Café presentation (issue #73). Purely visual and scoped to ONE placement,
 * `building_cafe_01`: an authored stylized body that replaces the shared shop GLB for this lot
 * only, a paving apron in front of its door, and its two planters. Mini Mart, Book Nook and every
 * other reuse of the shop body are untouched.
 *
 * Gameplay is unchanged: the footprint, collider, door side, occluder descriptor, label height and
 * routing all still come from the building/prop data; nothing here is solid.
 *
 * The body is authored in a local frame with its storefront facing +z; Buildings.tsx applies the
 * placement's existing projection yaw, which turns that front onto the authored east door. It stays
 * inside the 6 × 6 lot (walls x ±2.75, z −2.45…+2.2, awning to +2.95) and under the shop body's
 * 4.824 m rendered top, so the occluder height is unchanged.
 */

const PALETTE = {
  plaster: '#ece0c8',
  terracotta: '#b5543a',
  stone: '#d2c8b6',
  roof: '#56514c',
  frame: '#2e3a35',
  glass: '#7f98a3',
  wood: '#5a3a28',
  cream: '#f3ead8',
  lamp: '#ffd9a0',
} as const
type Part = keyof typeof PALETTE

// ---- Geometry, built once and shared (module lifetime, like the shop accent resources) ----------

type Pieces = Record<Part, THREE.BufferGeometry[]>

function newPieces(): Pieces {
  return Object.fromEntries(Object.keys(PALETTE).map((k) => [k, []])) as unknown as Pieces
}

/** An axis-aligned box spanning [x0,x1] × [y0,y1] × [z0,z1]. */
function box(p: Pieces, part: Part, [x0, x1]: [number, number], [y0, y1]: [number, number], [z0, z1]: [number, number]) {
  p[part].push(
    new THREE.BoxGeometry(x1 - x0, y1 - y0, z1 - z0).translate((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2),
  )
}

/** A framed window on the +z face: recessed glass, dark frame, optional mullion/transom, sill. */
function frontWindow(p: Pieces, x0: number, x1: number, y0: number, y1: number, opts: { mullion?: boolean; transom?: number; sill?: Part } = {}) {
  const z = 2.05
  const f = 0.06
  box(p, 'glass', [x0, x1], [y0, y1], [z, z + 0.02])
  box(p, 'frame', [x0 - f, x1 + f], [y0 - f, y0], [z, z + 0.1])
  box(p, 'frame', [x0 - f, x1 + f], [y1, y1 + f], [z, z + 0.1])
  box(p, 'frame', [x0 - f, x0], [y0, y1], [z, z + 0.1])
  box(p, 'frame', [x1, x1 + f], [y0, y1], [z, z + 0.1])
  if (opts.mullion) box(p, 'frame', [(x0 + x1) / 2 - 0.025, (x0 + x1) / 2 + 0.025], [y0, y1], [z, z + 0.08])
  if (opts.transom) box(p, 'frame', [x0, x1], [opts.transom - 0.025, opts.transom + 0.025], [z, z + 0.08])
  if (opts.sill) box(p, opts.sill, [x0 - 0.1, x1 + 0.1], [y0 - f - 0.06, y0 - f], [z, z + 0.16])
}

/** The same on the −x face (the side the fixed camera sees), recessed into the wall. */
function sideWindow(p: Pieces, z0: number, z1: number, y0: number, y1: number, opts: { mullion?: boolean; sill?: Part } = {}) {
  const x = -2.62
  const f = 0.06
  box(p, 'glass', [x - 0.02, x], [y0, y1], [z0, z1])
  box(p, 'frame', [x - 0.1, x], [y0 - f, y0], [z0 - f, z1 + f])
  box(p, 'frame', [x - 0.1, x], [y1, y1 + f], [z0 - f, z1 + f])
  box(p, 'frame', [x - 0.1, x], [y0, y1], [z0 - f, z0])
  box(p, 'frame', [x - 0.1, x], [y0, y1], [z1, z1 + f])
  if (opts.mullion) box(p, 'frame', [x - 0.08, x], [y0, y1], [(z0 + z1) / 2 - 0.025, (z0 + z1) / 2 + 0.025])
  if (opts.sill) box(p, opts.sill, [x - 0.16, x], [y0 - f - 0.06, y0 - f], [z0 - 0.1, z1 + 0.1])
}

function buildCafePieces(): Pieces {
  const p = newPieces()
  // Massing: plinth, walls (the front wall plane sits at z 2.05 so openings read as recessed
  // behind the proud piers, frames and bands), corner pilasters, cornice, parapet and roof deck.
  box(p, 'stone', [-2.85, 2.85], [0, 0.2], [-2.5, 2.3])
  // The main wall stops short of the front plane; the front leaf below wraps a real door opening
  // (x −0.5…0.5, up to y 2.34) so the recessed door at z 1.90–2.00 is not buried in plaster.
  box(p, 'plaster', [-2.62, 2.62], [0.2, 4.3], [-2.4, 1.88])
  box(p, 'plaster', [-2.62, -0.5], [0.2, 4.3], [1.88, 2.05])
  box(p, 'plaster', [0.5, 2.62], [0.2, 4.3], [1.88, 2.05])
  box(p, 'plaster', [-0.5, 0.5], [2.34, 4.3], [1.88, 2.05])
  for (const x of [-2.75, 2.45]) {
    box(p, 'terracotta', [x, x + 0.3], [0.2, 4.3], [-2.48, -2.18])
    box(p, 'terracotta', [x, x + 0.3], [0.2, 4.3], [1.98, 2.24])
  }
  box(p, 'stone', [-2.88, 2.88], [4.3, 4.44], [-2.56, 2.36])
  box(p, 'roof', [-2.7, 2.7], [4.44, 4.5], [-2.45, 2.2])
  // Parapet: a plaster upstand with a stone coping all round, so the roofline is a clean,
  // level silhouette from the gameplay camera.
  box(p, 'plaster', [-2.8, 2.8], [4.44, 4.74], [2.14, 2.3])
  box(p, 'plaster', [-2.8, 2.8], [4.44, 4.74], [-2.5, -2.34])
  box(p, 'plaster', [-2.8, -2.64], [4.44, 4.74], [-2.5, 2.3])
  box(p, 'plaster', [2.64, 2.8], [4.44, 4.74], [-2.5, 2.3])
  box(p, 'stone', [-2.84, 2.84], [4.74, 4.8], [2.1, 2.34])
  box(p, 'stone', [-2.84, 2.84], [4.74, 4.8], [-2.54, -2.3])
  box(p, 'stone', [-2.84, -2.6], [4.74, 4.8], [-2.54, 2.34])
  box(p, 'stone', [2.6, 2.84], [4.74, 4.8], [-2.54, 2.34])
  // Rooftop: one condenser and a vent stack, kept below the parapet coping.
  box(p, 'stone', [-1.4, -0.6], [4.5, 4.76], [-1.6, -1.0])
  box(p, 'frame', [-1.35, -0.65], [4.56, 4.7], [-0.99, -0.98])
  box(p, 'roof', [1.2, 1.36], [4.5, 4.78], [-1.4, -1.24])

  // ---- Storefront (+z) --------------------------------------------------------------------
  // Terracotta stall risers under the shop windows and a timber header over the storefront.
  box(p, 'terracotta', [-2.45, -0.62], [0.2, 0.72], [2.05, 2.2])
  box(p, 'terracotta', [0.62, 2.45], [0.2, 0.72], [2.05, 2.2])
  box(p, 'frame', [-2.45, 2.45], [2.5, 2.62], [2.05, 2.22])
  frontWindow(p, -2.3, -0.8, 0.8, 2.44, { mullion: true, transom: 2.05 })
  frontWindow(p, 0.8, 2.3, 0.8, 2.44, { mullion: true, transom: 2.05 })
  // Recessed half-glazed door with its frame, a stone threshold step and two lanterns.
  box(p, 'wood', [-0.5, 0.5], [0.2, 2.34], [1.9, 1.96])
  box(p, 'glass', [-0.34, 0.34], [1.3, 2.16], [1.96, 1.98])
  box(p, 'frame', [-0.62, -0.5], [0.2, 2.5], [1.9, 2.2])
  box(p, 'frame', [0.5, 0.62], [0.2, 2.5], [1.9, 2.2])
  box(p, 'frame', [-0.62, 0.62], [2.34, 2.5], [1.9, 2.2])
  box(p, 'cream', [0.3, 0.36], [1.1, 1.24], [1.96, 2.0])
  box(p, 'stone', [-0.75, 0.75], [0.2, 0.26], [1.9, 2.42])
  box(p, 'frame', [-0.78, -0.68], [2.05, 2.3], [2.2, 2.3])
  box(p, 'frame', [0.68, 0.78], [2.05, 2.3], [2.2, 2.3])
  box(p, 'lamp', [-0.77, -0.69], [2.08, 2.26], [2.3, 2.34])
  box(p, 'lamp', [0.69, 0.77], [2.08, 2.26], [2.3, 2.34])
  // Sign band above the awning: terracotta fascia with a cream panel for the name.
  box(p, 'terracotta', [-2.45, 2.45], [2.88, 3.36], [2.05, 2.2])
  box(p, 'cream', [-1.7, 1.7], [2.98, 3.26], [2.2, 2.23])
  // Upper storey: three framed windows with stone sills, and a string course under them.
  box(p, 'stone', [-2.62, 2.62], [3.38, 3.44], [2.05, 2.16])
  for (const x of [-1.65, 0, 1.65]) frontWindow(p, x - 0.36, x + 0.36, 3.56, 4.08, { mullion: true, sill: 'stone' })

  // ---- Side street face (−x) ----------------------------------------------------------------
  box(p, 'terracotta', [-2.77, -2.62], [0.2, 0.72], [-1.95, 1.75])
  box(p, 'stone', [-2.73, -2.62], [3.38, 3.44], [-2.4, 2.05])
  sideWindow(p, -1.8, -0.4, 0.8, 2.44, { mullion: true })
  sideWindow(p, 0.3, 1.6, 0.8, 2.44, { mullion: true })
  for (const z of [-1.1, 0.95]) sideWindow(p, z - 0.36, z + 0.36, 3.56, 4.08, { mullion: true, sill: 'stone' })

  // ---- Striped canvas awning over the storefront ------------------------------------------
  // Slopes from the wall at y 2.8 down to a valance edge at y 2.48, z 2.95.
  const tilt = Math.atan2(2.8 - 2.48, 2.95 - 2.2)
  const len = Math.hypot(2.8 - 2.48, 2.95 - 2.2)
  const stripes = 8
  const x0 = -2.4
  const w = 4.8 / stripes
  for (let i = 0; i < stripes; i++) {
    const part: Part = i % 2 === 0 ? 'terracotta' : 'cream'
    const cx = x0 + w * (i + 0.5)
    p[part].push(
      new THREE.BoxGeometry(w, 0.03, len).rotateX(tilt).translate(cx, (2.8 + 2.48) / 2, (2.2 + 2.95) / 2),
    )
    box(p, part, [cx - w / 2, cx + w / 2], [2.3, 2.48], [2.93, 2.96])
  }
  return p
}

let cafeMeshes: { geometry: THREE.BufferGeometry; material: THREE.MeshStandardMaterial; name: string }[] | null = null

/** One merged geometry + one material per palette entry, created on first use. */
function getCafeMeshes() {
  if (cafeMeshes) return cafeMeshes
  const pieces = buildCafePieces()
  cafeMeshes = (Object.keys(PALETTE) as Part[])
    .filter((part) => pieces[part].length > 0)
    .map((part) => {
      const geometry = mergeGeometries(pieces[part], false)!
      for (const g of pieces[part]) g.dispose()
      const material = new THREE.MeshStandardMaterial({
        color: PALETTE[part],
        roughness: part === 'glass' ? 0.2 : part === 'frame' ? 0.55 : 0.85,
        metalness: part === 'glass' ? 0.1 : 0,
        emissive: part === 'lamp' ? PALETTE.lamp : part === 'glass' ? '#ffcf8a' : '#000000',
        emissiveIntensity: part === 'lamp' ? 0.9 : part === 'glass' ? 0.12 : 0,
      })
      material.name = `cafe_${part}`
      return { geometry, material, name: `cafe_${part}` }
    })
  return cafeMeshes
}

/** The café body in its local frame (storefront toward +z). */
export function CornerCafeBody() {
  return (
    <group name="corner-cafe-body">
      {getCafeMeshes().map((m) => (
        <mesh
          key={m.name}
          name={m.name}
          geometry={m.geometry}
          material={m.material}
          castShadow={m.name !== 'cafe_glass' && m.name !== 'cafe_lamp'}
          receiveShadow
        />
      ))}
    </group>
  )
}

// ---- Café frontage paving -------------------------------------------------------------------

// World rectangle in front of the café door (the café front is at world x ≈ −14.3, door z −3):
// out to the table set and between the two planters, inside the plaza plane.
const APRON = { minX: -14.35, maxX: -11.0, minZ: -6.95, maxZ: 0.95 }
const SLAB = 0.6
const SLAB_SHADES = ['#d6cab5', '#d1c5ae', '#dacfbb', '#cdc0a9']

let apronTexture: THREE.CanvasTexture | null | undefined

/** Large-format square slabs with a darker kerb border; null where no DOM canvas exists. */
function getApronTexture(): THREE.CanvasTexture | null {
  if (apronTexture !== undefined) return apronTexture
  if (typeof document === 'undefined') return (apronTexture = null)
  const w = APRON.maxX - APRON.minX
  const d = APRON.maxZ - APRON.minZ
  const PX = 96 // pixels per metre
  const canvas = document.createElement('canvas')
  canvas.width = Math.round(w * PX)
  canvas.height = Math.round(d * PX)
  const ctx = canvas.getContext('2d')
  if (!ctx) return (apronTexture = null)
  const rng = createRng(hashString('corner_cafe_apron'))
  ctx.fillStyle = '#b6aa95'
  ctx.fillRect(0, 0, canvas.width, canvas.height)
  const kerb = 0.14 * PX
  const gap = 2
  for (let y = kerb; y < canvas.height - kerb; y += SLAB * PX) {
    for (let x = kerb; x < canvas.width - kerb; x += SLAB * PX) {
      ctx.fillStyle = SLAB_SHADES[Math.floor(rng() * SLAB_SHADES.length)]
      const sw = Math.min(SLAB * PX, canvas.width - kerb - x)
      const sh = Math.min(SLAB * PX, canvas.height - kerb - y)
      ctx.fillRect(x + gap / 2, y + gap / 2, sw - gap, sh - gap)
    }
  }
  // A thin kerb border, only slightly darker than the slabs so the apron edge reads without boxing it in.
  ctx.strokeStyle = '#a39782'
  ctx.lineWidth = kerb
  ctx.strokeRect(kerb / 2, kerb / 2, canvas.width - kerb, canvas.height - kerb)
  const texture = new THREE.CanvasTexture(canvas)
  texture.colorSpace = THREE.SRGBColorSpace
  texture.anisotropy = 4
  return (apronTexture = texture)
}

/** The paving apron, a few millimetres above the plaza plane (no collider, no shadow casting). */
export function CafeFrontPaving() {
  const texture = getApronTexture()
  const w = APRON.maxX - APRON.minX
  const d = APRON.maxZ - APRON.minZ
  return (
    <mesh
      name="cafe-front-paving"
      rotation-x={-Math.PI / 2}
      position={[(APRON.minX + APRON.maxX) / 2, 0.028, (APRON.minZ + APRON.maxZ) / 2]}
      receiveShadow
    >
      <planeGeometry args={[w, d]} />
      {texture ? (
        <meshStandardMaterial map={texture} roughness={0.9} polygonOffset polygonOffsetFactor={-1} />
      ) : (
        <meshStandardMaterial color="#c6b9a2" roughness={0.9} polygonOffset polygonOffsetFactor={-1} />
      )}
    </mesh>
  )
}

// ---- Café planters ----------------------------------------------------------------------------

const planterBox = new THREE.MeshStandardMaterial({ color: '#4a3a2e', roughness: 0.8 })
const planterRim = new THREE.MeshStandardMaterial({ color: PALETTE.terracotta, roughness: 0.75 })
const hedgeMat = new THREE.MeshStandardMaterial({ color: '#4d7843', roughness: 0.95 })
const bloomMat = new THREE.MeshStandardMaterial({ color: PALETTE.cream, roughness: 0.7 })
const planterBoxGeo = new THREE.BoxGeometry(1.34, 0.4, 0.5)
const planterRimGeo = new THREE.BoxGeometry(1.4, 0.06, 0.56)
// A clipped box-hedge: a squared, softly rounded block rather than loose balls or a tube.
const hedgeGeo = new RoundedBoxGeometry(1.22, 0.34, 0.42, 3, 0.09)
const bloomGeo = new THREE.IcosahedronGeometry(0.035, 0)
const BLOOMS: [number, number, number][] = [
  [-0.44, 0.78, 0.08],
  [-0.2, 0.78, -0.06],
  [0.06, 0.78, 0.09],
  [0.3, 0.78, -0.05],
  [0.5, 0.78, 0.06],
]

/**
 * The café's two planters: a dark-stained timber box with a terracotta rim (the café's accent)
 * and a clipped hedge with a few cream blooms. It stays inside the `planter` visual envelope
 * (1.4 × 0.56 m, 0.84 m tall) and its existing collider.
 */
export function CafePlanter() {
  return (
    <group name="cafe-planter">
      <mesh geometry={planterBoxGeo} material={planterBox} position={[0, 0.2, 0]} castShadow receiveShadow />
      <mesh geometry={planterRimGeo} material={planterRim} position={[0, 0.43, 0]} castShadow />
      <mesh geometry={hedgeGeo} material={hedgeMat} position={[0, 0.6, 0]} castShadow />
      {BLOOMS.map((pos, i) => (
        <mesh key={i} geometry={bloomGeo} material={bloomMat} position={pos} />
      ))}
    </group>
  )
}
