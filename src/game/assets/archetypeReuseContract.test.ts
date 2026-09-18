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
 * Issue #53 archetype reuse — five authored lots that still drew the procedural `BuildingMesh` now draw
 * an ALREADY-APPROVED, already-shipped body at its EXISTING calibration:
 *
 *   - two 6 x 5 x 6 retail lots (Market Row East, Avenue Deli) on the Wave 3 shop row
 *     `building_shop_01` — the same row, the same reference box and the same 1.206 uniform fit Mini
 *     Mart, the two Marts and Bay Supply already ship on;
 *   - the North Depot ([8, 5.5, 7]) on the Wave 3 garage row `building_garage_01` — the identical box
 *     `building_garage_01`'s own placement authors, so its 0.6304 fit carries over untouched.
 *
 * Nothing is generated, re-fitted, re-textured or re-calibrated: the only production change is three
 * `BuildingDef.visual` keys. Mapping intent and derivation, NOT visual acceptance.
 *
 * WHY ONLY TWO OF THE FOUR eligible 6 x 5 x 6 retail lots: `arch_shop_01` decorates exactly ONE
 * elevation (glazed shopfront + awning on model +z; the manifest records the other three as blank
 * render), and `CAMERA_OFFSET` is a FIXED isometric rig at +x / +z, so a player only ever sees a
 * building's +x and +z faces. A lot whose authored door is 'west' or 'north' therefore yaws that one
 * decorated elevation permanently out of view and trades a windowed procedural facade for a blank
 * wall. West Commons ('west') and South Deli ('north') were built, rendered and rejected on exactly
 * that evidence. `CAMERA_FACING_DOORS` below gates the rule for every future reuse of this row.
 *
 * The one subtlety this file exists to pin is `canonicalFacing` on the depot. For every earlier
 * projection the archetype's manifest `rotation` is [0, 0, 0], so "the model's canonical front" and
 * "the front of the MOUNTED body" are the same direction and the distinction never mattered. The garage
 * row carries `rotation: [0, -pi/2, 0]` (Wave 3 turned its +z roller-shutter elevation west for its own
 * west door), and `LandmarkAsset` applies that rotation INSIDE the projection group. `canonicalFacing`
 * therefore has to name the mounted body's facing — 'west' — and the assertions below check the
 * COMPOSED yaw (projection + manifest) against the authored door, which is what actually renders.
 */

type Vec3 = [number, number, number]
type Facing = 'north' | 'south' | 'east' | 'west'

const SHOP = 'building_shop_01'
const SHOP_FILE = 'assets/models/city/arch_shop_01.glb'
const SHOP_FILE_SHA256 = 'fc758a288365afa4450aa78dc03cce7d7936b6456f81ea0cf19b16ca6b0eaf61'
const GARAGE = 'building_garage_01'
const GARAGE_FILE = 'assets/models/city/arch_repair_garage_01.glb'
const GARAGE_FILE_SHA256 = 'fe870f4c3704dc911f45162854b68785a397f94c7b806848ef74ccd68f54fe6c'

/** Every authored fact of the five lots, transcribed from cityLayout BEFORE this slice. */
const REUSED: Record<string, {
  assetId: string
  position: [number, number]
  size: Vec3
  door: Facing
  /** Yaw the projection alone must contribute, and the composed yaw that must reach the door. */
  projectionYaw: number
  label?: string
  colors: [string, string, string]
}> = {
  building_market_02: { assetId: SHOP, position: [39, 22], size: [6, 5, 6], door: 'east', projectionYaw: Math.PI / 2, colors: ['#9ea86a', '#6a7340', '#d9825f'] },
  building_gate_retail_01: { assetId: SHOP, position: [33, -104], size: [6, 5, 6], door: 'east', projectionYaw: Math.PI / 2, label: 'Avenue Deli', colors: ['#e3b448', '#a87f2c', '#5f9ea0'] },
  // 'west' canonical facing, so this lot's east door is a clean pi turn ON TOP of the row's own -pi/2.
  building_depot_n1: { assetId: GARAGE, position: [38.5, -36.5], size: [8, 5.5, 7], door: 'east', projectionYaw: Math.PI, colors: ['#6e7b8a', '#48525e', '#5faf7f'] },
}
const REUSED_IDS = Object.keys(REUSED)
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
const RETAIL_IDS = REUSED_IDS.filter((id) => REUSED[id].assetId === SHOP)

/** The placements that ALREADY drew these two rows before this slice. */
const EXISTING_SHOP = ['building_shop_01', 's1_-1_s1', 's1_-2_s1', 's0_-2_shop']
const EXISTING_GARAGE = ['building_garage_01']

/**
 * Digests captured from the UNTOUCHED tree at `991a61f7` (the branch base), before this slice edited any
 * file: global BUILDINGS and PROPS as the sibling contracts hash them, plus the citizen destinations and
 * the pedestrian graph. The five new `visual` keys are appended last in their object literals, so
 * dropping them reproduces the pre-change key order exactly.
 */
const PRE_CHANGE = {
  buildings: 'c3b2a212dfbdb81b04074f79ce20f0f4e6358953deb46a2e5daf25ddeb22388c',
  props: 'd94702c5e475f075a28e2b7a3b476ac8bc0df42fc9655bfa52ccfdb45732be3b',
  citizenDestinations: '9cdd87b48e7d338a5fdf41404ce0cdf5e612f195b36453390bd60fc9c4caf736',
  pedestrianGraph: '0f7dd3de60cbccf0585465d0c39f1d33b85d64d07133519a0a29c47ae7eed06d',
  /** Projections / authored placements before this slice. */
  projections: 33,
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
function renderedReach(assetId: string, file: string, yaw: number): { halfX: number; halfZ: number; height: number; baseY: number } {
  const entry = ASSET_MANIFEST_BY_ID.get(assetId)!
  const { min, max } = glbBounds(file)
  let halfX = 0
  let halfZ = 0
  for (const x of [min[0], max[0]]) {
    for (const z of [min[2], max[2]]) {
      const lx = x * entry.scale[0]
      const lz = z * entry.scale[2]
      halfX = Math.max(halfX, Math.abs(lx * Math.cos(yaw) + lz * Math.sin(yaw)))
      halfZ = Math.max(halfZ, Math.abs(-lx * Math.sin(yaw) + lz * Math.cos(yaw)))
    }
  }
  return { halfX, halfZ, height: (max[1] - min[1]) * entry.scale[1], baseY: min[1] * entry.scale[1] }
}

describe('issue #53 — five procedural lots on two already-approved archetype rows', () => {
  it('both rows are the shipped files, byte for byte, with their calibrations untouched', () => {
    expect(createHash('sha256').update(readFileSync(`public/${SHOP_FILE}`)).digest('hex')).toBe(SHOP_FILE_SHA256)
    expect(createHash('sha256').update(readFileSync(`public/${GARAGE_FILE}`)).digest('hex')).toBe(GARAGE_FILE_SHA256)

    const shop = ASSET_MANIFEST_BY_ID.get(SHOP)!
    expect(shop.glbPath).toBe(SHOP_FILE)
    expect(shop.enabled).toBe(true)
    expect(shop.fallbackKey).toBe('BuildingMesh')
    expect(shop.scale).toEqual([1.206, 1.206, 1.206])
    expect(shop.rotation).toEqual([0, 0, 0])
    expect(shop.positionOffset).toEqual([0, 0, 0])
    expect(shop.labelHeight).toBe(6)
    expect(shop.bounds).toEqual({ width: 5.9925, height: 4.824, depth: 4.8836 })
    expect(shop.renderedTopY).toBe(4.824)
    expect(shop.materialSlots).toEqual({})
    expect(shop.variants).toBeUndefined()

    const garage = ASSET_MANIFEST_BY_ID.get(GARAGE)!
    expect(garage.glbPath).toBe(GARAGE_FILE)
    expect(garage.enabled).toBe(true)
    expect(garage.fallbackKey).toBe('BuildingMesh')
    expect(garage.scale).toEqual([0.6304, 0.6304, 0.6304])
    expect(garage.rotation).toEqual([0, -Math.PI / 2, 0])
    expect(garage.positionOffset).toEqual([0, 0, 0])
    expect(garage.labelHeight).toBe(5)
    expect(garage.renderedTopY).toBe(3.7824)
    expect(garage.materialSlots).toEqual({})
    expect(garage.variants).toBeUndefined()

    // The two rows' OWN placements stay legacy (id-keyed, no projection).
    expect(defFor(SHOP).visual, 'Mini Mart is untouched').toBeUndefined()
    expect(defFor(GARAGE).visual, 'the Garage placement is untouched').toBeUndefined()
  })

  it('keeps every authored fact of the five reused lots', () => {
    for (const id of REUSED_IDS) {
      const def = defFor(id)
      const want = REUSED[id]
      expect(def.position, `${id} position`).toEqual(want.position)
      expect(def.size, `${id} size`).toEqual(want.size)
      expect(def.door, `${id} door`).toBe(want.door)
      expect([def.color, def.roofColor, def.accentColor], `${id} fallback colours`).toEqual(want.colors)
      expect(def.label, `${id} label`).toBe(want.label)
      expect(def.paletteVariant, `${id} tints nothing`).toBeUndefined()
    }
    expect(defFor('building_depot_n1').windows, 'the depot keeps its authored windowless fallback').toBe(false)
  })

  it('resolves every projection to scale 1, no offset, and a pure facing yaw', () => {
    for (const id of REUSED_IDS) {
      const want = REUSED[id]
      const v = resolveBuildingVisual(defFor(id))!
      expect(v.assetId, `${id} archetype`).toBe(want.assetId)
      expect(v.scale, `${id} uniform 1:1 fit (the lot IS the reference box)`).toEqual([1, 1, 1])
      expect(v.offset, `${id} offset`).toEqual([0, 0, 0])
      expect(v.paletteVariant, `${id} palette`).toBeUndefined()
      expect(wrap(v.rotationY), `${id} projection yaw`).toBeCloseTo(wrap(want.projectionYaw), 9)
      // THE claim: projection yaw composed with the row's own manifest yaw reaches the authored door.
      const entry = ASSET_MANIFEST_BY_ID.get(want.assetId)!
      expect(wrap(v.rotationY + entry.rotation[1]), `${id} composed yaw faces its ${want.door} door`)
        .toBeCloseTo(wrap(FACING_YAW[want.door]), 9)
    }
  })

  it('the rendered body stays inside each authored lot, grounded and under the camera — measured from the bytes', () => {
    for (const id of REUSED_IDS) {
      const want = REUSED[id]
      const file = want.assetId === SHOP ? SHOP_FILE : GARAGE_FILE
      const reach = renderedReach(want.assetId, file, FACING_YAW[want.door])
      expect(reach.baseY, `${id} base at the ground`).toBeCloseTo(0, 6)
      expect(reach.halfX, `${id} rendered half-X inside the lot`).toBeLessThanOrEqual(want.size[0] / 2)
      expect(reach.halfZ, `${id} rendered half-Z inside the lot`).toBeLessThanOrEqual(want.size[2] / 2)
      // The body also stays under the authored massing, so no lot gets taller than it was.
      expect(reach.height, `${id} rendered height under the authored box`).toBeLessThanOrEqual(want.size[1])
      expect(reach.height, `${id} rendered height under the camera clearance limit`).toBeLessThan(MAX_WORLD_RENDER_HEIGHT)
    }
  })

  it('points every reused single-elevation body at the camera', () => {
    expect(CAMERA_FACING_DOORS.sort(), 'doors the fixed rig can see').toEqual(['east', 'south'])
    for (const id of REUSED_IDS) {
      expect(CAMERA_FACING_DOORS, `${id} shows its decorated elevation`).toContain(REUSED[id].door)
    }
    // ...and the two lots rejected for this reason are still procedural, with their authored facts intact.
    for (const [id, door] of [['building_commons_w1', 'west'], ['building_deli_s1', 'north']] as const) {
      const def = defFor(id)
      expect(def.visual, `${id} stays procedural`).toBeUndefined()
      expect(def.door, `${id} authored door`).toBe(door)
      expect(CAMERA_FACING_DOORS, `${id} is rejected BECAUSE its door faces away`).not.toContain(def.door)
    }
  })

  it('adds exactly these three mappings — 36 projections, 45 of 73 placements mapped', () => {
    expect(BUILDINGS.filter((b) => b.visual?.assetId === SHOP).map((b) => b.id).sort(), 'shop-row placements')
      .toEqual([...RETAIL_IDS, ...EXISTING_SHOP.filter((id) => id !== SHOP)].sort())
    expect(BUILDINGS.filter((b) => b.visual?.assetId === GARAGE).map((b) => b.id), 'garage-row projections')
      .toEqual(['building_depot_n1'])
    const glbBodies = BUILDINGS.filter((b) => {
      const entry = ASSET_MANIFEST_BY_ID.get(b.visual?.assetId ?? b.id)
      return Boolean(entry?.enabled && entry.glbPath)
    })
    // Mapped placements (own-row bodies + projections), not unique assets and not visual acceptance.
    expect(BUILDINGS.filter((b) => b.visual).length, 'visual-projected placements')
      .toBe(PRE_CHANGE.projections + REUSED_IDS.length)
    expect(glbBodies.length, 'mapped placements').toBe(42 + REUSED_IDS.length)
    expect(BUILDINGS.length, 'authored placements').toBe(PRE_CHANGE.placements)
  })

  it('no reused body lands within 30 m of another placement drawing the same body', () => {
    for (const id of REUSED_IDS) {
      const mine = defFor(id)
      const siblings = BUILDINGS.filter((b) => b.id !== id && (b.visual?.assetId ?? b.id) === REUSED[id].assetId)
      expect(siblings.length, `${id} has siblings to compare against`).toBeGreaterThan(0)
      const nearest = Math.min(...siblings.map((b) => Math.hypot(b.position[0] - mine.position[0], b.position[1] - mine.position[1])))
      expect(nearest, `${id} nearest same-body placement`).toBeGreaterThan(30)
    }
  })

  it('every other placement, every prop, every destination and the pedestrian graph are unchanged', () => {
    const withoutTheFive = BUILDINGS.map((b) => (REUSED_IDS.includes(b.id)
      ? Object.fromEntries(Object.entries(b).filter(([key]) => key !== 'visual'))
      : b))
    expect({
      buildings: hash(JSON.stringify(withoutTheFive)),
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

  it('occlusion is untouched: authored footprint, and the authored box still the taller of the two', () => {
    for (const id of REUSED_IDS) {
      const def = defFor(id)
      const occ = getBuildingOccluderDescriptor(def)
      const [w, h, d] = def.size
      expect(occ.bounds2D, `${id} occluder footprint`).toEqual({
        minX: def.position[0] - w / 2, maxX: def.position[0] + w / 2,
        minZ: def.position[1] - d / 2, maxZ: def.position[1] + d / 2,
      })
      expect(occ.minY, `${id} occluder base`).toBe(0)
      expect(ASSET_MANIFEST_BY_ID.get(REUSED[id].assetId)!.renderedTopY!, `${id} body under the box-plus-slab`)
        .toBeLessThan(h + BUILDING_ROOF_EXTRA)
      expect(occ.maxY, `${id} occluder top is still the authored massing`).toBeCloseTo(h + BUILDING_ROOF_EXTRA, 9)
      expect(occ.enabled, `${id} occluder enabled`).toBe(true)
    }
  })

  it('each sign anchor moves to its row\'s label height and clears the rendered roof', () => {
    for (const id of REUSED_IDS) {
      const def = defFor(id)
      const entry = ASSET_MANIFEST_BY_ID.get(REUSED[id].assetId)!
      const anchor = projectedLabelHeight(resolveBuildingVisual(def), entry.labelHeight!)
      expect(anchor, `${id} model anchor`).toBeCloseTo(entry.labelHeight!, 9)
      expect(anchor - entry.renderedTopY!, `${id} anchor above the rendered roof`).toBeGreaterThan(1)
    }
  })

  it('carries no window-overlay grid, and every reused placement keeps a distinct overlay seed', () => {
    expect(WINDOW_OVERLAYS.filter((o) => o.buildingAssetId === SHOP || o.buildingAssetId === GARAGE)).toEqual([])
    const seeds = [...REUSED_IDS, ...EXISTING_SHOP, ...EXISTING_GARAGE]
      .map((id) => resolveBuildingVisual(defFor(id))?.overlaySeed ?? id)
    expect(new Set(seeds).size, 'distinct seeds').toBe(seeds.length)
  })
})
