// @vitest-environment node
// (the GLB binary chunks are read directly; jsdom mis-handles that.)
import { createHash } from 'node:crypto'
import { readdirSync, readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { ASSET_MANIFEST_BY_ID } from './assetManifest'
import { PROPS } from '../world/cityLayout'
import { PROP_SOLIDITY } from '../world/propSolidity'
import { PROP_PLACEMENT } from '../world/propPlacement'
import { STREET_PROP_ASSET_IDS } from '../world/propAssetIds'
import {
  BOUNDS_EPSILON, SCALE_DECIMALS, PROPS as WAVE2_SOURCES,
} from '../../../scripts/asset-intake/wave2.config.mjs'
import provenance from '../../../docs/asset-provenance/wave2-provenance.json'

/**
 * Issue #42 Integration Wave 2 — street-prop asset contract, asserted against the REAL committed
 * bytes. Nothing here trusts the sprint report, the issue table or the provenance file's own
 * claims: every structural fact is re-parsed from the GLB that actually ships, and every
 * projection number is recomputed from `PROP_PLACEMENT` rather than copied from the manifest.
 */

/** runtime prop type → manifest asset id → shipped file. */
const WAVE2 = [
  { type: 'street_lamp', assetId: 'prop_streetlight_01', file: 'public/assets/models/props/prop_streetlight_01.glb', fallbackKey: 'StreetLamp' },
  { type: 'hydrant', assetId: 'prop_fire_hydrant_01', file: 'public/assets/models/props/prop_fire_hydrant_01.glb', fallbackKey: 'Hydrant' },
  { type: 'trash_can', assetId: 'prop_trash_bin_01', file: 'public/assets/models/props/prop_trash_bin_01.glb', fallbackKey: 'TrashCan' },
] as const

/** Issue #42 halves the 1024 policy ceiling for these instanced street props. */
const MAX_TEXTURE = 512
/** scripts/assetReport.mjs TRI_BUDGET.props. */
const PROP_TRI_BUDGET = 10000

/**
 * The authored placements that existed at the exact base commit (27aa628), by type. Issue #42
 * requires every one of them to keep its id, so the full list is pinned rather than a count:
 * the hand-authored cityLayout ids AND the deterministic kit-compiled sector scatter ids.
 */
const PLACEMENTS: Record<string, string[]> = {
  street_lamp: [
    'prop_street_lamp_01', 'prop_street_lamp_02', 'prop_street_lamp_03', 'prop_street_lamp_04',
    'prop_street_lamp_05', 'prop_street_lamp_06', 'prop_street_lamp_07', 'prop_street_lamp_08',
    'prop_street_lamp_09', 'prop_street_lamp_r1', 'prop_street_lamp_r2', 'prop_street_lamp_r3',
    'prop_street_lamp_r4', 'prop_street_lamp_i1', 'prop_street_lamp_i2', 'prop_street_lamp_i3',
    'prop_street_lamp_w1', 'prop_street_lamp_w2', 'prop_street_lamp_w3', 'prop_street_lamp_s1',
    'prop_street_lamp_s2', 'prop_street_lamp_s3', 'prop_street_lamp_n1', 'prop_street_lamp_n2',
    'prop_street_lamp_n3', 'prop_street_lamp_g1', 'prop_street_lamp_g2', 'prop_street_lamp_g3',
    'prop_street_lamp_g4', 'prop_street_lamp_g5',
    's1_-1_walk_furniture_2', 's1_-1_walk_furniture_3', 's1_-1_walk_furniture_4', 's1_-1_walk_east_1',
    's0_-2_promenade_1', 's0_-2_promenade_5', 's0_-2_promenade_6', 's0_-2_promenade_7',
    's0_-2_promenade_9', 's0_-2_promenade_13', 's0_-2_promenade_19', 's0_-2_promenade_21',
    's1_-2_walk_furniture_0', 's1_-2_walk_furniture_1', 's1_-2_walk_furniture_4',
    's1_-2_walk_furniture_8', 's1_-2_walk_furniture_12', 's1_-2_walk_furniture_14',
    's1_-2_north_walk_0', 's1_-2_north_walk_1', 's1_-2_north_walk_3', 's1_-2_north_walk_6',
    's1_-2_north_walk_7', 's1_-2_north_walk_8', 's1_-2_north_walk_9', 's1_-2_north_walk_10',
    's2_-1_front_greens_1', 's2_-1_front_greens_2', 's2_-1_front_greens_3', 's2_-1_front_greens_5',
    's2_-1_front_greens_9',
    's-1_-2_work_lights_0', 's-1_-2_work_lights_1', 's-1_-2_work_lights_2', 's-1_-2_work_lights_3',
    's-1_-2_work_lights_4',
  ],
  hydrant: ['prop_hydrant_01', 'prop_hydrant_w1'],
  trash_can: [
    'prop_trash_can_01', 'prop_trash_can_02', 'prop_trash_can_03', 'prop_trash_can_r1',
    'prop_trash_can_i1', 'prop_trash_can_s1', 'prop_trash_can_g1', 'prop_trash_can_g2',
    's1_-1_plaza_decor_1', 's0_-2_pavilion_front_1', 's1_-2_walk_furniture_2',
    's1_-2_walk_furniture_7', 's1_-2_walk_furniture_15', 's1_-2_plaza_decor_0',
    's1_-2_plaza_decor_1', 's1_-2_plaza_decor_3', 's1_-2_plaza_decor_6',
    's2_-1_front_greens_8', 's2_-1_front_greens_11', 's2_-1_front_greens_14',
  ],
}

/** The collider half-extents these types shipped with at the base commit. */
const SOLIDITY = {
  street_lamp: [0.12, 2, 0.12],
  hydrant: [0.2, 0.35, 0.2],
  trash_can: [0.32, 0.5, 0.32],
} as const

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

/**
 * The Wave 2 projection rule, recomputed here from the authored envelope and the measured
 * bounds — never read from the manifest. See scripts/asset-intake/wave2.config.mjs.
 */
function derivedScale(type: string, size: number[], min: number[], max: number[]) {
  const spec = PROP_PLACEMENT[type as keyof typeof PROP_PLACEMENT]
  const extX = Math.max(Math.abs(min[0]), Math.abs(max[0])) + BOUNDS_EPSILON
  const extZ = Math.max(Math.abs(min[2]), Math.abs(max[2])) + BOUNDS_EPSILON
  const k = Math.min(
    spec.visualHalf[0] / extX,
    spec.visualHalf[1] / extZ,
    (spec.vertical[1] - spec.vertical[0]) / (size[1] + BOUNDS_EPSILON),
  )
  return Math.floor(k * 10 ** SCALE_DECIMALS) / 10 ** SCALE_DECIMALS
}

describe('issue #42 Wave 2 — production street-prop GLB contract (real bytes)', () => {
  it('every Wave 2 manifest entry is enabled, has its procedural fallback, attribution and license', () => {
    for (const { assetId, file, fallbackKey } of WAVE2) {
      const entry = ASSET_MANIFEST_BY_ID.get(assetId)
      expect(entry, `manifest entry ${assetId}`).toBeTruthy()
      expect(entry!.category, `${assetId} category`).toBe('props')
      expect(entry!.enabled, `${assetId} enabled`).toBe(true)
      expect(`public/${entry!.glbPath}`, `${assetId} glbPath`).toBe(file)
      // The GLB is a projection, never a dependency: the procedural component stays declared.
      expect(entry!.fallbackKey, `${assetId} fallbackKey`).toBe(fallbackKey)
      expect(entry!.attribution, `${assetId} attribution`).toBeTruthy()
      expect(entry!.license, `${assetId} license`).toBeTruthy()
      expect(entry!.budget?.maxTriangles, `${assetId} triangle budget`).toBe(PROP_TRI_BUDGET)
      expect(entry!.budget?.maxTexture, `${assetId} texture budget`).toBe(MAX_TEXTURE)
    }
  })

  it('each target prop TYPE resolves its own distinct archetype, and no archetype id is a placement id', () => {
    const placementIds = new Set(PROPS.map((p) => p.id))
    for (const { type, assetId } of WAVE2) {
      expect(STREET_PROP_ASSET_IDS[type], `${type} archetype`).toBe(assetId)
      // A reusable ARCHETYPE and an authored PLACEMENT must never share an id — `prop_street_lamp_01`
      // is a placement in cityLayout, so the archetype is deliberately named differently.
      expect(placementIds.has(assetId), `${assetId} must not collide with a placement id`).toBe(false)
    }
    const ids = Object.values(STREET_PROP_ASSET_IDS)
    expect(new Set(ids).size, 'every mapped prop type has a distinct archetype').toBe(ids.length)
  })

  // ---- the gameplay side of the contract: nothing authored moved ----
  it('every existing placement of the three types keeps its id', () => {
    for (const { type } of WAVE2) {
      const ids = PROPS.filter((p) => p.type === type).map((p) => p.id)
      expect(ids, `${type} placements`).toEqual(PLACEMENTS[type])
    }
  })

  it('the three types keep their colliders and their authored visual envelopes', () => {
    for (const { type } of WAVE2) {
      expect(PROP_SOLIDITY[type]?.half, `${type} collider`).toEqual(SOLIDITY[type])
      // PROP_PLACEMENT is what the whole-city validators read; issue #42 forbids relaxing it to
      // make a model fit, so the three envelopes are pinned to their base-commit values.
      const spec = PROP_PLACEMENT[type]
      expect(spec.support, `${type} support mode`).toBe('ground')
      expect(spec.canopy, `${type} must not gain a canopy exemption`).toBeUndefined()
      expect(spec.abutsBuilding, `${type} must not gain a wall exemption`).toBeUndefined()
    }
    expect(PROP_PLACEMENT.street_lamp.visualHalf).toEqual([0.26, 0.26])
    expect(PROP_PLACEMENT.street_lamp.vertical).toEqual([0, 4.11])
    expect(PROP_PLACEMENT.hydrant.visualHalf).toEqual([0.2, 0.2])
    expect(PROP_PLACEMENT.hydrant.vertical).toEqual([0, 0.76])
    expect(PROP_PLACEMENT.trash_can.visualHalf).toEqual([0.32, 0.32])
    expect(PROP_PLACEMENT.trash_can.vertical).toEqual([0, 0.92])
  })

  // ---- the projection: recomputed from propPlacement.ts, never copied from the manifest ----
  it('each body projects ENTIRELY inside its type’s authored visual envelope', () => {
    for (const { type, assetId, file } of WAVE2) {
      const entry = ASSET_MANIFEST_BY_ID.get(assetId)!
      const spec = PROP_PLACEMENT[type]
      // Measured from the committed bytes by the intake pipeline (pinned byte-identical by
      // buildWave2 --check), so this cannot drift from what three.js will actually load.
      const { min, max, size } = recordFor(file).structure.bounds

      // No yaw, no offset: the authored PropDef.rotationY still orients the placement, and the
      // model is grounded in its own file rather than lifted by the manifest.
      expect(entry.rotation, `${assetId} rotation`).toEqual([0, 0, 0])
      expect(entry.positionOffset, `${assetId} offset`).toEqual([0, 0, 0])

      // UNIFORM scale — the approved proportions ship undistorted.
      const [sx, sy, sz] = entry.scale
      expect(sx, `${assetId} scale is uniform`).toBe(sy)
      expect(sy, `${assetId} scale is uniform`).toBe(sz)
      expect(sx, `${assetId} scale is the derived value`).toBe(derivedScale(type, size, min, max))

      // ...and the RENDERED extents really fit inside the authored envelope.
      const halfX = Math.max(Math.abs(min[0]), Math.abs(max[0])) * sx
      const halfZ = Math.max(Math.abs(min[2]), Math.abs(max[2])) * sx
      expect(halfX, `${assetId} rendered half-X inside the envelope`).toBeLessThanOrEqual(spec.visualHalf[0])
      expect(halfZ, `${assetId} rendered half-Z inside the envelope`).toBeLessThanOrEqual(spec.visualHalf[1])
      expect(size[1] * sx, `${assetId} rendered height inside the envelope`)
        .toBeLessThanOrEqual(spec.vertical[1] - spec.vertical[0])

      // ...and it is the LARGEST such scale — one axis is at its bound, so the prop is not
      // silently shrunk to a speck by a copied constant.
      const fill = Math.max(
        halfX / spec.visualHalf[0],
        halfZ / spec.visualHalf[1],
        (size[1] * sx) / (spec.vertical[1] - spec.vertical[0]),
      )
      expect(fill, `${assetId} fills its authored envelope on the binding axis`).toBeGreaterThan(0.999)

      // The declared bounds must be the REAL projection, so tooling that reads `bounds` cannot
      // disagree with what renders.
      expect(entry.bounds!.width, `${assetId} bounds.width`).toBeCloseTo(size[0] * sx, 3)
      expect(entry.bounds!.height, `${assetId} bounds.height`).toBeCloseTo(size[1] * sx, 3)
      expect(entry.bounds!.depth, `${assetId} bounds.depth`).toBeCloseTo(size[2] * sx, 3)
    }
  })

  it('every shipped body sits ON the ground — the rendered minimum is exactly y = 0', () => {
    for (const { assetId, file } of WAVE2) {
      const record = recordFor(file)
      expect(record.structure.bounds.min[1], `${assetId} rendered minimum`).toBe(0)
      expect(ASSET_MANIFEST_BY_ID.get(assetId)!.positionOffset[1], `${assetId} needs no manifest lift`).toBe(0)
    }
  })

  it('the centred-origin hydrant was grounded by a transform, not by moving vertices', () => {
    const record = recordFor('public/assets/models/props/prop_fire_hydrant_01.glb')
    // The approved source really is centred (it skipped the remesh stage that applies
    // origin_at: bottom), so the intake must have moved it by exactly +1 on Y...
    expect(record.sources[0].structure.bounds.min[1], 'approved source minimum').toBe(-1)
    expect(record.groundOffsetY, 'grounding offset').toBe(1)
    // ...without changing its size, and while preserving the approved triangle count. Mesh
    // accessor bytes are asserted identical inside buildStatic; this is the observable half.
    expect(record.structure.bounds.size).toEqual(record.sources[0].structure.bounds.size)
    expect(record.structure.triangles).toBe(record.sources[0].structure.triangles)
    // Every other Wave 2 source was already bottom-origin and must be left alone.
    for (const { file } of WAVE2) {
      if (file.includes('hydrant')) continue
      expect(recordFor(file).groundOffsetY, `${file} untouched origin`).toBe(0)
    }
  })

  // ---- the streetlight's functional night light ----
  it('the streetlight declares a night light measured on ITS OWN lantern', () => {
    const entry = ASSET_MANIFEST_BY_ID.get('prop_streetlight_01')!
    const record = recordFor('public/assets/models/props/prop_streetlight_01.glb')
    const emitter = record.emitter!
    const s = entry.scale[0]
    const light = entry.nightLight!

    // Position and radius are the measured lantern, scaled by the projection — not guessed,
    // and not the procedural pole's [0, 3.85, 0].
    for (let i = 0; i < 3; i++) {
      expect(light.position[i], `nightLight.position[${i}]`).toBeCloseTo(emitter.center[i] * s, 4)
    }
    expect(light.bulbRadius, 'bulb radius is the lantern’s smallest half-extent')
      .toBeCloseTo(Math.min(...emitter.halfExtents) * s, 4)

    // The bulb must sit INSIDE the lantern body, not poke through its glass or float in the air.
    for (const axis of [0, 1, 2]) {
      expect(light.bulbRadius, `bulb fits the lantern on axis ${axis}`)
        .toBeLessThanOrEqual(emitter.halfExtents[axis] * s + 1e-4)
    }
    // ...and inside the projected body overall.
    const { min, max } = record.structure.bounds
    for (const axis of [0, 1, 2]) {
      expect(light.position[axis], `light within the body on axis ${axis}`).toBeGreaterThanOrEqual(min[axis] * s - 1e-4)
      expect(light.position[axis], `light within the body on axis ${axis}`).toBeLessThanOrEqual(max[axis] * s + 1e-4)
    }
    // The lantern is genuinely offset from the pole axis — the reason a guessed anchor fails.
    expect(Math.abs(light.position[2]), 'lantern hangs forward off the crook').toBeGreaterThan(0.05)
    // Only the streetlight has a light; a hydrant or bin that grew one would be a new light source.
    expect(ASSET_MANIFEST_BY_ID.get('prop_fire_hydrant_01')!.nightLight).toBeUndefined()
    expect(ASSET_MANIFEST_BY_ID.get('prop_trash_bin_01')!.nightLight).toBeUndefined()
  })

  // ---- structure, budgets and honesty of the shipped bytes ----
  it('each body keeps the approved geometry — one mesh, one material, inside the prop tri budget', () => {
    for (const { assetId, file } of WAVE2) {
      const { json } = readGlb(file)
      const record = recordFor(file)
      expect(json.meshes, `${assetId} mesh count`).toHaveLength(1)
      expect(json.materials, `${assetId} material count`).toHaveLength(1)
      // Triangles are unchanged from the approved source — intake reduces textures, not geometry.
      expect(triangles(file), `${assetId} triangles`).toBe(record.sources[0].structure.triangles)
      expect(triangles(file), `${assetId} triangle budget`).toBeLessThanOrEqual(PROP_TRI_BUDGET)
    }
  })

  it('every Wave 2 texture is at most 512 and is a format the asset gate can measure', () => {
    for (const { file } of WAVE2) {
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

  it('Wave 2 materials are non-emissive, non-metallic and free of stray scene objects', () => {
    for (const { file } of WAVE2) {
      const { json } = readGlb(file)
      expect(json.cameras ?? [], `${file} cameras`).toHaveLength(0)
      expect(json.extensions?.KHR_lights_punctual?.lights ?? [], `${file} lights`).toHaveLength(0)
      expect((json.extensionsUsed ?? []).filter((e: string) => /draco|meshopt|ktx2|unlit/i.test(e)), `${file} loader deps`).toHaveLength(0)
      for (const m of json.materials ?? []) {
        const pbr = m.pbrMetallicRoughness ?? {}
        expect(pbr.metallicFactor ?? 1, `${file} material ${m.name} metallic`).toBe(0)
        expect(m.emissiveFactor ?? [0, 0, 0], `${file} material ${m.name} emissive`).toEqual([0, 0, 0])
        // A self-lit streetlight would glow in broad daylight — the exact defect the day/night
        // evidence exists to rule out. The repo's own emissive bulb is the ONLY light on a lamp.
        expect(m.emissiveTexture, `${file} material ${m.name} emissive texture`).toBeUndefined()
        expect(m.extensions?.KHR_materials_specular, `${file} material ${m.name} specular boost`).toBeUndefined()
        expect(m.name, `${file} material name`).toBe('baked_atlas')
      }
      for (const img of json.images ?? []) {
        expect(img.uri, `${file} external texture URL`).toBeUndefined() // embedded only, no network fetch
      }
    }
  })

  it('a baked-atlas prop retains its source colours — no recolorable slot is claimed', () => {
    // Issue #42: "Expose no recolor slot for these one-material baked atlases; retain source
    // colours honestly." An explicitly EMPTY map says that; an ABSENT one would be ambiguous.
    for (const { assetId, file } of WAVE2) {
      const entry = ASSET_MANIFEST_BY_ID.get(assetId)!
      expect(entry.materialSlots, `${assetId} declares a slot map`).toBeDefined()
      expect(Object.keys(entry.materialSlots!), `${assetId} exposes no recolorable slots`).toEqual([])
      expect(entry.variants, `${assetId} declares no palette`).toBeUndefined()
      const { json } = readGlb(file)
      expect(json.materials, `${assetId} is a single-material body`).toHaveLength(1)
    }
  })

  it('ships exactly the expected prop GLBs — no dead duplicates left in public/', () => {
    const files = readdirSync('public/assets/models/props').filter((f) => f.endsWith('.glb')).sort()
    expect(files).toEqual([
      'prop_fire_hydrant_01.glb', // issue #42 Wave 2
      'prop_job_kiosk_01.glb',
      'prop_park_bench_01.glb', // issue #38 Wave 0
      'prop_streetlight_01.glb', // issue #42 Wave 2
      'prop_trash_bin_01.glb', // issue #42 Wave 2
      'quaternius_prop_acunit.glb',
      'quaternius_prop_bollard.glb',
      'quaternius_prop_drain.glb',
      'quaternius_prop_manholecover.glb',
      'quaternius_prop_plantersingle.glb',
    ])
  })

  it('committed bytes match the recorded provenance hashes', () => {
    for (const asset of provenance.assets) {
      const actual = createHash('sha256').update(readFileSync(asset.output)).digest('hex')
      expect(actual, `${asset.output} output hash`).toBe(asset.outputSha256)
    }
  })

  it('provenance records the exact approved pristine source of every shipped prop', () => {
    expect(provenance.assets, 'three Wave 2 assets').toHaveLength(3)
    for (const { file } of WAVE2) {
      const record = recordFor(file)
      const declared = WAVE2_SOURCES.find((v) => v.out === file)
      expect(declared, `${file} is declared in wave2.config.mjs`).toBeTruthy()
      expect(record.sources, `${file} source count`).toHaveLength(1)
      expect(record.sources[0].path, `${file} source path`).toBe(declared!.src)
      // The hash the pipeline asserted before reading == the owner-approved hash in issue #42.
      expect(record.sources[0].sha256, `${file} approved source hash`).toBe(declared!.expect.sha256)
      expect(record.sources[0].bytes, `${file} approved source bytes`).toBe(declared!.expect.bytes)
      expect(record.attribution, `${file} attribution`).toBeTruthy()
      expect(record.license, `${file} license`).toBeTruthy()
    }
  })
})
