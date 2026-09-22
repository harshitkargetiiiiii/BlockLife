// @vitest-environment node
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import * as THREE from 'three'
import { describe, expect, it } from 'vitest'
import { ASSET_MANIFEST_BY_ID } from './assetManifest'
import { BUILDINGS, PROPS } from '../world/cityLayout'
import { BUILDING_ROOF_EXTRA } from '../world/buildingMassing'
import { WINDOW_OVERLAYS } from '../world/windowOverlayData'
import { getBuildingOccluderDescriptor } from '../visibility/occluderData'
import { CAMERA_OFFSET, MAX_WORLD_RENDER_HEIGHT } from '../camera/cameraGeometry'
import { projectedLabelHeight, resolveBuildingVisual } from '../world/buildingProjection'
import { CITIZEN_DESTINATIONS, PEDESTRIAN_GRAPH } from '../citizens/destinations/pedestrianDestinations'
import type { BuildingDef } from '../world/worldTypes'

/**
 * Issue #53 archetype reuse — authored lots that still drew the procedural `BuildingMesh` now draw an
 * ALREADY-APPROVED, already-shipped body at its EXISTING calibration. Delivered as two batches on one
 * branch; this file pins both.
 *
 *   Batch 1 (commit `ca63b5e9`): Market Row East, Avenue Deli on the shop row; North Depot on the
 *   garage row — all three at `referenceSize == def.size`, i.e. scale [1, 1, 1].
 *
 *   Batch 2: Corner Café, Market Row and two compiled storefronts on the same shop row; two compiled
 *   yard depots on the garage row; two compiled block lots on the row-house row; two backdrop towers
 *   and Meridian Tower on the approved apartment / gateway-hotel bodies.
 *
 * Nothing is generated, re-fitted, re-textured or re-calibrated. Every body keeps its manifest row,
 * its uniform scale and `positionOffset: [0, 0, 0]`, and every one of them declares
 * `materialSlots: {}`, so no placement here adds a variant-cache key. Mapping intent and derivation,
 * NOT visual acceptance.
 *
 * TWO RULES THIS FILE EXISTS TO GATE:
 *
 * 1. FACING. Some approved bodies decorate exactly ONE elevation (`arch_shop_01`'s glazed shopfront,
 *    `arch_row_house_01`'s two front doors between blank party walls, `arch_repair_garage_01`'s
 *    shutters), and `CAMERA_OFFSET` is a FIXED isometric rig at +x / +z, so a player only ever sees a
 *    building's +x and +z faces. A single-elevation body may therefore only go on a lot whose
 *    composed facing is 'east' or 'south'. West Commons ('west') and South Deli ('north') were built,
 *    RENDERED and rejected on exactly that evidence. The bodies with no wrong front — the apartment
 *    ("windowed on all four sides") and the hotel ("entrance on EVERY elevation") — are exempt, and
 *    the exemption is per body, quoted from the manifest row that measured it.
 *
 * 2. FIT. `def.size` stays the sole authority for collider, occluder, routing and anchors, so a body
 *    that under-fills its lot leaves a gap between the wall a player sees and the wall they collide
 *    with. Every placement here is measured from the GLB bytes under its composed yaw and held inside
 *    the shipped worst case: the approved apartment's own placement, which documents 1.73 m / 1.93 m
 *    of half-extent slack as an accepted cost.
 *
 * `canonicalFacing` names the facing of the MOUNTED body, not the raw model: the garage and hotel rows
 * carry a manifest `rotation` that `LandmarkAsset` applies INSIDE the projection group, so the two
 * differ there. The assertions below check the COMPOSED yaw (projection + manifest), which is what
 * actually renders; a mutation of either term fails them.
 */

type Vec3 = [number, number, number]
type Facing = 'north' | 'south' | 'east' | 'west'

/** Every approved body this slice reuses: manifest id → its shipped file and bytes. */
const BODIES = {
  shop: { id: 'building_shop_01', file: 'assets/models/city/arch_shop_01.glb', sha256: 'fc758a288365afa4450aa78dc03cce7d7936b6456f81ea0cf19b16ca6b0eaf61' },
  garage: { id: 'building_garage_01', file: 'assets/models/city/arch_repair_garage_01.glb', sha256: 'fe870f4c3704dc911f45162854b68785a397f94c7b806848ef74ccd68f54fe6c' },
  // The SAME file at a second calibration for the yard's wider [10, 7, 9] lots -- a row, not a
  // new asset, so the sha256 below is deliberately identical to the line above.
  garageYard: { id: 'building_garage_01_yard', file: 'assets/models/city/arch_repair_garage_01.glb', sha256: 'fe870f4c3704dc911f45162854b68785a397f94c7b806848ef74ccd68f54fe6c' },
  rowHouse: { id: 'building_townhomes_01', file: 'assets/models/city/arch_row_house_01.glb', sha256: '53eb375b50eddb7e1c26ceb4b10d090aafa1f194dc9f2defb5953dec9632b4a8' },
  apartment: { id: 'building_apartment_01', file: 'assets/models/city/arch_apartment_01.glb', sha256: '32b65625a86332a22490ac54277994d46b4e997047c600d097ef276291426704' },
  hotel: { id: 'building_gate_hotel_01', file: 'assets/models/city/arch_hotel_01.glb', sha256: '8a4fcacc19c574a3f33f8517266947623dfd92c92f1f274926210f89c7ac49ec' },
} as const
const FILE_OF = new Map<string, string>(Object.values(BODIES).map((b) => [b.id, b.file]))

/**
 * Bodies whose PRIMARY frontage is one elevation — the ones the camera-facing rule binds.
 *
 * The manifest rows quoted here originally said these bodies were blank on every other side. That is
 * over-claimed: rendering each shipped file orthographically, dead-on to each cardinal (so no adjacent
 * face can leak into frame), shows the shop carrying a SECOND decorated elevation on −x — a framed
 * sign panel, a framed window and a glazed panel between pilasters — while its −z is genuinely blank,
 * and shows the row house's −z rear carrying windows and a door. The rule below is unchanged and every
 * shipped placement still satisfies it; what changed is that the reason is now a measurement instead of
 * a transcription, and a placement may only lean on a secondary elevation by being named in
 * SECONDARY_FRONTAGE and proving it geometrically.
 *
 * The apartment ("no distinguishable entrance elevation — the ground floor is windowed on all four
 * sides") and the hotel ("a canopied double-door entrance on EVERY elevation") are exempt BY
 * MEASUREMENT, not by convenience.
 */
const SINGLE_ELEVATION = new Set<string>([BODIES.shop.id, BODIES.rowHouse.id, BODIES.garage.id, BODIES.garageYard.id])

/** Model-local outward normals, so a declared elevation can be rotated rather than reasoned about. */
const ELEVATION_NORMAL: Record<'+x' | '-x' | '+z' | '-z', Vec3> = {
  '+x': [1, 0, 0], '-x': [-1, 0, 0], '+z': [0, 0, 1], '-z': [0, 0, -1],
}

/**
 * The ONLY placements allowed to show the camera a body's secondary decorated elevation instead of its
 * primary frontage. Each one names the elevation and what the camera must therefore see; the test below
 * rotates that normal by the placement's own composed yaw and refuses it unless it really does land on a
 * camera-facing world direction. A new entry is a deliberate, reviewed act — nothing falls in silently.
 */
const SECONDARY_FRONTAGE: Record<string, { elevation: '+x' | '-x' | '+z' | '-z'; why: string }> = {
  // Authored door is NORTH, so the glazed shopfront must go there (the entrance belongs at the door).
  // The composed yaw is π, which swings the body's measured second elevation onto world EAST.
  building_deli_s1: { elevation: '-x', why: 'framed sign panel, window and glazed panel; measured dead-on' },
}

/**
 * Every authored fact of the reused lots, transcribed from the sources BEFORE this slice, with the
 * projection yaw each one must resolve to. `door: undefined` is a lot that authors none (the backdrop
 * towers), which resolves to the canonical facing and therefore a zero projection yaw.
 */
const REUSED: Record<string, {
  body: string
  batch: 1 | 2 | 3 | 4
  position: [number, number]
  size: Vec3
  door?: Facing
  canonicalFacing: Facing
  projectionYaw: number
  /** Nearest OTHER placement drawing the same body, and its distance — recorded, see the repetition test. */
  nearestSameBody: [string, number]
  label?: string
}> = {
  // --- batch 1 (ca63b5e9) ---
  building_market_02: { body: BODIES.shop.id, batch: 1, position: [39, 22], size: [6, 5, 6], door: 'east', canonicalFacing: 'south', projectionYaw: Math.PI / 2, nearestSameBody: ['building_market_01', 7.0] },
  building_gate_retail_01: { body: BODIES.shop.id, batch: 1, position: [33, -104], size: [6, 5, 6], door: 'east', canonicalFacing: 'south', projectionYaw: Math.PI / 2, label: 'Avenue Deli', nearestSameBody: ['s1_-1_s1', 55.4] },
  building_depot_n1: { body: BODIES.garage.id, batch: 1, position: [38.5, -36.5], size: [8, 5.5, 7], door: 'east', canonicalFacing: 'west', projectionYaw: Math.PI, nearestSameBody: ['building_factory_n1', 9.5] },
  // --- batch 2 ---
  building_cafe_01: { body: BODIES.shop.id, batch: 2, position: [-16.5, -3], size: [6, 5, 6], door: 'east', canonicalFacing: 'south', projectionYaw: Math.PI / 2, label: 'Corner Café', nearestSameBody: ['building_shop_01', 18.5] },
  building_market_01: { body: BODIES.shop.id, batch: 2, position: [39, 15], size: [6, 4.5, 6], door: 'east', canonicalFacing: 'south', projectionYaw: Math.PI / 2, label: 'Market Row', nearestSameBody: ['building_market_02', 7.0] },
  building_tower_02: { body: BODIES.hotel.id, batch: 2, position: [72, -12], size: [9, 13, 9], canonicalFacing: 'west', projectionYaw: 0, nearestSameBody: ['building_tower_03', 96.5194] },
  building_tower_05: { body: BODIES.apartment.id, batch: 2, position: [-76, 10], size: [8, 9, 8], canonicalFacing: 'south', projectionYaw: 0, nearestSameBody: ['building_apartment_01', 66.2] },
  building_gate_tower_01: { body: BODIES.apartment.id, batch: 2, position: [34, -80], size: [8, 12, 8], door: 'east', canonicalFacing: 'south', projectionYaw: Math.PI / 2, label: 'Meridian Tower', nearestSameBody: ['building_apartment_01', 81.5] },
  's1_-1_n2': { body: BODIES.shop.id, batch: 2, position: [92.16, -110], size: [6, 5, 6], door: 'south', canonicalFacing: 'south', projectionYaw: 0, label: 'Corner Beans', nearestSameBody: ['s1_-1_s1', 24.9] },
  's1_-1_n3': { body: BODIES.rowHouse.id, batch: 2, position: [105.76, -112], size: [9, 9, 8], door: 'south', canonicalFacing: 'south', projectionYaw: 0, nearestSameBody: ['s1_-1_s2', 27.4] },
  's1_-2_n2': { body: BODIES.shop.id, batch: 2, position: [100, -314], size: [6, 5, 6], door: 'south', canonicalFacing: 'south', projectionYaw: 0, label: 'North Perk', nearestSameBody: ['s1_-2_s1', 26.0] },
  's1_-2_n3': { body: BODIES.rowHouse.id, batch: 2, position: [122, -316], size: [9, 9, 8], door: 'south', canonicalFacing: 'south', projectionYaw: 0, nearestSameBody: ['s1_-2_s2', 29.1] },
  's-1_-2_w2': { body: BODIES.garage.id, batch: 2, position: [-103.42, -243.5], size: [8, 5.5, 7], door: 'south', canonicalFacing: 'west', projectionYaw: Math.PI / 2, nearestSameBody: ['s-1_-2_w4', 42.1] },
  's-1_-2_w4': { body: BODIES.garage.id, batch: 2, position: [-145.54, -243.5], size: [8, 5.5, 7], door: 'south', canonicalFacing: 'west', projectionYaw: Math.PI / 2, nearestSameBody: ['s-1_-2_w2', 42.1] },
  // --- batch 3: placement closure (2026-09-21) ---
  // These three were in the "no approved body fits" ledger. Two of the three entries were arithmetic
  // errors in that ledger, not measurements: it compared FULL widths against a ceiling this file has
  // always measured as a HALF-extent. Re-measured from the bytes under the composed yaw, all three sit
  // inside every gate below, so they are mapped rather than left procedural.
  building_tower_03: { body: BODIES.hotel.id, batch: 3, position: [-8, -66], size: [11, 11, 9], canonicalFacing: 'west', projectionYaw: 0, nearestSameBody: ['building_gate_hotel_01', 83.5284] },
  building_tower_06: { body: BODIES.hotel.id, batch: 3, position: [-10, 70], size: [11, 12, 9], canonicalFacing: 'west', projectionYaw: 0, nearestSameBody: ['building_tower_02', 115.9655] },
  building_factory_n1: { body: BODIES.garage.id, batch: 3, position: [38.5, -27], size: [9, 8, 8], door: 'east', canonicalFacing: 'west', projectionYaw: Math.PI, label: 'Blockworks Factory', nearestSameBody: ['building_depot_n1', 9.5] },
  building_shop_02: { body: BODIES.shop.id, batch: 3, position: [3.5, -17.5], size: [7, 6, 6], door: 'south', canonicalFacing: 'south', projectionYaw: 0, label: 'Book Nook', nearestSameBody: ['building_shop_01', 8.5] },
  // The one lot in this file that reaches the camera through a SECOND elevation rather than its front.
  building_deli_s1: { body: BODIES.shop.id, batch: 3, position: [6, 55.5], size: [6, 5, 6], door: 'north', canonicalFacing: 'south', projectionYaw: Math.PI, label: 'South Deli', nearestSameBody: ['building_market_02', 47.0239] },
  // --- batch 4: the industrial yard's three WIDER lots, on a second calibration of the garage file ---
  // w2 and w4 in this same row already draw the garage body 1:1 on their [8, 5.5, 7] depot lots. w1,
  // w3 and w5 were left out because their warehouse template is [10, 7, 9] -- a size question, not a
  // facing one: they carry the SAME south door, which composes to the SAME zero net yaw, so both
  // decorated elevations face the camera exactly as w2/w4's do.
  's-1_-2_w1': { body: BODIES.garageYard.id, batch: 4, position: [-82.36, -244.5], size: [10, 7, 9], door: 'south', canonicalFacing: 'west', projectionYaw: Math.PI / 2, label: 'Yard 12', nearestSameBody: ['s-1_-2_w3', 42.12] },
  's-1_-2_w3': { body: BODIES.garageYard.id, batch: 4, position: [-124.48, -244.5], size: [10, 7, 9], door: 'south', canonicalFacing: 'west', projectionYaw: Math.PI / 2, nearestSameBody: ['s-1_-2_w1', 42.12] },
  's-1_-2_w5': { body: BODIES.garageYard.id, batch: 4, position: [-166.6, -244.5], size: [10, 7, 9], door: 'south', canonicalFacing: 'west', projectionYaw: Math.PI / 2, nearestSameBody: ['s-1_-2_w3', 42.12] },
}
const REUSED_IDS = Object.keys(REUSED)

/**
 * Placements that project an approved body but are pinned in ANOTHER contract, so this file must
 * allow for them without claiming to own them — the same allowance the sibling contracts make for
 * this file's ids via their own `ISSUE_53_REUSE` lists. Gateway Offices draws the office row at its own
 * measured 1.04 up-fit (`gatewayOfficesContract.test.ts`) and the mixed-use tower lot draws it at 1.02
 * (`mixedUseOfficeContract.test.ts`); the office body is not in BODIES above because it is a slotted
 * body with window overlays and a shared variant-cache key, and the per-body assertions here are
 * written for the baked-atlas rows.
 */
const PINNED_ELSEWHERE = ['building_gate_offices_01', 's1_-2_s3']

/** Half-extent slack the SHIPPED apartment placement already accepts, in metres — the fit ceiling. */
const MAX_HALF_EXTENT_SLACK = 1.93

/**
 * The only authored doors that point a single-elevation body at the fixed +x / +z camera. Derived, not
 * transcribed: the rig's own offset decides it.
 */
const CAMERA_FACING_DOORS: Facing[] = (['east', 'south', 'west', 'north'] as Facing[])
  .filter((facing) => {
    // The outward normal of the door elevation, and whether the camera stands on that side.
    const normal = new THREE.Vector3(...({ south: [0, 0, 1], north: [0, 0, -1], east: [1, 0, 0], west: [-1, 0, 0] }[facing] as Vec3))
    return normal.dot(new THREE.Vector3(CAMERA_OFFSET[0], 0, CAMERA_OFFSET[2])) > 0
  })

/**
 * Digests captured from the UNTOUCHED tree at `991a61f7` (the branch base), before either batch edited
 * any file: global BUILDINGS and PROPS as the sibling contracts hash them, plus the citizen
 * destinations and the pedestrian graph.
 */
const PRE_CHANGE = {
  buildings: 'c3b2a212dfbdb81b04074f79ce20f0f4e6358953deb46a2e5daf25ddeb22388c',
  props: 'd94702c5e475f075a28e2b7a3b476ac8bc0df42fc9655bfa52ccfdb45732be3b',
  citizenDestinations: '9cdd87b48e7d338a5fdf41404ce0cdf5e612f195b36453390bd60fc9c4caf736',
  pedestrianGraph: '0f7dd3de60cbccf0585465d0c39f1d33b85d64d07133519a0a29c47ae7eed06d',
  /** Projections / mapped placements / authored placements before this slice. */
  projections: 33,
  mapped: 42,
  placements: 73,
}

const FACING_YAW: Record<Facing, number> = { south: 0, north: Math.PI, east: Math.PI / 2, west: -Math.PI / 2 }

const defFor = (id: string) => BUILDINGS.find((b) => b.id === id) as BuildingDef
const hash = (text: string) => createHash('sha256').update(text).digest('hex')
const canonical = (value: unknown) => JSON.stringify(value, (_key, v) =>
  v instanceof Map ? [...v.entries()] : v instanceof Set ? [...v] : v)
/** Wrap into (-pi, pi] so composed yaws compare regardless of how they were summed. */
const wrap = (yaw: number) => Math.atan2(Math.sin(yaw), Math.cos(yaw))

/** Model-local bounds from the POSITION accessor extrema through every node transform. */
function glbBounds(glbPath: string): { min: Vec3; max: Vec3 } {
  const buf = readFileSync(`public/${glbPath}`)
  type Node = { mesh?: number; children?: number[]; matrix?: number[]; translation?: Vec3; rotation?: [number, number, number, number]; scale?: Vec3 }
  let json: { scene?: number; scenes: { nodes: number[] }[]; nodes: Node[]; meshes: { primitives: { attributes: Record<string, number> }[] }[]; accessors: { min: number[]; max: number[] }[] } | null = null
  for (let offset = 12; offset < buf.readUInt32LE(8);) {
    const length = buf.readUInt32LE(offset)
    if (buf.readUInt32LE(offset + 4) === 0x4e4f534a) json = JSON.parse(buf.subarray(offset + 8, offset + 8 + length).toString('utf8'))
    offset += 8 + length
  }
  if (!json) throw new Error(`${glbPath}: no JSON chunk`)
  const gltf = json
  const box = new THREE.Box3()
  const visit = (index: number, parent: THREE.Matrix4) => {
    const node = gltf.nodes[index]
    const local = node.matrix
      ? new THREE.Matrix4().fromArray(node.matrix)
      : new THREE.Matrix4().compose(
        new THREE.Vector3(...(node.translation ?? [0, 0, 0])),
        new THREE.Quaternion(...(node.rotation ?? [0, 0, 0, 1])),
        new THREE.Vector3(...(node.scale ?? [1, 1, 1])),
      )
    const world = parent.clone().multiply(local)
    if (node.mesh !== undefined) {
      for (const primitive of gltf.meshes[node.mesh].primitives) {
        const accessor = gltf.accessors[primitive.attributes.POSITION]
        for (let c = 0; c < 8; c++) {
          box.expandByPoint(new THREE.Vector3(
            c & 1 ? accessor.max[0] : accessor.min[0],
            c & 2 ? accessor.max[1] : accessor.min[1],
            c & 4 ? accessor.max[2] : accessor.min[2],
          ).applyMatrix4(world))
        }
      }
    }
    for (const child of node.children ?? []) visit(child, world)
  }
  for (const root of gltf.scenes[gltf.scene ?? 0].nodes) visit(root, new THREE.Matrix4())
  return { min: box.min.toArray() as Vec3, max: box.max.toArray() as Vec3 }
}

/** Footprint reach of the fitted body about the lot centre, under the COMPOSED yaw. */
function renderedReach(assetId: string, file: string, yaw: number, projectionScale: Vec3): { halfX: number; halfZ: number; height: number; baseY: number } {
  const entry = ASSET_MANIFEST_BY_ID.get(assetId)!
  const { min, max } = glbBounds(file)
  const sx = entry.scale[0] * projectionScale[0]
  const sy = entry.scale[1] * projectionScale[1]
  const sz = entry.scale[2] * projectionScale[2]
  let halfX = 0
  let halfZ = 0
  for (const x of [min[0], max[0]]) {
    for (const z of [min[2], max[2]]) {
      const lx = x * sx
      const lz = z * sz
      halfX = Math.max(halfX, Math.abs(lx * Math.cos(yaw) + lz * Math.sin(yaw)))
      halfZ = Math.max(halfZ, Math.abs(-lx * Math.sin(yaw) + lz * Math.cos(yaw)))
    }
  }
  return { halfX, halfZ, height: (max[1] - min[1]) * sy, baseY: min[1] * sy }
}

describe('issue #53 — twenty-two procedural lots on five already-approved archetype bodies', () => {
  it('every reused row is the shipped file, byte for byte, with its calibration untouched', () => {
    for (const body of Object.values(BODIES)) {
      expect(createHash('sha256').update(readFileSync(`public/${body.file}`)).digest('hex'), `${body.id} bytes`).toBe(body.sha256)
      const entry = ASSET_MANIFEST_BY_ID.get(body.id)!
      expect(entry.glbPath, `${body.id} path`).toBe(body.file)
      expect(entry.enabled, `${body.id} enabled`).toBe(true)
      expect(entry.fallbackKey, `${body.id} fallback`).toBe('BuildingMesh')
      // Uniform scale, no offset, and no recolorable slot — so a projection adds no variant-cache key
      // and cannot distort or displace the approved body.
      expect(new Set(entry.scale).size, `${body.id} uniform manifest scale`).toBe(1)
      expect(entry.positionOffset, `${body.id} offset`).toEqual([0, 0, 0])
      expect(entry.materialSlots, `${body.id} slots`).toEqual({})
      expect(entry.variants, `${body.id} variants`).toBeUndefined()
      expect(entry.rotation[0], `${body.id} pitch`).toBe(0)
      expect(entry.rotation[2], `${body.id} roll`).toBe(0)
    }
    // The exact shipped calibrations, spelled out.
    expect(ASSET_MANIFEST_BY_ID.get(BODIES.shop.id)!.scale).toEqual([1.206, 1.206, 1.206])
    expect(ASSET_MANIFEST_BY_ID.get(BODIES.garage.id)!.scale).toEqual([0.6304, 0.6304, 0.6304])
    expect(ASSET_MANIFEST_BY_ID.get(BODIES.garageYard.id)!.scale).toEqual([0.84, 0.84, 0.84])
    expect(ASSET_MANIFEST_BY_ID.get(BODIES.rowHouse.id)!.scale).toEqual([0.8835, 0.8835, 0.8835])
    expect(ASSET_MANIFEST_BY_ID.get(BODIES.apartment.id)!.scale).toEqual([0.6, 0.6, 0.6])
    expect(ASSET_MANIFEST_BY_ID.get(BODIES.hotel.id)!.scale).toEqual([0.8333, 0.8333, 0.8333])
    expect(ASSET_MANIFEST_BY_ID.get(BODIES.garage.id)!.rotation[1]).toBeCloseTo(-Math.PI / 2, 12)
    // The second row carries the SAME mounted yaw, which is why a south door composes to zero.
    expect(ASSET_MANIFEST_BY_ID.get(BODIES.garageYard.id)!.rotation[1]).toBeCloseTo(-Math.PI / 2, 12)
    expect(ASSET_MANIFEST_BY_ID.get(BODIES.hotel.id)!.rotation[1]).toBeCloseTo(-Math.PI / 2, 12)
    for (const id of [BODIES.shop.id, BODIES.rowHouse.id, BODIES.apartment.id]) {
      expect(ASSET_MANIFEST_BY_ID.get(id)!.rotation[1], `${id} yaw`).toBe(0)
    }
    // Each row's OWN placement stays legacy (id-keyed, no projection).
    for (const id of [BODIES.shop.id, BODIES.garage.id, BODIES.apartment.id, BODIES.rowHouse.id]) {
      expect(defFor(id)?.visual, `${id}'s own placement is untouched`).toBeUndefined()
    }
  })

  it('keeps every authored fact of the reused lots', () => {
    for (const id of REUSED_IDS) {
      const def = defFor(id)
      const want = REUSED[id]
      expect(def.position[0], `${id} x`).toBeCloseTo(want.position[0], 6)
      expect(def.position[1], `${id} z`).toBeCloseTo(want.position[1], 6)
      expect(def.size, `${id} size`).toEqual(want.size)
      expect(def.door, `${id} door`).toBe(want.door)
      expect(def.label, `${id} label`).toBe(want.label)
      expect(def.paletteVariant, `${id} tints nothing`).toBeUndefined()
    }
    expect(defFor('building_depot_n1').windows, 'the depot keeps its authored windowless fallback').toBe(false)
  })

  it('resolves every projection to a uniform scale, no offset, and a pure facing yaw', () => {
    for (const id of REUSED_IDS) {
      const want = REUSED[id]
      const v = resolveBuildingVisual(defFor(id))!
      expect(v.assetId, `${id} archetype`).toBe(want.body)
      expect(v.offset, `${id} offset`).toEqual([0, 0, 0])
      expect(v.paletteVariant, `${id} palette`).toBeUndefined()
      // UNIFORM: the approved body is scaled, never squashed. Thirteen of the fourteen lots ARE the
      // reference box (scale exactly 1); Market Row is a deliberate 0.9, uniform to 5e-6 because the
      // reference is written as a decimal.
      const spread = Math.max(...v.scale) - Math.min(...v.scale)
      expect(spread, `${id} scale is uniform`).toBeLessThan(1e-5)
      if (id === 'building_market_01') {
        expect(v.scale[1], 'Market Row is a deliberate 0.9 down-fit').toBeCloseTo(0.9, 9)
      } else if (id === 'building_factory_n1') {
        // A deliberate 1.14 up-fit, same technique as Book Nook's 1.15 and Market Row's 0.9: the
        // reference is the lot divided by the factor, so the band is never touched.
        expect(v.scale[1], 'the factory is a deliberate 1.14 up-fit').toBeCloseTo(1.14, 4)
        expect(defFor(id).visual!.maxScaleDeviation, 'and it rides the default band').toBeUndefined()
      } else if (id === 'building_shop_02') {
        // Book Nook is the mirror case: a deliberate 1.15 UP-fit, expressed the same way (the
        // reference is the lot divided by 1.15) and landing exactly on the +/-15% band the
        // projection already allows — no threshold is relaxed to accept it.
        expect(v.scale[1], 'Book Nook is a deliberate 1.15 up-fit').toBeCloseTo(1.15, 4)
        expect(defFor(id).visual!.maxScaleDeviation, 'and it rides the default band').toBeUndefined()
      } else {
        expect(v.scale, `${id} 1:1 fit (the lot IS the reference box)`).toEqual([1, 1, 1])
      }
      expect(wrap(v.rotationY), `${id} projection yaw`).toBeCloseTo(wrap(want.projectionYaw), 9)
      // THE claim: projection yaw composed with the row's own manifest yaw reaches the authored door
      // (or, for a lot that authors none, the declared canonical facing).
      const entry = ASSET_MANIFEST_BY_ID.get(want.body)!
      expect(wrap(v.rotationY + entry.rotation[1]), `${id} composed yaw faces ${want.door ?? want.canonicalFacing}`)
        .toBeCloseTo(wrap(FACING_YAW[want.door ?? want.canonicalFacing]), 9)
    }
  })

  it('points every SINGLE-ELEVATION body at the camera, and exempts the others by measurement', () => {
    expect(CAMERA_FACING_DOORS.slice().sort(), 'doors the fixed rig can see').toEqual(['east', 'south'])
    for (const id of REUSED_IDS) {
      const want = REUSED[id]
      const facing = want.door ?? want.canonicalFacing
      if (!SINGLE_ELEVATION.has(want.body)) continue
      const secondary = SECONDARY_FRONTAGE[id]
      if (!secondary) {
        expect(CAMERA_FACING_DOORS, `${id} shows ${want.body}'s decorated elevation`).toContain(facing)
        continue
      }
      // A named exception still has to PROVE it: rotate the declared elevation's own normal by this
      // placement's composed yaw and require it to land on a side the fixed rig can see.
      const entry = ASSET_MANIFEST_BY_ID.get(want.body)!
      const composed = wrap(resolveBuildingVisual(defFor(id))!.rotationY + entry.rotation[1])
      const world = new THREE.Vector3(...ELEVATION_NORMAL[secondary.elevation])
        .applyAxisAngle(new THREE.Vector3(0, 1, 0), composed)
      const seen = world.dot(new THREE.Vector3(CAMERA_OFFSET[0], 0, CAMERA_OFFSET[2]))
      expect(seen, `${id} turns its ${secondary.elevation} elevation toward the camera`).toBeGreaterThan(0)
      // ...and the primary frontage really is the one that had to give way, i.e. it faces AWAY.
      const front = new THREE.Vector3(0, 0, 1).applyAxisAngle(new THREE.Vector3(0, 1, 0), composed)
      expect(front.dot(new THREE.Vector3(CAMERA_OFFSET[0], 0, CAMERA_OFFSET[2])),
        `${id} only claims the exception because its front is turned away`).toBeLessThan(0)
    }
    // The exempt bodies are exactly the two the manifest measured as having no wrong front.
    const exempt = Object.values(BODIES).map((b) => b.id).filter((id) => !SINGLE_ELEVATION.has(id))
    expect(exempt.sort(), 'bodies exempt from the facing rule').toEqual([BODIES.apartment.id, BODIES.hotel.id].sort())
    // The lot still rejected for facing stays procedural, with its authored facts intact. Its door is
    // WEST, so the composed yaw is -π/2: the shop's front swings to world west and its measured second
    // elevation to world north — BOTH away from the camera — which is why the exception above cannot
    // rescue it and why it is not mapped.
    const commons = defFor('building_commons_w1')
    expect(commons.visual, 'building_commons_w1 stays procedural').toBeUndefined()
    expect(commons.door, 'building_commons_w1 authored door').toBe('west')
    expect(CAMERA_FACING_DOORS, 'building_commons_w1 is rejected BECAUSE its door faces away').not.toContain(commons.door)
    for (const elevation of ['+z', '-x'] as const) {
      const world = new THREE.Vector3(...ELEVATION_NORMAL[elevation])
        .applyAxisAngle(new THREE.Vector3(0, 1, 0), FACING_YAW.west - FACING_YAW.south)
      expect(world.dot(new THREE.Vector3(CAMERA_OFFSET[0], 0, CAMERA_OFFSET[2])),
        `building_commons_w1 would hide the shop's ${elevation} elevation`).toBeLessThan(0)
    }
    // Exactly one placement leans on a secondary elevation, and it is the one reviewed for it.
    expect(Object.keys(SECONDARY_FRONTAGE), 'placements using a secondary elevation').toEqual(['building_deli_s1'])
  })

  it('holds every rendered body inside its lot, grounded, under the camera — measured from the bytes', () => {
    for (const id of REUSED_IDS) {
      const want = REUSED[id]
      const v = resolveBuildingVisual(defFor(id))!
      const entry = ASSET_MANIFEST_BY_ID.get(want.body)!
      const composed = wrap(v.rotationY + entry.rotation[1])
      const reach = renderedReach(want.body, FILE_OF.get(want.body)!, composed, v.scale)
      expect(reach.baseY, `${id} base at the ground`).toBeCloseTo(0, 6)
      expect(reach.halfX, `${id} rendered half-X inside the lot`).toBeLessThanOrEqual(want.size[0] / 2)
      expect(reach.halfZ, `${id} rendered half-Z inside the lot`).toBeLessThanOrEqual(want.size[2] / 2)
      // ...and not so far inside that a player collides with a wall they cannot see.
      expect(want.size[0] / 2 - reach.halfX, `${id} half-X slack vs the shipped worst case`).toBeLessThanOrEqual(MAX_HALF_EXTENT_SLACK)
      expect(want.size[2] / 2 - reach.halfZ, `${id} half-Z slack vs the shipped worst case`).toBeLessThanOrEqual(MAX_HALF_EXTENT_SLACK)
      expect(reach.height, `${id} rendered height under the camera clearance limit`).toBeLessThan(MAX_WORLD_RENDER_HEIGHT)
    }
  })

  it('adds exactly these twenty-two mappings — 55 projections, 64 of 73 placements mapped', () => {
    const byBody = (assetId: string) => BUILDINGS.filter((b) => b.visual?.assetId === assetId).map((b) => b.id).sort()
    expect(byBody(BODIES.shop.id), 'shop-row projections').toEqual(
      [...REUSED_IDS.filter((id) => REUSED[id].body === BODIES.shop.id), 's1_-1_s1', 's1_-2_s1', 's0_-2_shop'].sort())
    expect(byBody(BODIES.garage.id), 'garage-row projections').toEqual(
      REUSED_IDS.filter((id) => REUSED[id].body === BODIES.garage.id).sort())
    expect(byBody(BODIES.apartment.id), 'apartment-row projections').toEqual(
      REUSED_IDS.filter((id) => REUSED[id].body === BODIES.apartment.id).sort())
    expect(byBody(BODIES.hotel.id), 'hotel-row projections').toEqual(
      ['building_tower_02', 'building_tower_03', 'building_tower_06'])
    expect(byBody(BODIES.rowHouse.id), 'row-house projections').toEqual(
      [...REUSED_IDS.filter((id) => REUSED[id].body === BODIES.rowHouse.id), 's1_-1_s2', 's1_-2_s2', 's2_-1_n4'].sort())
    const glbBodies = BUILDINGS.filter((b) => {
      const entry = ASSET_MANIFEST_BY_ID.get(b.visual?.assetId ?? b.id)
      return Boolean(entry?.enabled && entry.glbPath)
    })
    // Mapped placements (own-row bodies + projections), not unique assets and not visual acceptance.
    expect(BUILDINGS.filter((b) => b.visual).length, 'visual-projected placements')
      .toBe(PRE_CHANGE.projections + REUSED_IDS.length + PINNED_ELSEWHERE.length)
    expect(glbBodies.length, 'mapped placements').toBe(PRE_CHANGE.mapped + REUSED_IDS.length + PINNED_ELSEWHERE.length)
    expect(BUILDINGS.length, 'authored placements').toBe(PRE_CHANGE.placements)
    expect(REUSED_IDS.filter((id) => REUSED[id].batch === 1).length, 'batch 1').toBe(3)
    expect(REUSED_IDS.filter((id) => REUSED[id].batch === 3).length, 'batch 3 (placement closure)').toBe(5)
    expect(REUSED_IDS.filter((id) => REUSED[id].batch === 4).length, 'batch 4 (industrial yard)').toBe(3)
  })

  it('records how close each reuse lands to another instance of the same body', () => {
    // REPETITION POLICY. Batch 1 asserted a 30 m floor between instances of one body. Under the owner's
    // 2026-09-18 direction cosmetic repetition is DEFERRED POLISH and not a functional blocker, so the
    // threshold is relaxed to a geometric one — two instances must not be close enough to read as one
    // duplicated wall — and the real distances are PINNED instead, so any future placement that tightens
    // them shows up as a diff and gets looked at. The facing, fit, footprint and slack assertions above
    // are untouched: this is the only cosmetic rule in the file.
    for (const id of REUSED_IDS) {
      const me = defFor(id)
      const want = REUSED[id]
      const siblings = BUILDINGS.filter((b) => b.id !== id && (b.visual?.assetId ?? b.id) === want.body)
      expect(siblings.length, `${id} has siblings to compare against`).toBeGreaterThan(0)
      const sorted = siblings
        .map((b) => ({ id: b.id, d: Math.hypot(b.position[0] - me.position[0], b.position[1] - me.position[1]) }))
        .sort((a, b) => a.d - b.d)
      expect(sorted[0].id, `${id} nearest same-body placement`).toBe(want.nearestSameBody[0])
      expect(sorted[0].d, `${id} nearest same-body distance`).toBeCloseTo(want.nearestSameBody[1], 1)
      // Geometric floor: further apart than the two authored footprints could ever span.
      const sibling = siblings.find((b) => b.id === sorted[0].id)!
      expect(sorted[0].d, `${id} does not overlap its nearest twin`)
        .toBeGreaterThan((Math.max(...want.size) + Math.max(...sibling.size)) / 2)
    }
  })

  it('every other placement, every prop, every destination and the pedestrian graph are unchanged', () => {
    const withoutTheReuse = BUILDINGS.map((b) => (REUSED_IDS.includes(b.id) || PINNED_ELSEWHERE.includes(b.id)
      ? Object.fromEntries(Object.entries(b).filter(([key]) => key !== 'visual'))
      : b))
    expect({
      buildings: hash(JSON.stringify(withoutTheReuse)),
      props: hash(JSON.stringify(PROPS)),
      destinations: hash(canonical(CITIZEN_DESTINATIONS)),
      graph: hash(canonical(PEDESTRIAN_GRAPH)),
    }, 'pre-change export digests').toEqual({
      buildings: PRE_CHANGE.buildings,
      props: PRE_CHANGE.props,
      destinations: PRE_CHANGE.citizenDestinations,
      graph: PRE_CHANGE.pedestrianGraph,
    })
  })

  it('keeps every occluder footprint, and only raises a top where the body genuinely is taller', () => {
    for (const id of REUSED_IDS) {
      const def = defFor(id)
      const occ = getBuildingOccluderDescriptor(def)
      const [w, h, d] = def.size
      expect(occ.bounds2D, `${id} occluder footprint`).toEqual({
        minX: def.position[0] - w / 2, maxX: def.position[0] + w / 2,
        minZ: def.position[1] - d / 2, maxZ: def.position[1] + d / 2,
      })
      expect(occ.minY, `${id} occluder base`).toBe(0)
      const v = resolveBuildingVisual(def)!
      const top = v.offset[1] + v.scale[1] * ASSET_MANIFEST_BY_ID.get(v.assetId)!.renderedTopY!
      // Issue #46's rule, unchanged: the taller of the authored massing and what actually renders.
      expect(occ.maxY, `${id} occluder top`).toBeCloseTo(Math.max(h + BUILDING_ROOF_EXTRA, top), 6)
      expect(occ.enabled, `${id} occluder enabled`).toBe(true)
    }
    // Only the three lots whose approved body genuinely overtops the authored massing gain height.
    const raised = REUSED_IDS.filter((id) => {
      const def = defFor(id)
      return getBuildingOccluderDescriptor(def).maxY > def.size[1] + BUILDING_ROOF_EXTRA + 1e-9
    })
    expect(raised.sort(), 'occluders raised to match a taller body')
      .toEqual([
        'building_gate_tower_01', 'building_tower_02', 'building_tower_03', 'building_tower_05',
        'building_tower_06',
      ])
  })

  it('each sign anchor moves to its row\'s label height and clears the rendered roof', () => {
    for (const id of REUSED_IDS) {
      const def = defFor(id)
      const entry = ASSET_MANIFEST_BY_ID.get(REUSED[id].body)!
      const v = resolveBuildingVisual(def)!
      const anchor = projectedLabelHeight(v, entry.labelHeight!)
      expect(anchor, `${id} model anchor`).toBeCloseTo(v.scale[1] * entry.labelHeight!, 9)
      expect(anchor - v.scale[1] * entry.renderedTopY!, `${id} anchor above the rendered roof`).toBeGreaterThan(1)
    }
  })

  it('adds no window-overlay grid and no variant-cache key, and keeps every overlay seed distinct', () => {
    for (const body of Object.values(BODIES)) {
      expect(WINDOW_OVERLAYS.filter((o) => o.buildingAssetId === body.id), `${body.id} overlays`).toEqual([])
    }
    const seeds = REUSED_IDS.map((id) => resolveBuildingVisual(defFor(id))!.overlaySeed)
    expect(new Set(seeds).size, 'distinct seeds').toBe(seeds.length)
  })
})
