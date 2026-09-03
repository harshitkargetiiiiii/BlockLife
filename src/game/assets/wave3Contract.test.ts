// @vitest-environment node
// (the GLB binary chunks are read directly; jsdom mis-handles that.)
import { createHash } from 'node:crypto'
import { readdirSync, readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { ASSET_MANIFEST, ASSET_MANIFEST_BY_ID } from './assetManifest'
import { BUILDINGS } from '../world/cityLayout'
import { WINDOW_OVERLAYS } from '../world/windowOverlayData'
import { getBuildingOccluderDescriptor } from '../visibility/occluderData'
import { resolveBuildingVisual } from '../world/buildingProjection'
import type { BuildingDef } from '../world/worldTypes'
import {
  BOUNDS_EPSILON, SCALE_DECIMALS, MAX_TEXTURE, MAX_RENDERED_HEIGHT, BUILDINGS as WAVE3_SOURCES,
} from '../../../scripts/asset-intake/wave3.config.mjs'
import provenance from '../../../docs/asset-provenance/wave3-provenance.json'

/**
 * Issue #44 Integration Wave 3 — production BUILDING asset contract, asserted against the REAL
 * committed bytes. Nothing here trusts the sprint report, the issue table or the provenance
 * file's own claims: every structural fact is re-parsed from the GLB that actually ships, and
 * every projection number is recomputed from `BUILDINGS` in cityLayout rather than copied from
 * the manifest.
 */

type Facing = 'north' | 'south' | 'east' | 'west'

/** The EXACT nine placements issue #44 pins, and the approved body each one projects. */
const PROJECTION: {
  placement: string
  assetId: string
  file: string
  /** How the placement reaches the body: its own manifest row, or BuildingDef.visual. */
  via: 'manifestId' | 'visual'
  /** Measured front of the model, from the rendered cardinals + the provenance facade profile. */
  canonicalFacing: Facing
}[] = [
  { placement: 'building_apartment_01', assetId: 'building_apartment_01', file: 'public/assets/models/city/arch_apartment_01.glb', via: 'manifestId', canonicalFacing: 'south' },
  { placement: 'building_shop_01', assetId: 'building_shop_01', file: 'public/assets/models/city/arch_shop_01.glb', via: 'manifestId', canonicalFacing: 'south' },
  { placement: 'building_house_01', assetId: 'arch_house_01', file: 'public/assets/models/city/arch_house_01.glb', via: 'visual', canonicalFacing: 'south' },
  { placement: 'building_house_r2', assetId: 'arch_house_01', file: 'public/assets/models/city/arch_house_01.glb', via: 'visual', canonicalFacing: 'south' },
  { placement: 'building_house_w2', assetId: 'arch_house_01', file: 'public/assets/models/city/arch_house_01.glb', via: 'visual', canonicalFacing: 'south' },
  { placement: 'building_house_s2', assetId: 'arch_house_01', file: 'public/assets/models/city/arch_house_01.glb', via: 'visual', canonicalFacing: 'south' },
  { placement: 'building_townhomes_01', assetId: 'building_townhomes_01', file: 'public/assets/models/city/arch_row_house_01.glb', via: 'manifestId', canonicalFacing: 'south' },
  { placement: 'building_garage_01', assetId: 'building_garage_01', file: 'public/assets/models/city/arch_repair_garage_01.glb', via: 'manifestId', canonicalFacing: 'south' },
  { placement: 'building_gate_hotel_01', assetId: 'building_gate_hotel_01', file: 'public/assets/models/city/arch_hotel_01.glb', via: 'manifestId', canonicalFacing: 'south' },
]

/** The six approved bodies, in provenance order. */
const BODIES = [
  'public/assets/models/city/arch_apartment_01.glb',
  'public/assets/models/city/arch_shop_01.glb',
  'public/assets/models/city/arch_house_01.glb',
  'public/assets/models/city/arch_row_house_01.glb',
  'public/assets/models/city/arch_repair_garage_01.glb',
  'public/assets/models/city/arch_hotel_01.glb',
]

/** scripts/assetReport.mjs TRI_BUDGET.city. */
const CITY_TRI_BUDGET = 60000

/**
 * The authored facts these nine placements shipped with at the exact base commit (b0d8ab6).
 * Issue #44 requires every one of them to survive untouched, so the whole tuple is pinned
 * rather than a count: a wave that "fits" a model by nudging a lot would fail right here.
 */
const AUTHORED: Record<string, {
  position: [number, number]
  size: [number, number, number]
  door: Facing
  label?: string
  windows?: boolean
}> = {
  building_apartment_01: { position: [-14.5, -14.5], size: [9, 7.5, 9], door: 'south', label: 'Sunrise Apartments' },
  building_shop_01: { position: [-5, -17.5], size: [6, 5, 6], door: 'south', label: 'Mini Mart' },
  building_house_01: { position: [0.5, 15], size: [5.5, 4.5, 5.5], door: 'north' },
  building_house_r2: { position: [-6, -54.5], size: [5.5, 4.5, 5.5], door: 'south' },
  building_house_w2: { position: [-57, -5], size: [5.5, 4.5, 5.5], door: 'east' },
  building_house_s2: { position: [-4, 41], size: [5.5, 4.2, 5.5], door: 'south' },
  building_townhomes_01: { position: [20, -54], size: [7, 6, 7], door: 'south', label: 'Townhomes — coming soon' },
  building_garage_01: { position: [59.5, 8], size: [8, 5.5, 7], door: 'west', label: 'Garage — coming soon', windows: false },
  building_gate_hotel_01: { position: [63, -110], size: [9, 13, 8], door: 'west', label: 'Hotel — coming soon' },
}

/** Minimal GLB JSON-chunk reader — same approach as scripts/assetReport.mjs. */
function readGlb(path: string) {
  const buf = readFileSync(path)
  const length = buf.readUInt32LE(8)
  let offset = 12
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let json: any = null
  let bin: Buffer | null = null
  while (offset + 8 <= length) {
    const chunkLen = buf.readUInt32LE(offset)
    const chunkType = buf.readUInt32LE(offset + 4)
    const data = buf.subarray(offset + 8, offset + 8 + chunkLen)
    if (chunkType === 0x4e4f534a) json = JSON.parse(data.toString('utf8'))
    else if (chunkType === 0x004e4942) bin = data
    offset += 8 + chunkLen
  }
  return { json, bin }
}

function imageDims(bytes: Buffer) {
  if (bytes[0] === 0x89 && bytes[1] === 0x50) return { w: bytes.readUInt32BE(16), h: bytes.readUInt32BE(20) }
  if (bytes[0] === 0xff && bytes[1] === 0xd8) {
    let o = 2
    while (o + 9 < bytes.length) {
      if (bytes[o] !== 0xff) { o++; continue }
      const m = bytes[o + 1]
      if (m >= 0xc0 && m <= 0xcf && m !== 0xc4 && m !== 0xc8 && m !== 0xcc) {
        return { h: bytes.readUInt16BE(o + 5), w: bytes.readUInt16BE(o + 7) }
      }
      o += 2 + bytes.readUInt16BE(o + 2)
    }
  }
  return null
}

function textureDims(path: string) {
  const { json, bin } = readGlb(path)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (json.images ?? []).map((img: any) => {
    const v = json.bufferViews[img.bufferView]
    return imageDims(bin!.subarray(v.byteOffset ?? 0, (v.byteOffset ?? 0) + v.byteLength))
  })
}

function triangles(path: string) {
  const { json } = readGlb(path)
  let tris = 0
  for (const mesh of json.meshes ?? []) {
    for (const prim of mesh.primitives ?? []) {
      const count = prim.indices != null
        ? json.accessors[prim.indices].count
        : json.accessors[prim.attributes.POSITION].count
      tris += count / 3
    }
  }
  return Math.round(tris)
}

/** The provenance record for a shipped output, keyed by the file it claims to have produced. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const recordFor = (file: string) => provenance.assets.find((a: any) => a.output === file)!

const defFor = (id: string) => BUILDINGS.find((b) => b.id === id) as BuildingDef

const FACING_YAW: Record<Facing, number> = { south: 0, north: Math.PI, east: Math.PI / 2, west: -Math.PI / 2 }

/**
 * The Wave 3 projection rule, recomputed here from the AUTHORED footprint and the measured
 * bounds — never read from the manifest. See scripts/asset-intake/wave3.config.mjs.
 *
 * A ±90° yaw swaps which measured half-extent faces which lot axis; computing the fit before
 * the yaw is exactly how a body ends up overhanging one axis while under-filling the other.
 */
function derivedFit(file: string, lot: [number, number, number], yaw: number) {
  const { min, max, size } = recordFor(file).structure.bounds
  const hxModel = Math.max(Math.abs(min[0]), Math.abs(max[0])) + BOUNDS_EPSILON
  const hzModel = Math.max(Math.abs(min[2]), Math.abs(max[2])) + BOUNDS_EPSILON
  const swapped = Math.abs(Math.sin(yaw)) > 0.5
  const hx = swapped ? hzModel : hxModel
  const hz = swapped ? hxModel : hzModel
  // Three bounds, not two: the authored footprint on each axis AND the camera-engulf ceiling.
  const k = Math.min(
    lot[0] / 2 / hx,
    lot[2] / 2 / hz,
    MAX_RENDERED_HEIGHT / (size[1] + BOUNDS_EPSILON),
  )
  const scale = Math.floor(k * 10 ** SCALE_DECIMALS) / 10 ** SCALE_DECIMALS
  return {
    scale,
    /** MODEL-LOCAL extents at this scale — the convention `entry.bounds` uses. */
    local: { width: size[0] * scale, height: size[1] * scale, depth: size[2] * scale },
    /** WORLD half-extents on the lot, after the yaw. */
    halfX: (hx - BOUNDS_EPSILON) * scale,
    halfZ: (hz - BOUNDS_EPSILON) * scale,
  }
}

describe('issue #44 Wave 3 — production building GLB contract (real bytes)', () => {
  // ---- the manifest side ----
  it('every Wave 3 manifest entry is enabled, keeps BuildingMesh, and carries budget + credits', () => {
    const seen = new Set<string>()
    for (const { assetId, file } of PROJECTION) {
      if (seen.has(assetId)) continue
      seen.add(assetId)
      const entry = ASSET_MANIFEST_BY_ID.get(assetId)
      expect(entry, `manifest entry ${assetId}`).toBeTruthy()
      expect(entry!.category, `${assetId} category`).toBe('city')
      expect(entry!.enabled, `${assetId} enabled`).toBe(true)
      expect(`public/${entry!.glbPath}`, `${assetId} glbPath`).toBe(file)
      // The GLB is a projection, never a dependency: the procedural component stays declared.
      expect(entry!.fallbackKey, `${assetId} fallbackKey`).toBe('BuildingMesh')
      expect(entry!.attribution, `${assetId} attribution`).toBeTruthy()
      expect(entry!.license, `${assetId} license`).toBeTruthy()
      expect(entry!.budget?.maxTriangles, `${assetId} triangle budget`).toBe(CITY_TRI_BUDGET)
    }
    expect(seen.size, 'six approved bodies over nine placements').toBe(6)
  })

  it('projects EXACTLY the nine pinned placements — every other authored building is untouched', () => {
    const projected = new Set(PROJECTION.map((p) => p.placement))
    expect([...projected].sort()).toEqual([
      'building_apartment_01', 'building_garage_01', 'building_gate_hotel_01',
      'building_house_01', 'building_house_r2', 'building_house_s2', 'building_house_w2',
      'building_shop_01', 'building_townhomes_01',
    ])
    const wave3Ids = new Set([...PROJECTION.map((p) => p.assetId)])
    for (const def of BUILDINGS) {
      if (projected.has(def.id)) continue
      // NEGATIVE ASSERTION: an unselected building must not resolve to a Wave 3 body, either
      // through its own manifest row or through a BuildingDef.visual projection.
      expect(wave3Ids.has(def.id), `${def.id} must not be a Wave 3 asset id`).toBe(false)
      expect(
        def.visual?.assetId && wave3Ids.has(def.visual.assetId),
        `${def.id} must not project a Wave 3 body`,
      ).toBeFalsy()
    }
    // The four house placements are one-per-district on purpose; the other authored houses keep
    // their existing look (building_house_r1 stays on the issue #25 archetype, the rest stay
    // procedural), which is what "do not globally replace all houses" means.
    const houses = BUILDINGS.filter((b) => b.id.startsWith('building_house_'))
    expect(houses.length, 'authored house placements').toBeGreaterThan(9)
    expect(houses.filter((b) => b.visual?.assetId === 'arch_house_01').map((b) => b.id).sort())
      .toEqual(['building_house_01', 'building_house_r2', 'building_house_s2', 'building_house_w2'])
    expect(defFor('building_house_r1').visual?.assetId, 'issue #25 archetype preserved')
      .toBe('arch_residential_house_01')
  })

  // ---- the gameplay side of the contract: nothing authored moved ----
  it('all nine placements keep their authored id, position, footprint, door, label and windows flag', () => {
    for (const { placement } of PROJECTION) {
      const def = defFor(placement)
      const want = AUTHORED[placement]
      expect(def, `${placement} still authored`).toBeTruthy()
      expect(def.position, `${placement} position`).toEqual(want.position)
      expect(def.size, `${placement} authored footprint`).toEqual(want.size)
      expect(def.door, `${placement} door`).toBe(want.door)
      expect(def.label, `${placement} label`).toBe(want.label)
      expect(def.windows, `${placement} windows flag`).toBe(want.windows)
    }
  })

  it('occluder identity still derives from the authored box, never from the model', () => {
    for (const { placement } of PROJECTION) {
      const def = defFor(placement)
      const occ = getBuildingOccluderDescriptor(def)
      const [w, h, d] = AUTHORED[placement].size
      expect(occ.bounds2D, `${placement} occluder footprint`).toEqual({
        minX: AUTHORED[placement].position[0] - w / 2,
        maxX: AUTHORED[placement].position[0] + w / 2,
        minZ: AUTHORED[placement].position[1] - d / 2,
        maxZ: AUTHORED[placement].position[1] + d / 2,
      })
      expect(occ.minY, `${placement} occluder minY`).toBe(0)
      expect(occ.maxY, `${placement} occluder maxY`).toBe(h + 0.5)
      expect(occ.fadeMode, `${placement} fade mode`).toBe('wholeObject')
      expect(occ.enabled, `${placement} participates in occlusion`).toBe(true)
      // No Wave 3 body bought itself an occlusion exemption.
      expect(ASSET_MANIFEST_BY_ID.get(placement)?.occlusion, `${placement} occlusion override`).toBeUndefined()
    }
  })

  // ---- the projection: recomputed from cityLayout, never copied from the manifest ----
  it('each body projects at the derived UNIFORM scale and fits inside its authored lot', () => {
    for (const { placement, assetId, file, canonicalFacing } of PROJECTION) {
      const entry = ASSET_MANIFEST_BY_ID.get(assetId)!
      const def = defFor(placement)
      const yaw = FACING_YAW[def.door as Facing] - FACING_YAW[canonicalFacing]

      // The yaw is what the runtime really applies: the manifest rotation for an id-keyed
      // placement, or the resolved BuildingDef.visual rotation for a projected one.
      const applied = def.visual ? resolveBuildingVisual(def)!.rotationY : entry.rotation[1]
      expect(Math.sin(applied), `${placement} applied yaw`).toBeCloseTo(Math.sin(yaw), 6)
      expect(Math.cos(applied), `${placement} applied yaw`).toBeCloseTo(Math.cos(yaw), 6)

      // UNIFORM scale — the approved proportions ship undistorted, on BOTH paths.
      const [sx, sy, sz] = entry.scale
      expect(sx, `${assetId} scale is uniform`).toBe(sy)
      expect(sy, `${assetId} scale is uniform`).toBe(sz)
      if (def.visual) {
        const v = resolveBuildingVisual(def)!
        expect(v.scale, `${placement} projection must not distort the body`).toEqual([1, 1, 1])
        expect(v.offset, `${placement} projection offset`).toEqual([0, 0, 0])
      }
      expect(entry.positionOffset, `${assetId} needs no manifest lift`).toEqual([0, 0, 0])

      const fit = derivedFit(file, def.size, yaw)
      expect(sx, `${assetId} scale is the derived value`).toBe(fit.scale)

      // ...and the RENDERED half-extents really fit inside the AUTHORED lot.
      expect(fit.halfX, `${placement} rendered half-X inside the lot`).toBeLessThanOrEqual(def.size[0] / 2)
      expect(fit.halfZ, `${placement} rendered half-Z inside the lot`).toBeLessThanOrEqual(def.size[2] / 2)

      // ...and it is the LARGEST such scale — SOME bound is saturated, so a body is never
      // silently shrunk to a doll's house by a copied constant. The bound may be either
      // authored footprint axis or the camera-engulf height ceiling.
      const fill = Math.max(
        fit.halfX / (def.size[0] / 2),
        fit.halfZ / (def.size[2] / 2),
        fit.local.height / MAX_RENDERED_HEIGHT,
      )
      expect(fill, `${placement} saturates one of its three bounds`).toBeGreaterThan(0.999)

      // The declared bounds are the REAL projection at model-local axes, so tooling that reads
      // `bounds` cannot disagree with what renders. (A yawed entry swaps width/depth in world
      // space; the lot containment above is what checks the world footprint.)
      expect(entry.bounds!.width, `${assetId} bounds.width`).toBeCloseTo(fit.local.width, 3)
      expect(entry.bounds!.height, `${assetId} bounds.height`).toBeCloseTo(fit.local.height, 3)
      expect(entry.bounds!.depth, `${assetId} bounds.depth`).toBeCloseTo(fit.local.depth, 3)
    }
  })

  it('no projected body is tall enough to contain the game camera', () => {
    // FollowCamera sits at `player + (12, 18, 12)` with `near: -200`. A body taller than that
    // 18 m puts the camera INSIDE it whenever the player is within its 16.97 m horizontal
    // reach, and the frame fills with the inside of a roof — which is exactly what a pure
    // footprint fit did to the apartment (24.31 m) and what seven Wave 0 candidate-character
    // baselines caught. The whole authored city already respects this: the tallest box is
    // building_tower_04 at 17 m.
    const CAMERA_HEIGHT = 18
    expect(MAX_RENDERED_HEIGHT, 'ceiling leaves real camera clearance').toBeLessThan(CAMERA_HEIGHT)
    for (const { placement, assetId } of PROJECTION) {
      const h = ASSET_MANIFEST_BY_ID.get(assetId)!.bounds!.height
      expect(h, `${placement} rendered height under the camera-engulf ceiling`)
        .toBeLessThanOrEqual(MAX_RENDERED_HEIGHT)
      expect(h, `${placement} cannot contain the camera`).toBeLessThan(CAMERA_HEIGHT)
    }
    // ...and no authored box in the city exceeds it either, so the invariant is city-wide.
    expect(Math.max(...BUILDINGS.map((b) => b.size[1])), 'tallest authored box').toBeLessThan(CAMERA_HEIGHT)
  })

  it('the apartment keeps the exact presentation envelope of the body it replaces', () => {
    // 25 m x 0.60 = 15 m is what the outgoing Quaternius Building_Medium_2 already rendered at,
    // down to its 16.2 label height. Preserving it — rather than growing it to 24.31 m — is
    // what keeps this placement's occlusion behaviour identical to the base commit.
    const entry = ASSET_MANIFEST_BY_ID.get('building_apartment_01')!
    expect(entry.scale).toEqual([0.6, 0.6, 0.6])
    expect(entry.bounds!.height).toBeCloseTo(15, 2)
    expect(entry.labelHeight, 'unchanged from the outgoing entry').toBe(16.2)
  })

  it('the reusable house archetype is facing-only — one uniform calibration, four districts', () => {
    // `maxScaleDeviation: 0` is what keeps the approved body uniform: building_house_s2's
    // authored height (4.2 vs the 4.5 reference) would otherwise squash it 6.7% on Y alone.
    const yaws: Record<string, number> = {
      building_house_01: Math.PI, building_house_r2: 0, building_house_w2: Math.PI / 2, building_house_s2: 0,
    }
    for (const [id, yaw] of Object.entries(yaws)) {
      const def = defFor(id)
      expect(def.visual!.assetId, `${id} archetype`).toBe('arch_house_01')
      expect(def.visual!.referenceSize, `${id} reference footprint`).toEqual([5.5, 4.5, 5.5])
      expect(def.visual!.canonicalFacing, `${id} canonical facing`).toBe('south')
      expect(def.visual!.maxScaleDeviation, `${id} scale deviation`).toBe(0)
      expect(def.visual!.paletteVariant, `${id} must not tint a baked atlas`).toBeUndefined()
      const v = resolveBuildingVisual(def)!
      expect(v.scale, `${id} resolved scale`).toEqual([1, 1, 1])
      expect(Math.sin(v.rotationY), `${id} resolved yaw`).toBeCloseTo(Math.sin(yaw), 6)
      expect(Math.cos(v.rotationY), `${id} resolved yaw`).toBeCloseTo(Math.cos(yaw), 6)
    }
    // Distinct per-building overlay seeds keep the reused archetype from reading as clones.
    const seeds = Object.keys(yaws).map((id) => resolveBuildingVisual(defFor(id))!.overlaySeed)
    expect(new Set(seeds).size, 'per-placement seeds').toBe(4)
    // A reusable ARCHETYPE and an authored PLACEMENT must never share an id.
    expect(BUILDINGS.some((b) => b.id === 'arch_house_01'), 'archetype is not a placement').toBe(false)
  })

  it('every shipped body sits ON the ground — the rendered minimum is exactly y = 0', () => {
    for (const file of BODIES) {
      const record = recordFor(file)
      expect(record.structure.bounds.min[1], `${file} rendered minimum`).toBe(0)
      // All six approved sources were already bottom-origin, so nothing was translated.
      expect(record.groundOffsetY, `${file} grounding offset`).toBe(0)
      expect(record.sources[0].structure.bounds.min[1], `${file} source minimum`).toBe(0)
      expect(record.structure.bounds.size, `${file} size unchanged by intake`)
        .toEqual(record.sources[0].structure.bounds.size)
    }
  })

  // ---- overlays: no ghost glow left on a baked facade ----
  it('no Wave 3 body carries a window-overlay grid, and the legacy apartment grid is gone', () => {
    for (const { placement, assetId } of PROJECTION) {
      expect(WINDOW_OVERLAYS.filter((d) => d.buildingAssetId === assetId), `${assetId} overlays`).toEqual([])
      expect(WINDOW_OVERLAYS.filter((d) => d.buildingAssetId === placement), `${placement} overlays`).toEqual([])
    }
    // The grids that remain belong to bodies that genuinely need them.
    expect([...new Set(WINDOW_OVERLAYS.map((d) => d.buildingAssetId))].sort())
      .toEqual(['building_gym_01', 'building_office_01', 'building_tower_01'])
  })

  // ---- structure, budgets and honesty of the shipped bytes ----
  it('each body keeps the approved geometry — one mesh, one material, inside the city tri budget', () => {
    for (const file of BODIES) {
      const record = recordFor(file)
      const { json } = readGlb(file)
      expect(json.meshes, `${file} mesh count`).toHaveLength(1)
      expect(json.materials, `${file} material count`).toHaveLength(1)
      // Triangles are unchanged from the approved source — intake reduces textures, not geometry.
      expect(triangles(file), `${file} triangles`).toBe(record.sources[0].structure.triangles)
      expect(triangles(file), `${file} triangle budget`).toBeLessThanOrEqual(CITY_TRI_BUDGET)
    }
  })

  it('every Wave 3 texture is at most 1024 and is a format the asset gate can measure', () => {
    expect(MAX_TEXTURE, 'wave 3 texture ceiling').toBe(1024)
    for (const file of BODIES) {
      const dims = textureDims(file)
      expect(dims.length, `${file} texture count`).toBe(1)
      for (const d of dims) {
        // A null here means the gate cannot measure the format (e.g. WebP) and would pass
        // vacuously — that is a failure, not a pass.
        expect(d, `${file} texture dimensions must be measurable (PNG/JPEG)`).not.toBeNull()
        expect(Math.max(d!.w, d!.h), `${file} texture edge`).toBeLessThanOrEqual(MAX_TEXTURE)
      }
    }
  })

  it('Wave 3 materials are non-emissive, non-metallic and free of stray scene objects', () => {
    for (const file of BODIES) {
      const { json } = readGlb(file)
      expect(json.cameras ?? [], `${file} cameras`).toHaveLength(0)
      expect(json.extensions?.KHR_lights_punctual?.lights ?? [], `${file} lights`).toHaveLength(0)
      expect((json.extensionsUsed ?? []).filter((e: string) => /draco|meshopt|ktx2|unlit/i.test(e)), `${file} loader deps`).toHaveLength(0)
      for (const m of json.materials ?? []) {
        const pbr = m.pbrMetallicRoughness ?? {}
        expect(pbr.metallicFactor ?? 1, `${file} material ${m.name} metallic`).toBe(0)
        expect(m.emissiveFactor ?? [0, 0, 0], `${file} material ${m.name} emissive`).toEqual([0, 0, 0])
        // A self-lit facade would glow in broad daylight — the exact defect the day/night
        // evidence exists to rule out.
        expect(m.emissiveTexture, `${file} material ${m.name} emissive texture`).toBeUndefined()
        expect(m.extensions?.KHR_materials_specular, `${file} material ${m.name} specular boost`).toBeUndefined()
        expect(m.name, `${file} material name`).toBe('baked_atlas')
      }
      for (const img of json.images ?? []) {
        expect(img.uri, `${file} external texture URL`).toBeUndefined() // embedded only, no network fetch
      }
    }
  })

  it('a baked-atlas building retains its source colours — no recolorable slot is claimed', () => {
    // Issue #44: "Preserve baked source colours. These are single-material assets: do not
    // invent recolour slots." An explicitly EMPTY map says that; an ABSENT one would be
    // ambiguous, and the apartment's outgoing Quaternius wall/trim slots named materials that
    // do not exist in the replacement body.
    for (const { assetId, placement } of PROJECTION) {
      const entry = ASSET_MANIFEST_BY_ID.get(assetId)!
      expect(entry.materialSlots, `${assetId} declares a slot map`).toBeDefined()
      expect(Object.keys(entry.materialSlots!), `${assetId} exposes no recolorable slots`).toEqual([])
      expect(entry.variants, `${assetId} declares no palette`).toBeUndefined()
      expect(defFor(placement).paletteVariant, `${placement} tints nothing`).toBeUndefined()
    }
    // The backdrop tower's issue #21 §6 palette variant is untouched by this wave.
    expect(defFor('building_tower_01').paletteVariant).toEqual({
      wall: { color: '#a85236' }, trim: { color: '#c9922f' },
    })
  })

  it('ships exactly the expected city GLBs — the two replaced bodies are retired, not orphaned', () => {
    const files = readdirSync('public/assets/models/city').filter((f) => f.endsWith('.glb')).sort()
    expect(files).toEqual([
      'arch_apartment_01.glb', // issue #44 Wave 3
      'arch_hotel_01.glb', // issue #44 Wave 3
      'arch_house_01.glb', // issue #44 Wave 3
      'arch_office_01.glb', // issue #38 Wave 0
      'arch_repair_garage_01.glb', // issue #44 Wave 3
      'arch_residential_house_01.glb', // issue #25
      'arch_row_house_01.glb', // issue #44 Wave 3
      'arch_shop_01.glb', // issue #44 Wave 3
      // Still referenced, so still shipped: the gym and the backdrop tower.
      'quaternius_building_large_2.glb',
      'quaternius_building_small_1.glb',
    ])
    // The replaced files must be gone from BOTH the disk and the manifest — a dead GLB left in
    // public/ ships into dist/, and a dead manifest row is a second body waiting to come back.
    for (const dead of ['quaternius_building_medium_2.glb', 'blocklife_apartment_hq_01.glb']) {
      expect(files, `${dead} retired from public/`).not.toContain(dead)
      expect(
        ASSET_MANIFEST.some((e) => e.glbPath?.endsWith(dead)),
        `${dead} still referenced by the manifest`,
      ).toBe(false)
    }
  })

  it('leaves every non-building asset row exactly as Wave 2 shipped it', () => {
    // Issue #44 touches buildings only. Characters, vehicles and props must not gain, lose or
    // repoint a row — the cheapest possible guard against collateral damage.
    const rows = ASSET_MANIFEST
      .filter((e) => e.category !== 'city')
      .map((e) => `${e.category}/${e.id}:${e.glbPath}:${e.enabled}`)
      .sort()
    expect(rows).toEqual([
      'characters/blocklife_female_01:assets/models/characters/blocklife_female_01.glb:true',
      'characters/blocklife_kabir_01:assets/models/characters/blocklife_kabir_01.glb:true',
      'characters/blocklife_male_01:assets/models/characters/blocklife_male_01.glb:true',
      'characters/blocklife_person:assets/models/characters/blocklife_person.glb:true',
      'characters/blocklife_ravi_01:assets/models/characters/blocklife_ravi_01.glb:true',
      'props/prop_ac_unit_01:assets/models/props/quaternius_prop_acunit.glb:true',
      'props/prop_bollard_01:assets/models/props/quaternius_prop_bollard.glb:true',
      'props/prop_drain_01:assets/models/props/quaternius_prop_drain.glb:true',
      'props/prop_fire_hydrant_01:assets/models/props/prop_fire_hydrant_01.glb:true',
      'props/prop_job_kiosk_01:assets/models/props/prop_job_kiosk_01.glb:true',
      'props/prop_manhole_01:assets/models/props/quaternius_prop_manholecover.glb:true',
      'props/prop_park_bench_01:assets/models/props/prop_park_bench_01.glb:true',
      'props/prop_street_planter_01:assets/models/props/quaternius_prop_plantersingle.glb:true',
      'props/prop_streetlight_01:assets/models/props/prop_streetlight_01.glb:true',
      'props/prop_trash_bin_01:assets/models/props/prop_trash_bin_01.glb:true',
      'vehicles/vehicle_compact_car_01:assets/models/vehicles/compact_sedan_01.glb:true',
      'vehicles/vehicle_scooter_01:assets/models/vehicles/scooter_01.glb:true',
      'vehicles/vehicle_sports_car_01:assets/models/vehicles/sports_car_01.glb:true',
      'vehicles/vehicle_utility_van_01:assets/models/vehicles/utility_van_01.glb:true',
    ])
  })

  it('committed bytes match the recorded provenance hashes', () => {
    for (const asset of provenance.assets) {
      const actual = createHash('sha256').update(readFileSync(asset.output)).digest('hex')
      expect(actual, `${asset.output} output hash`).toBe(asset.outputSha256)
    }
  })

  it('provenance records the exact approved pristine source of every shipped body', () => {
    expect(provenance.assets, 'six Wave 3 assets').toHaveLength(6)
    expect(provenance.assets.map((a) => a.output)).toEqual(BODIES)
    for (const file of BODIES) {
      const record = recordFor(file)
      const declared = WAVE3_SOURCES.find((v) => v.out === file)
      expect(declared, `${file} is declared in wave3.config.mjs`).toBeTruthy()
      expect(record.sources, `${file} source count`).toHaveLength(1)
      expect(record.sources[0].path, `${file} source path`).toBe(declared!.src)
      // The hash the pipeline asserted before reading == the owner-approved hash in issue #44.
      expect(record.sources[0].sha256, `${file} approved source hash`).toBe(declared!.expect.sha256)
      expect(record.sources[0].bytes, `${file} approved source bytes`).toBe(declared!.expect.bytes)
      expect(record.sources[0].structure.triangles, `${file} approved source triangles`)
        .toBe(declared!.expect.triangles)
      expect(record.attribution, `${file} attribution`).toBeTruthy()
      expect(record.license, `${file} license`).toBeTruthy()
      // The config's declared placements and the runtime wiring must agree, in both directions.
      expect(declared!.placements.slice().sort(), `${file} declared placements`)
        .toEqual(PROJECTION.filter((p) => p.file === file).map((p) => p.placement).sort())
    }
  })
})
