// @vitest-environment node
// (the GLB binary chunks are read directly; jsdom mis-handles that.)
import { createHash } from 'node:crypto'
import { readdirSync, readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { ASSET_MANIFEST_BY_ID } from './assetManifest'
import { VEHICLE_DEFS, getVehicleDef } from '../vehicles/vehicleRegistry'
import { shellMeshScale } from '../vehicles/vehicleProjection'
import { FOOTPRINT_FILL, VEHICLES as WAVE1_SOURCES } from '../../../scripts/asset-intake/wave1.config.mjs'
import provenance from '../../../docs/asset-provenance/wave1-provenance.json'

/**
 * Issue #40 Integration Wave 1 — vehicle asset contract, asserted against the REAL committed
 * bytes. Nothing here trusts the sprint report, the issue table or the provenance file's own
 * claims: every structural fact is re-parsed from the GLB that actually ships, and every
 * projection number is recomputed from vehicleRegistry rather than copied from the manifest.
 */

/** runtime asset id → vehicle class id → shipped file. */
const WAVE1 = [
  { assetId: 'vehicle_scooter_01', defId: 'veh_scooter', file: 'public/assets/models/vehicles/scooter_01.glb' },
  { assetId: 'vehicle_utility_van_01', defId: 'veh_van', file: 'public/assets/models/vehicles/utility_van_01.glb' },
  { assetId: 'vehicle_sports_car_01', defId: 'veh_sports', file: 'public/assets/models/vehicles/sports_car_01.glb' },
] as const

const MAX_TEXTURE = 1024
const VEHICLE_TRI_BUDGET = 40000

/** Minimal GLB JSON-chunk reader — same approach as scripts/assetReport.mjs. */
function readGlb(path: string) {
  const buf = readFileSync(path)
  const length = buf.readUInt32LE(8)
  let offset = 12
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
const recordFor = (file: string) => provenance.assets.find((a: any) => a.output === file)!

describe('issue #40 Wave 1 — production vehicle GLB contract (real bytes)', () => {
  it('every Wave 1 manifest entry is enabled, has a fallback, attribution and license', () => {
    for (const { assetId, file } of WAVE1) {
      const entry = ASSET_MANIFEST_BY_ID.get(assetId)
      expect(entry, `manifest entry ${assetId}`).toBeTruthy()
      expect(entry!.enabled, `${assetId} enabled`).toBe(true)
      expect(`public/${entry!.glbPath}`, `${assetId} glbPath`).toBe(file)
      // The GLB is a projection, never a dependency: the primitive fallback stays declared.
      expect(entry!.fallbackKey, `${assetId} fallbackKey`).toBe('CarMesh')
      expect(entry!.attribution, `${assetId} attribution`).toBeTruthy()
      expect(entry!.license, `${assetId} license`).toBeTruthy()
      // Issue #40: a one-material baked atlas must NOT claim a per-panel paint slot.
      expect(entry!.materialSlots, `${assetId} declares a slot map`).toBeDefined()
      expect(Object.keys(entry!.materialSlots!), `${assetId} exposes no recolorable slots`).toEqual([])
    }
  })

  it('each dealership class still resolves its own intended asset id', () => {
    // Gameplay identity is unchanged by this wave — the ids are the contract, and the
    // four classes must stay four DISTINCT assets (no class silently sharing a body).
    for (const { assetId, defId } of WAVE1) {
      expect(getVehicleDef(defId as never)?.assetId, `${defId} assetId`).toBe(assetId)
    }
    const assetIds = VEHICLE_DEFS.map((d) => d.assetId)
    expect(new Set(assetIds).size, 'every vehicle class has a distinct asset id').toBe(VEHICLE_DEFS.length)
  })

  it('ships exactly the approved vehicle bodies — no dead duplicate GLBs', () => {
    const files = readdirSync('public/assets/models/vehicles').filter((f) => f.endsWith('.glb')).sort()
    expect(files).toEqual([
      'compact_sedan_01.glb', // issue #38 Wave 0
      // Issue #47 Wave 4 — PARKED scenery bodies. They live in the vehicles directory because
      // that is what they are, but they back authored `parked_car` / `parked_truck` PROP
      // placements through LandmarkAsset: no VehicleDef, no collider, no seats, no ownership.
      'parked_box_truck_01.glb',
      'parked_delivery_van_01.glb',
      'parked_hatchback_01.glb',
      'parked_pickup_01.glb',
      'scooter_01.glb',
      'sports_car_01.glb',
      'utility_van_01.glb',
    ])
  })

  it('the ownable classes still map one-to-one onto exactly the four Wave 0/1 bodies', () => {
    // The Wave-4 parked bodies must never become a drivable class by accident: this is the
    // regression guard for "no new physics class, seat, tuning or ownership entry" (issue #47).
    const classBodies = VEHICLE_DEFS.map((d) => d.assetId).filter(Boolean).sort()
    expect(classBodies).toEqual([
      'vehicle_compact_car_01',
      'vehicle_scooter_01',
      'vehicle_sports_car_01',
      'vehicle_utility_van_01',
    ])
  })

  // ---- the projection: recomputed from vehicleRegistry, never copied from the manifest ----
  it('each body projects INSIDE its own class footprint, with length and width unswapped', () => {
    for (const { assetId, defId, file } of WAVE1) {
      const entry = ASSET_MANIFEST_BY_ID.get(assetId)!
      const def = getVehicleDef(defId as never)!
      // Measured from the committed bytes by the intake pipeline (pinned byte-identical by
      // buildWave1 --check), so this cannot drift from what three.js will actually load.
      const local = recordFor(file).structure.bounds.size as [number, number, number]

      // The entry yaws +90° about Y, so local X -> world LENGTH (+z, the shell's nose axis)
      // and local Z -> world WIDTH. Getting that mapping backwards is exactly the defect
      // issue #38's Codex review caught on the sedan (finding 4).
      expect(entry.rotation?.[1], `${assetId} yaw`).toBeCloseTo(Math.PI / 2, 6)
      expect(entry.rotation?.[0], `${assetId} pitch`).toBe(0)
      expect(entry.rotation?.[2], `${assetId} roll`).toBe(0)

      // The SECOND factor: the one shell scales its whole mesh group per class, in WORLD axes.
      // Read from the real runtime helper, so a change there fails here instead of silently
      // resizing every GLB body. [x, y, z] = [width, height, length].
      const [mx, my, mz] = shellMeshScale(def.collider)
      const [sx, sy, sz] = entry.scale!
      const world = {
        length: local[0] * sx * mz,
        height: local[1] * sy * my,
        width: local[2] * sz * mx,
      }

      // Re-derive k independently: whichever of length/width binds first at FILL.
      const byLength = (2 * def.halfLength * FOOTPRINT_FILL) / local[0]
      const byWidth = (2 * def.halfWidth * FOOTPRINT_FILL) / local[2]
      const k = Math.min(byLength, byWidth)
      // Each axis carries the 4-dp value at or just under its exact bound — never above it.
      for (const [axis, value, mesh] of [['x', sx, mz], ['y', sy, my], ['z', sz, mx]] as const) {
        const exact = k / mesh
        expect(value, `${assetId} scale.${axis} <= derived bound`).toBeLessThanOrEqual(exact)
        expect(value, `${assetId} scale.${axis} is the 4-dp derivation, not an unrelated constant`)
          .toBeGreaterThan(exact - 1e-4)
      }

      // The RENDERED body must be undistorted: its world proportions equal the approved
      // model's own. This is what cancelling the non-uniform shell mesh scale buys, and it is
      // the assertion that fails if someone "simplifies" the manifest back to a uniform scale.
      expect(world.length / world.height, `${assetId} length:height matches the source`)
        .toBeCloseTo(local[0] / local[1], 3)
      expect(world.length / world.width, `${assetId} length:width matches the source`)
        .toBeCloseTo(local[0] / local[2], 3)

      // The shell must not overhang the gameplay footprint it is projected onto...
      expect(world.length / 2, `${assetId} half-length vs footprint`).toBeLessThanOrEqual(def.halfLength)
      expect(world.width / 2, `${assetId} half-width vs footprint`).toBeLessThanOrEqual(def.halfWidth)
      // ...nor rattle around inside it: one axis fills the footprint at FILL.
      const fillL = world.length / (2 * def.halfLength)
      const fillW = world.width / (2 * def.halfWidth)
      expect(Math.max(fillL, fillW), `${assetId} fills its footprint`).toBeCloseTo(FOOTPRINT_FILL, 3)

      // ...and the declared bounds must be the REAL active projection, so tooling and labels
      // that read `bounds` cannot disagree with what renders on the shell.
      expect(entry.bounds!.depth, `${assetId} bounds.depth is world length`).toBeCloseTo(world.length, 3)
      expect(entry.bounds!.width, `${assetId} bounds.width is world width`).toBeCloseTo(world.width, 3)
      expect(entry.bounds!.height, `${assetId} bounds.height`).toBeCloseTo(world.height, 3)
    }
  })

  // The Compact IS the legacy baseline, so its shell mesh scale must stay exactly identity —
  // otherwise every pre-existing driving baseline moves and the Wave 0 sedan derivation (which
  // assumed identity) silently becomes wrong.
  it('the compact shell mesh scale is exactly identity, keeping the legacy baseline', () => {
    expect(shellMeshScale(getVehicleDef('veh_compact' as never)!.collider)).toEqual([1, 1, 1])
  })

    it('the four classes are visibly distinct sizes, not four copies of the compact', () => {
    // The pre-Wave-1 constants were the compact's, so a "scooter" projected 3.89 m long —
    // longer than its own 2.2 m footprint. Assert the fleet really differentiates.
    const dims = (id: string) => ASSET_MANIFEST_BY_ID.get(id)!.bounds!
    const scooter = dims('vehicle_scooter_01')
    const compact = dims('vehicle_compact_car_01')
    const van = dims('vehicle_utility_van_01')
    const sports = dims('vehicle_sports_car_01')
    expect(scooter.depth, 'scooter is the shortest').toBeLessThan(compact.depth)
    expect(scooter.width, 'scooter is the narrowest').toBeLessThan(compact.width)
    expect(van.depth, 'van is the longest').toBeGreaterThan(compact.depth)
    expect(van.height, 'van is the tallest').toBeGreaterThan(compact.height)
    expect(sports.depth, 'sports is longer than the compact').toBeGreaterThan(compact.depth)
    expect(sports.height, 'sports is the lowest').toBeLessThan(compact.height)
  })

  it('each body keeps the approved geometry — one mesh, bottom origin, inside the tri budget', () => {
    for (const { assetId, file } of WAVE1) {
      const { json } = readGlb(file)
      const record = recordFor(file)
      expect(json.meshes, `${assetId} mesh count`).toHaveLength(1)
      expect(json.materials, `${assetId} material count`).toHaveLength(1)
      // Triangles are unchanged from the approved source — intake reduces textures, not geometry.
      expect(triangles(file), `${assetId} triangles`).toBe(record.sources[0].structure.triangles)
      expect(triangles(file), `${assetId} triangle budget`).toBeLessThanOrEqual(VEHICLE_TRI_BUDGET)
      // Bottom-origin: the body sits ON the ground, so no vertical offset is needed and the
      // wheels cannot float or sink when the shell is placed.
      expect(record.structure.bounds.min[1], `${assetId} origin at ground`).toBe(0)
      expect(ASSET_MANIFEST_BY_ID.get(assetId)!.positionOffset, `${assetId} offset`).toEqual([0, 0, 0])
    }
  })

  it('every Wave 1 texture is at most 1024 and is a format the asset gate can measure', () => {
    for (const { file } of WAVE1) {
      const dims = textureDims(file)
      expect(dims.length, `${file} texture count`).toBeGreaterThan(0)
      for (const d of dims) {
        // A null here means the gate cannot measure the format (e.g. WebP) and would pass
        // vacuously — that is a failure, not a pass.
        expect(d, `${file} texture dimensions must be measurable (PNG/JPEG)`).not.toBeNull()
        expect(Math.max(d!.w, d!.h), `${file} texture edge`).toBeLessThanOrEqual(MAX_TEXTURE)
      }
    }
  })

  it('Wave 1 materials are non-emissive, non-metallic and free of stray scene objects', () => {
    for (const { file } of WAVE1) {
      const { json } = readGlb(file)
      expect(json.cameras ?? [], `${file} cameras`).toHaveLength(0)
      expect(json.extensions?.KHR_lights_punctual?.lights ?? [], `${file} lights`).toHaveLength(0)
      expect((json.extensionsUsed ?? []).filter((e: string) => /draco|meshopt|ktx2|unlit/i.test(e)), `${file} loader deps`).toHaveLength(0)
      for (const m of json.materials ?? []) {
        const pbr = m.pbrMetallicRoughness ?? {}
        expect(pbr.metallicFactor ?? 1, `${file} material ${m.name} metallic`).toBe(0)
        expect(m.emissiveFactor ?? [0, 0, 0], `${file} material ${m.name} emissive`).toEqual([0, 0, 0])
        expect(m.emissiveTexture, `${file} material ${m.name} emissive texture`).toBeUndefined()
        expect(m.extensions?.KHR_materials_specular, `${file} material ${m.name} specular boost`).toBeUndefined()
        // The material must NOT be named anything the §3 variant system would bind as a body
        // slot — that is what made the selected paint tint the whole atlas, windows included.
        expect(m.name, `${file} material name`).toBe('baked_atlas')
      }
      for (const img of json.images ?? []) {
        expect(img.uri, `${file} external texture URL`).toBeUndefined() // embedded only, no network fetch
      }
    }
  })

  it('committed bytes match the recorded provenance hashes', () => {
    for (const asset of provenance.assets) {
      const actual = createHash('sha256').update(readFileSync(asset.output)).digest('hex')
      expect(actual, `${asset.output} output hash`).toBe(asset.outputSha256)
    }
  })

  it('provenance records the exact approved pristine source of every shipped body', () => {
    expect(provenance.assets, 'three Wave 1 assets').toHaveLength(3)
    for (const { file } of WAVE1) {
      const record = recordFor(file)
      const declared = WAVE1_SOURCES.find((v) => v.out === file)
      expect(declared, `${file} is declared in wave1.config.mjs`).toBeTruthy()
      expect(record.sources, `${file} source count`).toHaveLength(1)
      expect(record.sources[0].path, `${file} source path`).toBe(declared!.src)
      // The hash the pipeline asserted before reading == the owner-approved hash in the issue.
      expect(record.sources[0].sha256, `${file} approved source hash`).toBe(declared!.expect.sha256)
      expect(record.attribution, `${file} attribution`).toBeTruthy()
      expect(record.license, `${file} license`).toBeTruthy()
    }
  })

  // ---- Codex review, finding 2: retain the source paint on a one-material baked body ----
  it('a baked-atlas body retains its source paint — no slot, and no default slot can rebind it', () => {
    // DEFAULT_VEHICLE_SLOTS in VehicleAsset matches material names EXACTLY. If a Wave 1 body's
    // material were called `paint` / `body` / `carpaint` (etc.) it would be picked up as a
    // recolorable body slot even with an empty manifest declaration, and the selected paint would
    // tint windows, lights and tyres along with the panels. Assert both halves of that guard.
    const REBINDABLE = ['paint', 'Paint', 'body', 'Body', 'carpaint', 'CarPaint',
      'wheel', 'Wheel', 'tire', 'Tire', 'rim', 'Rim']
    for (const { assetId, file } of WAVE1) {
      const entry = ASSET_MANIFEST_BY_ID.get(assetId)!
      expect(Object.keys(entry.materialSlots ?? { paint: [] }), `${assetId} declares no slots`).toEqual([])
      const { json } = readGlb(file)
      expect(json.materials, `${assetId} is a single-material body`).toHaveLength(1)
      expect(REBINDABLE, `${assetId} material name cannot rebind a default slot`)
        .not.toContain(json.materials[0].name)
    }
  })

  it('the Wave 0 sedan keeps the paint slot it shipped with — this wave changes only Wave 1', () => {
    // Guards the blast radius: the owner-approved Wave 0 asset is untouched by this correction.
    const sedan = ASSET_MANIFEST_BY_ID.get('vehicle_compact_car_01')!
    expect(sedan.materialSlots?.paint).toEqual(['paint'])
    expect(sedan.glbPath).toBe('assets/models/vehicles/compact_sedan_01.glb')
  })

  // ---- Codex visual review: the driver must be VISIBLY seated on every class ----
  it('every Wave 1 body declares occupant seats that sit on the vehicle, not inside it', () => {
    for (const { assetId, defId } of WAVE1) {
      const entry = ASSET_MANIFEST_BY_ID.get(assetId)!
      const def = getVehicleDef(defId as never)!
      const seats = entry.occupants
      expect(seats, `${assetId} declares occupant seats`).toBeDefined()

      // The seats are WORLD metres from the vehicle's ground origin, so they are checked against
      // the body's real projected bounds — the numbers the projection test already pins.
      const b = entry.bounds!
      const radius = seats!.radius ?? 0.24
      const places: [string, [number, number, number]][] = [['driver', seats!.driver]]
      if (seats!.passenger) places.push(['passenger', seats!.passenger])

      // Bounded sanity, scaled to EACH body. Whether the rider is actually visible is a pixel
      // question the inspected `wave1-*-occupied` captures answer; what is checkable here is that
      // the seat is on this vehicle and in its cabin band rather than inherited from the sedan.
      expect(radius, `${assetId} indicator radius is bounded`).toBeGreaterThan(0.1)
      expect(radius, `${assetId} indicator radius is bounded`).toBeLessThanOrEqual(0.3)
      for (const [who, [x, y, z]] of places) {
        // Laterally and longitudinally ON the vehicle, never hanging off the side or the tail.
        expect(Math.abs(x), `${assetId} ${who} within the body width`).toBeLessThanOrEqual(b.width / 2)
        expect(Math.abs(z), `${assetId} ${who} within the body length`).toBeLessThanOrEqual(b.depth / 2)
        // In the cabin band of ITS OWN body. The sedan's fixed 1.25 m seat is 79% of the
        // scooter's height but only 40% of the van's and 108% of the coupe's — which is exactly
        // how one constant buried one rider and floated another above the roof.
        expect(y, `${assetId} ${who} rides in the upper part of the body`).toBeGreaterThan(b.height * 0.45)
        // The indicator is a head that reads ABOVE the cabin — CarMesh's own sits at 1.10x its
        // body height — so a little proud of the roofline is correct; far above it is not.
        expect(y + radius, `${assetId} ${who} does not float above the roof`).toBeLessThanOrEqual(b.height * 1.2)
        expect(y - radius, `${assetId} ${who} is not down in the floor pan`).toBeGreaterThan(b.height * 0.25)
      }

      // Presentation only: declaring seats must never restate or contradict the gameplay
      // seat COUNT, which stays the vehicle registry's business.
      const declared = 1 + (seats!.passenger ? 1 : 0)
      expect(declared, `${assetId} declares no more seats than ${defId} has`).toBeLessThanOrEqual(def.seats)
    }
  })

  it('the scooter stays one-seat, the van two-seat, the sports two-seat (gameplay unchanged)', () => {
    expect(getVehicleDef('veh_scooter' as never)!.seats).toBe(1)
    expect(getVehicleDef('veh_van' as never)!.seats).toBe(2)
    expect(getVehicleDef('veh_sports' as never)!.seats).toBe(2)
    // A one-seat class must not declare a passenger indicator.
    expect(ASSET_MANIFEST_BY_ID.get('vehicle_scooter_01')!.occupants!.passenger).toBeUndefined()
  })

  it('the Wave 0 sedan declares no seats and therefore keeps the CarMesh occupant position', () => {
    expect(ASSET_MANIFEST_BY_ID.get('vehicle_compact_car_01')!.occupants).toBeUndefined()
  })
})
