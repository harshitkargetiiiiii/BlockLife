// @vitest-environment node
// (the GLB chunks are parsed directly from the shipped bytes; jsdom mis-handles that.)
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { ASSET_MANIFEST, ASSET_MANIFEST_BY_ID, type AssetManifestEntry } from './assetManifest'
import { BUILDINGS } from '../world/cityLayout'
import { resolveBuildingVisual } from '../world/buildingProjection'
import { VEHICLE_DEFS } from '../vehicles/vehicleRegistry'
import { shellMeshScale } from '../vehicles/vehicleProjection'
import { CHARACTER_ASSETS, WAVE4_NAMED_BODIES } from '../characters/characterManifest'
import { BODY_BUILDS } from '../characters/characterMaterials'
import { AMBIENT_RIG_SCALE } from '../citizens/AmbientCitizens'
import {
  CAMERA_CLEARANCE,
  CAMERA_EYE_HEIGHT,
  CAMERA_OFFSET,
  MAX_WORLD_RENDER_HEIGHT,
  cameraClearanceOf,
  containsCameraEye,
} from '../camera/cameraGeometry'
import { MAX_RENDERED_HEIGHT as WAVE3_MAX_RENDERED_HEIGHT } from '../../../scripts/asset-intake/wave3.config.mjs'

/**
 * Issue #46 §2 — the camera-clearance invariant, gated against the REAL committed bytes for
 * EVERY manifest entry that renders in the world, not just Wave 3's.
 *
 * Wave 3 (#44) discovered that a body tall enough to contain the camera eye passes every
 * static gate in the repo and is caught only by a screenshot. It then fixed that with a
 * literal in its own intake config, enforced for its own six bodies. This file promotes the
 * rule: `src/game/camera/cameraGeometry.ts` derives the ceiling from `CAMERA_OFFSET`, and
 * everything that renders in the world is measured against it here.
 *
 * Nothing below trusts the manifest's own `bounds` / `renderedTopY` claims, the provenance
 * files or any sprint report: each GLB's bounding box is re-read from the shipped file and
 * every rendered height is recomputed through the exact transform chain the renderer applies.
 */

// ---- GLB bounding box, straight from the shipped bytes ---------------------

/** The JSON chunk of a .glb container. */
function readGlbJson(path: string): GltfJson {
  const buf = readFileSync(path)
  let offset = 12 // 12-byte header
  while (offset < buf.length) {
    const len = buf.readUInt32LE(offset)
    const type = buf.readUInt32LE(offset + 4)
    if (type === 0x4e4f534a) return JSON.parse(buf.subarray(offset + 8, offset + 8 + len).toString('utf8'))
    offset += 8 + len
  }
  throw new Error(`${path}: no JSON chunk`)
}

interface GltfNode {
  mesh?: number
  children?: number[]
  matrix?: number[]
  translation?: [number, number, number]
  rotation?: [number, number, number, number]
  scale?: [number, number, number]
}
interface GltfJson {
  scene?: number
  scenes?: { nodes?: number[] }[]
  nodes: GltfNode[]
  meshes: { primitives: { attributes: Record<string, number> }[] }[]
  accessors: { min?: number[]; max?: number[] }[]
}

type Mat4 = number[] // column-major, three.js/glTF convention

const IDENTITY: Mat4 = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]

function multiply(a: Mat4, b: Mat4): Mat4 {
  const o = new Array<number>(16)
  for (let c = 0; c < 4; c++) {
    for (let r = 0; r < 4; r++) {
      o[c * 4 + r] = a[r] * b[c * 4] + a[4 + r] * b[c * 4 + 1] + a[8 + r] * b[c * 4 + 2] + a[12 + r] * b[c * 4 + 3]
    }
  }
  return o
}

/** A glTF node's local matrix, from an explicit `matrix` or its TRS components. */
function nodeMatrix(n: GltfNode): Mat4 {
  if (n.matrix) return n.matrix.slice()
  const [tx, ty, tz] = n.translation ?? [0, 0, 0]
  const [x, y, z, w] = n.rotation ?? [0, 0, 0, 1]
  const [sx, sy, sz] = n.scale ?? [1, 1, 1]
  const x2 = x + x, y2 = y + y, z2 = z + z
  const xx = x * x2, xy = x * y2, xz = x * z2
  const yy = y * y2, yz = y * z2, zz = z * z2
  const wx = w * x2, wy = w * y2, wz = w * z2
  return [
    (1 - (yy + zz)) * sx, (xy + wz) * sx, (xz - wy) * sx, 0,
    (xy - wz) * sy, (1 - (xx + zz)) * sy, (yz + wx) * sy, 0,
    (xz + wy) * sz, (yz - wx) * sz, (1 - (xx + yy)) * sz, 0,
    tx, ty, tz, 1,
  ]
}

function transformPoint(m: Mat4, x: number, y: number, z: number): [number, number, number] {
  return [
    m[0] * x + m[4] * y + m[8] * z + m[12],
    m[1] * x + m[5] * y + m[9] * z + m[13],
    m[2] * x + m[6] * y + m[10] * z + m[14],
  ]
}

export interface Bounds3 {
  min: [number, number, number]
  max: [number, number, number]
}

/**
 * Scene-graph-aware model-local bounding box, with every node matrix applied — the same
 * measurement `scripts/asset-intake/lib.mjs` makes with gltf-transform, recomputed here from
 * the accessor extrema the glTF spec REQUIRES on POSITION, so the contract needs no
 * pipeline dependency and reads the file the browser actually fetches.
 */
export function measureGlbBounds(path: string): Bounds3 {
  const j = readGlbJson(path)
  const min: [number, number, number] = [Infinity, Infinity, Infinity]
  const max: [number, number, number] = [-Infinity, -Infinity, -Infinity]
  const scene = j.scenes?.[j.scene ?? 0]
  const visit = (index: number, parent: Mat4): void => {
    const n = j.nodes[index]
    const world = multiply(parent, nodeMatrix(n))
    if (n.mesh != null) {
      for (const prim of j.meshes[n.mesh].primitives ?? []) {
        const acc = j.accessors[prim.attributes.POSITION]
        // A POSITION accessor without min/max is invalid glTF; refusing it keeps this
        // measurement honest instead of silently returning an empty box.
        expect(acc?.min && acc?.max, `${path}: POSITION accessor carries min/max`).toBeTruthy()
        for (let corner = 0; corner < 8; corner++) {
          const p = transformPoint(
            world,
            corner & 1 ? acc.max![0] : acc.min![0],
            corner & 2 ? acc.max![1] : acc.min![1],
            corner & 4 ? acc.max![2] : acc.min![2],
          )
          for (let a = 0; a < 3; a++) {
            if (p[a] < min[a]) min[a] = p[a]
            if (p[a] > max[a]) max[a] = p[a]
          }
        }
      }
    }
    for (const child of n.children ?? []) visit(child, world)
  }
  for (const root of scene?.nodes ?? []) visit(root, IDENTITY)
  expect(Number.isFinite(max[1]), `${path}: measured a non-empty bounding box`).toBe(true)
  return { min, max }
}

// ---- the renderer's transform chain, recomputed -----------------------------

/**
 * Top of the GLB body inside its `LandmarkAsset` group, i.e. after the manifest's own
 * rotation → scale → positionOffset. `entry.rotation` is applied to the measured box's eight
 * corners rather than assumed to be yaw-only, so a future X/Z rotation is measured, not missed.
 */
export function manifestTopY(entry: AssetManifestEntry, bounds: Bounds3): number {
  const [rx, ry, rz] = entry.rotation
  const cx = Math.cos(rx), sx = Math.sin(rx)
  const cy = Math.cos(ry), sy = Math.sin(ry)
  const cz = Math.cos(rz), sz = Math.sin(rz)
  // three.js Euler 'XYZ' → the Y row of R = Rx·Ry·Rz that a corner's y coordinate needs.
  const m10 = cx * sz + cz * sx * sy
  const m11 = cx * cz - sx * sy * sz
  const m12 = -cy * sx
  let top = -Infinity
  for (let corner = 0; corner < 8; corner++) {
    const x = (corner & 1 ? bounds.max[0] : bounds.min[0]) * entry.scale[0]
    const y = (corner & 2 ? bounds.max[1] : bounds.min[1]) * entry.scale[1]
    const z = (corner & 4 ? bounds.max[2] : bounds.min[2]) * entry.scale[2]
    top = Math.max(top, m10 * x + m11 * y + m12 * z)
  }
  return top + entry.positionOffset[1]
}

/** Every entry that actually fetches a file (the only ones that can render a GLB body). */
const RENDERING = ASSET_MANIFEST.filter((e) => e.enabled && e.glbPath)

/** Entries placed in the world by `LandmarkAsset` with the manifest TRS as the final transform. */
const WORLD_BODIES = RENDERING.filter((e) => e.category === 'city' || e.category === 'props')

const measured = new Map<string, Bounds3>()
const boundsOf = (e: AssetManifestEntry): Bounds3 => {
  let b = measured.get(e.id)
  if (!b) {
    b = measureGlbBounds(`public/${e.glbPath}`)
    measured.set(e.id, b)
  }
  return b
}

describe('issue #46 §2 — camera clearance is a world invariant, not a Wave 3 rule', () => {
  it('the ceiling is DERIVED from the camera offset, not written down', () => {
    expect(CAMERA_OFFSET, 'FollowCamera diorama offset').toEqual([12, 18, 12])
    expect(CAMERA_EYE_HEIGHT, 'camera eye height = offset Y').toBe(CAMERA_OFFSET[1])
    expect(MAX_WORLD_RENDER_HEIGHT, 'ceiling = eye height − clearance').toBe(CAMERA_EYE_HEIGHT - CAMERA_CLEARANCE)
    expect(MAX_WORLD_RENDER_HEIGHT, 'ceiling leaves real air under the eye').toBeLessThan(CAMERA_EYE_HEIGHT)
    expect(CAMERA_CLEARANCE, 'clearance covers the 0.5m roof slab and the 6m look-ahead').toBeGreaterThan(0.5)
    expect(cameraClearanceOf(MAX_WORLD_RENDER_HEIGHT)).toBe(CAMERA_CLEARANCE)
    expect(containsCameraEye(CAMERA_EYE_HEIGHT)).toBe(true)
    expect(containsCameraEye(MAX_WORLD_RENDER_HEIGHT)).toBe(false)
  })

  it('the Wave 3 intake ceiling is the SAME number, not a second copy of it', () => {
    // Wave 3's config still owns the literal (plain node tooling can't import TypeScript), so
    // this is the join: divergence fails here rather than shipping a body the camera rule no
    // longer covers.
    expect(WAVE3_MAX_RENDERED_HEIGHT, 'wave3.config.mjs MAX_RENDERED_HEIGHT').toBe(MAX_WORLD_RENDER_HEIGHT)
  })

  it('every world-rendered manifest entry stands below the ceiling (measured bytes)', () => {
    expect(WORLD_BODIES.length, 'world-rendered entries under test').toBeGreaterThanOrEqual(15)
    const report: string[] = []
    for (const entry of WORLD_BODIES) {
      const top = manifestTopY(entry, boundsOf(entry))
      report.push(`${entry.id} top=${top.toFixed(4)} clearance=${cameraClearanceOf(top).toFixed(4)}`)
      expect(containsCameraEye(top), `${entry.id} renders ${top.toFixed(2)}u — contains the camera eye`).toBe(false)
      expect(top, `${entry.id} rendered height`).toBeLessThanOrEqual(MAX_WORLD_RENDER_HEIGHT)
    }
    // The gate is only meaningful if something is actually near the ceiling — a suite where
    // every body is a bollard would pass vacuously forever.
    const tallest = Math.max(...WORLD_BODIES.map((e) => manifestTopY(e, boundsOf(e))))
    expect(tallest, `tallest world body\n${report.join('\n')}`).toBeGreaterThan(MAX_WORLD_RENDER_HEIGHT * 0.9)
  })

  it('every world body DECLARES the rendered top occlusion depends on, and it matches the bytes', () => {
    // `renderedTopY` is what `occluderData` uses to cover the mass a projected body really has
    // (issue #46 §3). The runtime cannot measure a GLB synchronously, so the number is declared
    // in the manifest — which makes it exactly the kind of hand-copied value that silently goes
    // stale. Recompute it here from the shipped bytes, through the renderer's own transform
    // chain, so a re-scaled or replaced body fails this instead of quietly under-occluding.
    const cityBodies = RENDERING.filter((e) => e.category === 'city')
    expect(cityBodies.length, 'city bodies that can be occluders').toBeGreaterThanOrEqual(10)
    for (const entry of cityBodies) {
      expect(entry.renderedTopY, `${entry.id} declares renderedTopY`).toBeTypeOf('number')
      expect(entry.renderedTopY!, `${entry.id} renderedTopY vs the shipped bytes`).toBeCloseTo(
        manifestTopY(entry, boundsOf(entry)),
        3,
      )
    }
  })

  it('every VEHICLE body clears the camera at its EXACT final runtime scale', () => {
    // The manifest scale is not the last word for a vehicle: the ONE shell wears
    // `shellMeshScale(collider)` for the active class, which MULTIPLIES the GLB's own scale
    // (the van ends up 1.27x taller than its manifest row alone suggests). Checking the manifest
    // scale on its own is a lower bound, and a lower bound is not a clearance guarantee.
    const withBody = VEHICLE_DEFS.filter((d) => d.assetId)
    expect(withBody.length, 'vehicle classes with a GLB body').toBeGreaterThanOrEqual(4)
    for (const def of withBody) {
      const entry = ASSET_MANIFEST_BY_ID.get(def.assetId!)
      expect(entry, `${def.id} manifest entry`).toBeTruthy()
      if (!entry!.enabled || !entry!.glbPath) continue
      const meshY = shellMeshScale(def.collider)[1]
      const top = manifestTopY(entry!, boundsOf(entry!)) * meshY
      expect(containsCameraEye(top), `${def.id} renders ${top.toFixed(2)}u — contains the camera eye`).toBe(false)
      expect(top, `${def.id} rendered height`).toBeLessThanOrEqual(MAX_WORLD_RENDER_HEIGHT)
      // …and the manifest's declared bounds are stated in that same final world space, so a
      // future body cannot drift from what the shell actually wears.
      if (entry!.bounds) expect(entry!.bounds.height, `${def.id} declared bounds`).toBeCloseTo(top, 3)
    }
  })

  /** Bodies fitted to the reference rig by issue #47 — see the note on the upper bound below. */
  const FITTED_TO_RIG = new Set(Object.values(WAVE4_NAMED_BODIES))

  it('every CHARACTER body clears the camera at its EXACT final runtime scale', () => {
    // Characters are NOT measured from the GLB here, on purpose. Their meshes are skinned, and a
    // skinned mesh ignores its node matrix at render time (the skin's joint matrices drive it),
    // so the scene-graph bounding box this file computes for static bodies is meaningless for
    // them — it reads a couple of centimetres for a 1.8 m person. The authored contract is
    // `bounds.visualHeight`, which `characterManifest` validates as plausible, and the final
    // transform is `verticalOffset + scale x bodyBuild.y x visualHeight`.
    const tallestBuild = Math.max(...Object.values(BODY_BUILDS).map((b) => b[1]))
    expect(tallestBuild, 'the tallest body build in the population registry').toBeGreaterThanOrEqual(1)
    const defs = Object.values(CHARACTER_ASSETS)
    expect(defs.length, 'character assets').toBeGreaterThanOrEqual(5)
    for (const def of defs) {
      const top = (def.verticalOffset ?? 0) + def.scale * tallestBuild * def.bounds.visualHeight
      expect(containsCameraEye(top), `${def.id} at ${top.toFixed(2)}u contains the camera eye`).toBe(false)
      expect(top, `${def.id} rendered height`).toBeLessThanOrEqual(MAX_WORLD_RENDER_HEIGHT)
      // A person is person-sized: this is the check that would catch a unit-scale mistake, which
      // is the realistic way a character ever ends up near the camera.
      expect(top, `${def.id} is a plausible human height`).toBeGreaterThan(1)
      // The upper bound is expressed in DECLARED arithmetic, and issue #47 found that the two do
      // not agree for the reference rig: `blocklife_person` declares `visualHeight: 1.92` but its
      // shipped bytes measure 2.930 m, which is also what it renders (verified in the running
      // scene — every mounted `blocklife_person` reports a world Box3 of h = 2.930 with feet at
      // y = 0). A Wave 4 body is FITTED to that real 2.930 m so its NPC does not change size, so
      // its `scale x visualHeight` is 2.930 by construction and necessarily exceeds a bound
      // calibrated against the rig's understated declaration. Those bodies are held to a STRICTER
      // rule instead — `wave4Contract.test.ts` asserts each one renders at exactly the reference
      // rig's measured height, per body, with every height pinned to the sha256 of the file it was
      // measured from. Correcting the rig's own declaration would move the PLAYER's authored
      // bounds, which issue #47 forbids; it is recorded for a later issue.
      if (!FITTED_TO_RIG.has(def.id)) {
        expect(top, `${def.id} is a plausible human height`).toBeLessThan(3)
      }
    }
    // The bounded rigged ambient crowd renders the same rig SMALLER, so the build above is the
    // maximum applicable and this stays the worst case.
    expect(AMBIENT_RIG_SCALE, 'the ambient crowd only ever shrinks the rig').toBeLessThan(1)
  })

  it('every authored building box — placement AND projection — stays under the eye', () => {
    // The authored box is the gameplay authority (collider/occluder/routing); the projected
    // GLB is what a player sees. BOTH have to clear the camera, and they are different numbers.
    const byId = new Map(ASSET_MANIFEST.map((e) => [e.id, e]))
    let tallestBox = 0
    let tallestRendered = 0
    for (const def of BUILDINGS) {
      // + the 0.5m roof slab BuildingMesh caps every authored box with.
      const boxTop = def.size[1] + 0.5
      tallestBox = Math.max(tallestBox, boxTop)
      expect(containsCameraEye(boxTop), `${def.id} authored box (${boxTop}u) contains the camera eye`).toBe(false)

      const visual = resolveBuildingVisual(def)
      const entry = byId.get(visual?.assetId ?? def.id)
      if (!entry?.enabled || !entry.glbPath) continue
      // Buildings.tsx nests the projection group AROUND the manifest primitive, so the
      // projection's Y scale and offset multiply the manifest top — the composition an
      // entry-only check misses.
      const rendered = visual
        ? visual.offset[1] + visual.scale[1] * manifestTopY(entry, boundsOf(entry))
        : manifestTopY(entry, boundsOf(entry))
      tallestRendered = Math.max(tallestRendered, rendered)
      expect(rendered, `${def.id} renders ${rendered.toFixed(2)}u via ${entry.id}`).toBeLessThanOrEqual(
        MAX_WORLD_RENDER_HEIGHT,
      )
    }
    expect(tallestBox, 'the city really does have a near-camera building').toBeGreaterThan(CAMERA_EYE_HEIGHT * 0.9)
    expect(tallestRendered, 'a projected body really does approach the ceiling').toBeGreaterThan(
      MAX_WORLD_RENDER_HEIGHT * 0.9,
    )
  })
})
