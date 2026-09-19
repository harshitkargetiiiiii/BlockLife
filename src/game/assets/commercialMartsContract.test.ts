// @vitest-environment node
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import * as THREE from 'three'
import { describe, expect, it } from 'vitest'
import { ASSET_MANIFEST_BY_ID } from './assetManifest'
import { BUILDINGS, PROPS } from '../world/cityLayout'
import { WINDOW_OVERLAYS } from '../world/windowOverlayData'
import { getBuildingOccluderDescriptor } from '../visibility/occluderData'
import { projectedLabelHeight, resolveBuildingVisual } from '../world/buildingProjection'
import type { BuildingDef } from '../world/worldTypes'

/**
 * Issue #60 — Main St Mart and North Mart, the two compiled `small_shop` lots that still rendered the
 * procedural box, now drawn by the already-shipped Wave 3 shop body (`building_shop_01` →
 * `arch_shop_01.glb`) at its existing uniform 1.206 calibration. No new manifest row, alias, GLB,
 * texture, renderer or compiler path: each lot uses the optional `LotAuthoringSpec.visual`
 * pass-through issue #55 added. Mapping intent, not visual acceptance.
 */

type Facing = 'north' | 'south' | 'east' | 'west'
type Vec3 = [number, number, number]
const YAW: Record<Facing, number> = { south: 0, north: Math.PI, east: Math.PI / 2, west: -Math.PI / 2 }
const DOOR_DIR: Record<Facing, [number, number]> = { south: [0, 1], north: [0, -1], east: [1, 0], west: [-1, 0] }

const ROW = 'building_shop_01'
const ROW_FILE = 'assets/models/city/arch_shop_01.glb'
const ROW_FILE_SHA256 = 'fc758a288365afa4450aa78dc03cce7d7936b6456f81ea0cf19b16ca6b0eaf61'
/** The small_shop template's facts every compiled small-shop lot carries. */
const TEMPLATE_COLORS: [string, string, string] = ['#e3b448', '#a87f2c', '#5f9ea0']

/** The EXACT two, with the exported authored facts and front-detail props each lot had before this slice. */
const MARTS: Record<string, { position: [number, number]; door: Facing; label: string; front: { id: string; type: string; position: [number, number] }[] }> = {
  's1_-1_s1': {
    position: [85.36, -86], door: 'north', label: 'Main St Mart',
    front: [
      { id: 's1_-1_s1_front_0', type: 'signboard', position: [87.5, -90.3] },
      { id: 's1_-1_s1_front_1', type: 'flower_pot', position: [83.3, -90.1] },
    ],
  },
  's1_-2_s1': {
    position: [90, -290], door: 'north', label: 'North Mart',
    front: [
      { id: 's1_-2_s1_front_0', type: 'signboard', position: [92.1, -294.3] },
      { id: 's1_-2_s1_front_1', type: 'flower_pot', position: [87.9, -294.1] },
    ],
  },
}
const IDS = Object.keys(MARTS)
/** The later issue #61 free-lot projection of the same row, pinned in commercialBaySupplyContract.test.ts. */
const ISSUE_61_BAY = 's0_-2_shop'
/** The later issue #63 office projections (a different body), pinned in commercialOfficesContract.test.ts. */
const ISSUE_63_OFFICES = ['s1_-1_n1', 's1_-2_n1']
/**
 * The LATER issue #53 archetype-reuse projections, pinned with their authored facts, resolved
 * projections and fit derivations in `archetypeReuseContract.test.ts`: fourteen authored lots drawn by
 * five already-approved rows (shop, garage, row house, apartment, gateway hotel) at their existing
 * calibrations. They add `visual` keys to fourteen placements this slice never touched, so they are
 * excluded here exactly as the other later slices are.
 */
const ISSUE_53_REUSE = ['building_market_02', 'building_gate_retail_01', 'building_depot_n1',
  'building_cafe_01', 'building_market_01', 'building_tower_02', 'building_tower_05', 'building_gate_tower_01',
  's1_-1_n2', 's1_-1_n3', 's1_-2_n2', 's1_-2_n3', 's-1_-2_w2', 's-1_-2_w4']
/** The four of them that project the shop row (the depot projects the garage row). */
const ISSUE_53_SHOPS = ['building_market_02', 'building_gate_retail_01', 'building_cafe_01',
  'building_market_01', 's1_-1_n2', 's1_-2_n2']


/**
 * sha256 of BUILDINGS (with ONLY these two lots' `visual` removed) and of PROPS exactly as the
 * delivered townhouse slice `9d57f2cd` exported them, captured before this slice's source changed. Any
 * other change to any placement — including the twenty-three issue #55 mappings — fails here.
 */
const BUILDINGS_WITHOUT_THE_TWO_VISUALS_SHA256 = '97a1154e41e8740904bae36ab0f40501462c5ca5269fbd42374a3fb9186a691f'
const PROPS_SHA256 = 'd94702c5e475f075a28e2b7a3b476ac8bc0df42fc9655bfa52ccfdb45732be3b'

const defFor = (id: string) => BUILDINGS.find((b) => b.id === id) as BuildingDef
const sha256 = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex')

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

/** The fitted body's footprint corners, yawed onto `door`, relative to the placement centre. */
function yawedCorners(door: Facing): [number, number][] {
  const entry = ASSET_MANIFEST_BY_ID.get(ROW)!
  const { min, max } = glbBounds(ROW_FILE)
  const yaw = YAW[door]
  const out: [number, number][] = []
  for (const x of [min[0], max[0]]) {
    for (const z of [min[2], max[2]]) {
      const lx = x * entry.scale[0]
      const lz = z * entry.scale[2]
      out.push([lx * Math.cos(yaw) + lz * Math.sin(yaw), -lx * Math.sin(yaw) + lz * Math.cos(yaw)])
    }
  }
  return out
}

describe('issue #60 — Main St Mart and North Mart on the shipped shop body', () => {
  it('the shop body is the shipped file, byte for byte, and its row is unchanged', () => {
    expect(createHash('sha256').update(readFileSync(`public/${ROW_FILE}`)).digest('hex')).toBe(ROW_FILE_SHA256)
    const entry = ASSET_MANIFEST_BY_ID.get(ROW)!
    expect(entry.glbPath).toBe(ROW_FILE)
    expect(entry.enabled).toBe(true)
    expect(entry.fallbackKey).toBe('BuildingMesh')
    expect(entry.scale).toEqual([1.206, 1.206, 1.206])
    expect(entry.rotation).toEqual([0, 0, 0])
    expect(entry.positionOffset).toEqual([0, 0, 0])
    expect(entry.labelHeight).toBe(6)
    expect(entry.bounds).toEqual({ width: 5.9925, height: 4.824, depth: 4.8836 })
    expect(entry.renderedTopY).toBe(4.824)
    expect(entry.materialSlots).toEqual({})
    expect(entry.variants).toBeUndefined()
    // Its own Wave 3 placement still reaches it through its manifest id, with no projection.
    expect(defFor(ROW).visual, 'the Wave 3 Mini Mart placement is untouched').toBeUndefined()
  })

  it('keeps every exported authored fact of the two lots', () => {
    for (const [id, want] of Object.entries(MARTS)) {
      const def = defFor(id)
      expect(def, `${id} still authored`).toBeTruthy()
      expect(def.position[0], `${id} x`).toBeCloseTo(want.position[0], 9)
      expect(def.position[1], `${id} z`).toBeCloseTo(want.position[1], 9)
      expect(def.size, `${id} authored box`).toEqual([6, 5, 6])
      expect(def.door, `${id} door`).toBe(want.door)
      expect([def.color, def.roofColor, def.accentColor], `${id} fallback colours`).toEqual(TEMPLATE_COLORS)
      expect(def.label, `${id} label`).toBe(want.label)
      expect(def.labelColor, `${id} label colour`).toBe('#fff3c9')
      expect(def.paletteVariant, `${id} tints nothing`).toBeUndefined()
    }
  })

  it('adds exactly these two mappings: 39 of 73 placements mapped to a GLB body (40 with issue #61\'s Bay Supply)', () => {
    expect(BUILDINGS.filter((b) => b.visual?.assetId === ROW).map((b) => b.id).sort(), 'projections of the shop body').toEqual([...IDS, ISSUE_61_BAY, ...ISSUE_53_SHOPS].sort())
    const glbBodies = BUILDINGS.filter((b) => {
      const entry = ASSET_MANIFEST_BY_ID.get(b.visual?.assetId ?? b.id)
      return Boolean(entry?.enabled && entry.glbPath)
    })
    // Mapped placements (own-row bodies + projections), not unique assets and not visual acceptance.
    // This slice made it 39 / 30; issue #61's Bay Supply adds one more and issue #63's two offices two more.
    expect(glbBodies.length, 'mapped placements').toBe(39 + 1 + ISSUE_63_OFFICES.length + ISSUE_53_REUSE.length)
    expect(BUILDINGS.filter((b) => b.visual).length, 'visual-projected placements').toBe(30 + 1 + ISSUE_63_OFFICES.length + ISSUE_53_REUSE.length)
    expect(BUILDINGS.length, 'authored placements').toBe(73)
  })

  it('every other placement — including the twenty-three issue #55 mappings — and every prop is unchanged', () => {
    const withoutTheTwo = BUILDINGS.map((b) => (IDS.includes(b.id) || b.id === ISSUE_61_BAY || ISSUE_63_OFFICES.includes(b.id) || ISSUE_53_REUSE.includes(b.id)
      ? Object.fromEntries(Object.entries(b).filter(([key]) => key !== 'visual'))
      : b))
    expect({ buildings: sha256(withoutTheTwo), props: sha256(PROPS) }, 'delivered townhouse slice export digests').toEqual({
      buildings: BUILDINGS_WITHOUT_THE_TWO_VISUALS_SHA256,
      props: PROPS_SHA256,
    })
  })

  it('projects the body uniformly and facing-only onto each authored door', () => {
    for (const [id, want] of Object.entries(MARTS)) {
      const def = defFor(id)
      expect(def.visual, `${id} visual`).toEqual({ assetId: ROW, referenceSize: [6, 5, 6], canonicalFacing: 'south', maxScaleDeviation: 0 })
      const v = resolveBuildingVisual(def)!
      expect(v.scale, `${id} resolved scale`).toEqual([1, 1, 1])
      expect(v.offset, `${id} resolved offset`).toEqual([0, 0, 0])
      expect(v.paletteVariant, `${id} palette`).toBeUndefined()
      expect(Math.sin(v.rotationY), `${id} yaw`).toBeCloseTo(Math.sin(YAW[want.door]), 9)
      expect(Math.cos(v.rotationY), `${id} yaw`).toBeCloseTo(Math.cos(YAW[want.door]), 9)
    }
  })

  it('the rendered body stays inside each 6 x 6 lot after its yaw, grounded — measured from the bytes', () => {
    const entry = ASSET_MANIFEST_BY_ID.get(ROW)!
    const { min } = glbBounds(ROW_FILE)
    expect(min[1] * entry.scale[1], 'base at the ground').toBeCloseTo(0, 6)
    for (const [id, want] of Object.entries(MARTS)) {
      const corners = yawedCorners(want.door)
      expect(Math.max(...corners.map(([x]) => Math.abs(x))), `${id} rendered half-X`).toBeLessThanOrEqual(3)
      expect(Math.max(...corners.map(([, z]) => Math.abs(z))), `${id} rendered half-Z`).toBeLessThanOrEqual(3)
    }
  })

  it('the preserved signboard and flower pot stand in front of the rendered shopfront, not inside it', () => {
    for (const want of Object.values(MARTS)) {
      const [dx, dz] = DOOR_DIR[want.door]
      // How far the yawed body reaches toward the street from the lot centre.
      const reach = Math.max(...yawedCorners(want.door).map(([x, z]) => x * dx + z * dz))
      for (const prop of want.front) {
        const actual = PROPS.find((p) => p.id === prop.id)
        expect(actual, `${prop.id} still emitted`).toBeTruthy()
        expect(actual!.type, `${prop.id} type`).toBe(prop.type)
        expect(actual!.position[0], `${prop.id} x`).toBeCloseTo(prop.position[0], 9)
        expect(actual!.position[1], `${prop.id} z`).toBeCloseTo(prop.position[1], 9)
        const out = (prop.position[0] - want.position[0]) * dx + (prop.position[1] - want.position[1]) * dz
        expect(out, `${prop.id} is on the street side of the authored box face`).toBeGreaterThan(3)
        expect(out - reach, `${prop.id} clearance in front of the rendered shopfront`).toBeGreaterThan(1)
      }
    }
  })

  it('occlusion keeps the authored footprint; the 5.5 m box-plus-slab stays taller than the 4.824 m body', () => {
    const top = ASSET_MANIFEST_BY_ID.get(ROW)!.renderedTopY!
    for (const id of IDS) {
      const def = defFor(id)
      const occ = getBuildingOccluderDescriptor(def)
      expect(occ.bounds2D, `${id} occluder footprint`).toEqual({
        minX: def.position[0] - 3, maxX: def.position[0] + 3,
        minZ: def.position[1] - 3, maxZ: def.position[1] + 3,
      })
      expect(occ.minY, `${id} occluder minY`).toBe(0)
      expect(top, 'rendered roof below the box plus slab').toBeLessThan(def.size[1] + 0.5)
      expect(occ.maxY, `${id} occluder maxY is the box plus slab`).toBeCloseTo(def.size[1] + 0.5, 9)
      expect(occ.enabled, `${id} participates in occlusion`).toBe(true)
    }
  })

  it('the sign anchor moves from the procedural 6.6 m to the row\'s 6 m, above the 4.824 m rendered roof', () => {
    const entry = ASSET_MANIFEST_BY_ID.get(ROW)!
    for (const id of IDS) {
      const def = defFor(id)
      const v = resolveBuildingVisual(def)
      // Buildings.tsx: a registered model uses the row's labelHeight, projected; the box would use size + 1.6.
      expect(def.size[1] + 1.6, `${id} procedural anchor`).toBeCloseTo(6.6, 9)
      expect(projectedLabelHeight(v, entry.labelHeight!), `${id} model anchor`).toBeCloseTo(6, 9)
      expect(projectedLabelHeight(v, entry.labelHeight!) - entry.renderedTopY!, `${id} anchor above the rendered roof`).toBeCloseTo(1.176, 9)
    }
  })

  it('carries no window-overlay grid, and each Mart keeps its own overlay seed', () => {
    expect(WINDOW_OVERLAYS.filter((o) => o.buildingAssetId === ROW), `${ROW} overlays`).toEqual([])
    const seeds = [ROW, ...IDS].map((id) => resolveBuildingVisual(defFor(id))?.overlaySeed ?? id)
    expect(new Set(seeds).size, 'distinct seeds').toBe(3)
  })
})
