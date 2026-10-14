// @vitest-environment node
// (the raw GLB chunks are read directly; jsdom mis-handles binary buffers.)
import { createHash } from 'node:crypto'
import { existsSync, readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { ASSET_MANIFEST_BY_ID } from './assetManifest'
import { PROP_PLACEMENT } from '../world/propPlacement'
import { VEHICLE_DEFS } from '../vehicles/vehicleRegistry'
import { MAX_WORLD_RENDER_HEIGHT } from '../camera/cameraGeometry'
import { POLICE_CRUISER_ASSET_ID, SIREN_BAR_FITS } from '../police/policeCruiserBody'
import { POLICE_CAPS } from '../police/policeTypes'
import {
  BOUNDS_EPSILON, CRUISER_ENVELOPE, MAX_TEXTURE, SCALE_DECIMALS, VEHICLES as WAVE5_VEHICLES,
} from '../../../scripts/asset-intake/wave5.config.mjs'
import provenance from '../../../docs/asset-provenance/wave5-provenance.json'

/**
 * Integration Wave 5 — the approved police car on the LIVE police cruiser pool, asserted against
 * the REAL committed bytes. Nothing here trusts the sprint ledger or the provenance file's own
 * claims: every structural fact is re-parsed from the GLB that ships, and the fit is recomputed
 * from the AUTHORED envelope rather than copied out of the manifest.
 *
 * The wave's safety properties:
 *   1. one body, fitted INSIDE the envelope of the procedural CarMesh it replaces;
 *   2. nose on +Z, the direction every cruiser drives, so no unit ever drives tail-first;
 *   3. the flashing siren lamps sit on whichever body renders — never floating over the model;
 *   4. purely visual: no vehicle class, and the police pool size is unchanged.
 */

const FILE = 'public/assets/models/vehicles/police_cruiser_01.glb'
/** Issue #21 §11 per-category triangle budget, the same table assetReport.mjs enforces. */
const TRI_BUDGET_VEHICLES = 40000

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
  return { json, bin: bin! }
}

function jpegOrPngDims(bytes: Buffer) {
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

/** Every vertex of the (single) mesh, in model space — read straight from the POSITION accessor. */
function modelVertices(path: string): [number, number, number][] {
  const { json, bin } = readGlb(path)
  const prim = json.meshes[0].primitives[0]
  const acc = json.accessors[prim.attributes.POSITION]
  const view = json.bufferViews[acc.bufferView]
  const base = (view.byteOffset ?? 0) + (acc.byteOffset ?? 0)
  const stride = view.byteStride ?? 12
  const out: [number, number, number][] = []
  for (let i = 0; i < acc.count; i++) {
    const o = base + i * stride
    out.push([bin.readFloatLE(o), bin.readFloatLE(o + 4), bin.readFloatLE(o + 8)])
  }
  return out
}

const entry = () => ASSET_MANIFEST_BY_ID.get(POLICE_CRUISER_ASSET_ID)!
const sha256 = (path: string) => createHash('sha256').update(readFileSync(path)).digest('hex')

/** Model → cruiser-group space: uniform scale, then the manifest's +π/2 yaw (x' = z, z' = −x). */
function toGroup([x, y, z]: [number, number, number], s: number): [number, number, number] {
  return [z * s, y * s, -x * s]
}

describe('Integration Wave 5 — shipped bytes, provenance and scope', () => {
  it('ships exactly one body, byte-identical to what the recorded intake produced', () => {
    expect(provenance.assets.length, 'assets recorded by the Wave 5 intake').toBe(1)
    expect(WAVE5_VEHICLES.length, 'bodies named by the intake config').toBe(1)
    const [a] = provenance.assets
    expect(a.id).toBe(POLICE_CRUISER_ASSET_ID)
    expect(a.output).toBe(FILE)
    expect(existsSync(FILE), `${FILE} exists`).toBe(true)
    expect(sha256(FILE), `${FILE} sha256`).toBe(a.outputSha256)
    expect(readFileSync(FILE).byteLength, `${FILE} byte count`).toBe(a.outputBytes)
  })

  it('was built from the approved sprint police car, named by its hash', () => {
    const [a] = provenance.assets
    const [src] = a.sources
    const [def] = WAVE5_VEHICLES
    expect(src.path).toContain('BlockLife-intake/asset-sprint-2026-08-31/vehicles-worker/final/blocklife_vehicle_police_car.glb')
    expect(src.sha256).toBe(def.expect.sha256)
    expect(src.bytes).toBe(def.expect.bytes)
    expect(src.structure.triangles).toBe(def.expect.triangles)
    expect(src.structure.cameras).toBe(0)
    expect(src.structure.lights).toBe(0)
  })

  it('is enabled, credited, keeps CarMesh as its fallback, and claims no recolorable slot', () => {
    const e = entry()
    expect(e.enabled).toBe(true)
    expect(e.category).toBe('vehicles')
    expect(`public/${e.glbPath}`).toBe(FILE)
    expect(e.fallbackKey).toBe('CarMesh')
    expect(e.attribution).toBeTruthy()
    expect(e.license).toBeTruthy()
    // One baked atlas: livery, glass, lights and tyres share a texture, so no paint slot exists.
    expect(Object.keys(e.materialSlots ?? { missing: true })).toEqual([])
    expect(e.variants).toBeUndefined()
  })

  it('is within the vehicle triangle and texture budgets, measured from the bytes', () => {
    const { json, bin } = readGlb(FILE)
    let tris = 0
    for (const mesh of json.meshes) {
      for (const prim of mesh.primitives) {
        tris += (prim.indices != null ? json.accessors[prim.indices].count : json.accessors[prim.attributes.POSITION].count) / 3
      }
    }
    expect(Math.round(tris)).toBe(WAVE5_VEHICLES[0].expect.triangles) // geometry untouched by intake
    expect(tris).toBeLessThanOrEqual(TRI_BUDGET_VEHICLES)
    expect(tris).toBeLessThanOrEqual(entry().budget!.maxTriangles!)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    for (const img of json.images as any[]) {
      const v = json.bufferViews[img.bufferView]
      const dims = jpegOrPngDims(bin.subarray(v.byteOffset ?? 0, (v.byteOffset ?? 0) + v.byteLength))
      expect(dims, 'texture header readable').toBeTruthy()
      expect(Math.max(dims!.w, dims!.h)).toBeLessThanOrEqual(MAX_TEXTURE)
      expect(img.uri, 'texture is embedded').toBeUndefined()
    }
  })

  it('is not self-lit and carries no camera, light or loader extension', () => {
    const { json } = readGlb(FILE)
    expect(json.cameras ?? []).toEqual([])
    for (const ext of json.extensionsUsed ?? []) expect(ext).not.toMatch(/lights_punctual|unlit|draco|meshopt|basisu/i)
    for (const m of json.materials) {
      expect(m.emissiveFactor ?? [0, 0, 0]).toEqual([0, 0, 0])
      expect(m.emissiveTexture).toBeUndefined()
      expect(m.pbrMetallicRoughness?.metallicFactor ?? 1).toBe(0)
    }
  })
})

describe('Integration Wave 5 — the body fits the cruiser it replaces', () => {
  it('uses the SAME authored envelope as the procedural CarMesh (the parked_car table)', () => {
    // The cruiser pool draws exactly the CarMesh the parked_car prop draws, so the authored visual
    // envelope is that table's — the config literal must BE it, not a copy that drifted.
    expect(CRUISER_ENVELOPE.halfX).toBe(PROP_PLACEMENT.parked_car.visualHalf[0])
    expect(CRUISER_ENVELOPE.halfZ).toBe(PROP_PLACEMENT.parked_car.visualHalf[1])
    expect(CRUISER_ENVELOPE.maxY).toBe(PROP_PLACEMENT.parked_car.vertical[1])
  })

  it('derives its uniform scale from the envelope and the measured bytes', () => {
    const size = provenance.assets[0].structure.bounds.size as [number, number, number]
    const k = Math.min(
      (2 * CRUISER_ENVELOPE.halfZ) / (size[0] + BOUNDS_EPSILON),
      (2 * CRUISER_ENVELOPE.halfX) / (size[2] + BOUNDS_EPSILON),
      CRUISER_ENVELOPE.maxY / (size[1] + BOUNDS_EPSILON),
    )
    const scale = Math.floor(k * 10 ** SCALE_DECIMALS) / 10 ** SCALE_DECIMALS
    const e = entry()
    expect(e.scale).toEqual([scale, scale, scale])
    expect(e.positionOffset).toEqual([0, 0, 0])
    const world = { length: size[0] * scale, height: size[1] * scale, width: size[2] * scale }
    expect(world.length).toBeLessThanOrEqual(2 * CRUISER_ENVELOPE.halfZ)
    expect(world.width).toBeLessThanOrEqual(2 * CRUISER_ENVELOPE.halfX)
    expect(world.height).toBeLessThanOrEqual(CRUISER_ENVELOPE.maxY)
    expect(world.height).toBeLessThan(MAX_WORLD_RENDER_HEIGHT)
    expect(e.bounds!.depth).toBeCloseTo(world.length, 3)
    expect(e.bounds!.width).toBeCloseTo(world.width, 3)
    expect(e.bounds!.height).toBeCloseTo(world.height, 3)
  })

  it('drives nose-first: the +π/2 yaw puts the model length on the cruiser’s +Z heading', () => {
    // The model's length is on its own X (every approved sprint vehicle); the yaw maps it onto the
    // group's Z, the axis `g.rotation.y = heading` drives along. Which END is the nose was
    // confirmed on the rendered body (push bar and headlights toward +Z) and is pinned here.
    expect(entry().rotation).toEqual([0, Math.PI / 2, 0])
    const size = provenance.assets[0].structure.bounds.size as number[]
    expect(size[0], 'length is on model X').toBeGreaterThan(size[2])
  })

  it('lights the MODELLED roof bar: the body-branch lamps cover it, measured from the vertices', () => {
    const s = entry().scale[0]
    const pts = modelVertices(FILE).map((p) => toGroup(p, s))
    const top = Math.max(...pts.map((p) => p[1]))
    expect(top).toBeCloseTo(entry().bounds!.height, 3)
    // The roof bar is the only geometry within the top 10 % of the body's height.
    const bar = pts.filter((p) => p[1] >= top * 0.9)
    expect(bar.length).toBeGreaterThan(50)
    const lo = [0, 1, 2].map((k) => Math.min(...bar.map((p) => p[k])))
    const hi = [0, 1, 2].map((k) => Math.max(...bar.map((p) => p[k])))

    const { position, lampSize, lampX } = SIREN_BAR_FITS.body
    const lampLo = [position[0] - lampX - lampSize[0] / 2, position[1] - lampSize[1] / 2, position[2] - lampSize[2] / 2]
    const lampHi = [position[0] + lampX + lampSize[0] / 2, position[1] + lampSize[1] / 2, position[2] + lampSize[2] / 2]
    for (let k = 0; k < 3; k++) {
      expect(lampLo[k], `lamps reach the bar's low edge on axis ${k}`).toBeLessThanOrEqual(lo[k])
      expect(lampHi[k], `lamps reach the bar's high edge on axis ${k}`).toBeGreaterThanOrEqual(hi[k])
    }
    // …by a small margin only: the lamps sit ON the bar, not as a second bar floating above it.
    expect(lampHi[1] - top, 'lamps rise at most 2 cm above the modelled bar').toBeLessThanOrEqual(0.02)
    expect(lampHi[1], 'lamps stay inside the cruiser envelope').toBeLessThanOrEqual(CRUISER_ENVELOPE.maxY)
  })

  it('leaves the procedural cruiser — CarMesh AND its light bar — exactly as it was', () => {
    expect(SIREN_BAR_FITS.procedural).toEqual({ position: [0, 1.45, -0.2], lampSize: [0.5, 0.18, 0.34], lampX: 0.35 })
  })
})

describe('Integration Wave 5 — purely visual', () => {
  it('adds no vehicle class, and the police pool is still sized by the L3 caps', () => {
    const classBodies = VEHICLE_DEFS.map((d) => d.assetId).filter(Boolean)
    expect(classBodies).not.toContain(POLICE_CRUISER_ASSET_ID)
    expect(VEHICLE_DEFS.length, 'ownable vehicle classes').toBe(4)
    expect(POLICE_CAPS[3]).toEqual({ vehicles: 3, officers: 6 })
  })
})
