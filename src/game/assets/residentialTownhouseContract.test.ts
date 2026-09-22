// @vitest-environment node
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import * as THREE from 'three'
import { describe, expect, it } from 'vitest'
import { ASSET_MANIFEST_BY_ID } from './assetManifest'
import { BUILDINGS, PROPS } from '../world/cityLayout'
import { WINDOW_OVERLAYS } from '../world/windowOverlayData'
import { getBuildingOccluderDescriptor } from '../visibility/occluderData'
import { resolveBuildingVisual } from '../world/buildingProjection'
import type { BuildingDef } from '../world/worldTypes'

/**
 * Issue #55, townhouse slice — the three compiled `townhouse` lots that still rendered the procedural
 * box, now drawn by the already-shipped Wave 3 row-house body (`building_townhomes_01` →
 * `arch_row_house_01.glb`) at its existing uniform 0.8835 calibration. No new manifest row, alias,
 * GLB, texture, renderer or compiler path: each lot uses the optional `LotAuthoringSpec.visual`
 * pass-through the 5 x 5 slice added. Mapping intent, not visual acceptance.
 */

type Facing = 'north' | 'south' | 'east' | 'west'
type Vec3 = [number, number, number]
const YAW: Record<Facing, number> = { south: 0, north: Math.PI, east: Math.PI / 2, west: -Math.PI / 2 }

const ROW = 'building_townhomes_01'
const ROW_FILE = 'assets/models/city/arch_row_house_01.glb'
const ROW_FILE_SHA256 = '53eb375b50eddb7e1c26ceb4b10d090aafa1f194dc9f2defb5953dec9632b4a8'
/** The townhouse template's facts every compiled townhouse lot carries. */
const TEMPLATE_COLORS: [string, string, string] = ['#c98a6a', '#8a5a42', '#f2b263']

/** The EXACT three, with the exported authored facts each lot had before this slice. */
const TOWNHOUSES: Record<string, { position: [number, number]; door: Facing }> = {
  's1_-1_s2': { position: [98.96, -85.5], door: 'north' },
  's1_-2_s2': { position: [110, -289.5], door: 'north' },
  's2_-1_n4': { position: [264.2, -110.5], door: 'south' },
}
const IDS = Object.keys(TOWNHOUSES)
/** The later commercial slice (issue #60), pinned in commercialMartsContract.test.ts. */
const ISSUE_60_MARTS = ['s1_-1_s1', 's1_-2_s1']
/** The later free-lot commercial slice (issue #61), pinned in commercialBaySupplyContract.test.ts. */
const ISSUE_61_BAY = ['s0_-2_shop']
/** The later issue #63 office projections, pinned in commercialOfficesContract.test.ts. */
const ISSUE_63_OFFICES = ['s1_-1_n1', 's1_-2_n1']
/**
 * The LATER issue #53 archetype-reuse projections, pinned with their authored facts, resolved
 * projections and fit derivations in `archetypeReuseContract.test.ts`: fourteen authored lots drawn by
 * five already-approved rows (shop, garage, row house, apartment, gateway hotel) at their existing
 * calibrations. They add `visual` keys to fourteen placements this slice never touched, so they are
 * excluded here exactly as the other later slices are.
 */
/** The two of them that project THIS row (the rest go on the shop, garage, apartment and hotel rows). */
const ISSUE_53_ROWHOUSE = ['s1_-1_n3', 's1_-2_n3']
const ISSUE_53_REUSE = ['building_market_02', 'building_gate_retail_01', 'building_depot_n1',
  'building_cafe_01', 'building_market_01', 'building_tower_02', 'building_tower_05', 'building_gate_tower_01',
  's1_-1_n2', 's1_-1_n3', 's1_-2_n2', 's1_-2_n3', 's-1_-2_w2', 's-1_-2_w4',
  // Placement closure (2026-09-21), batch 3 of the same programme: the two 11 x 9 backdrop towers on the
  // hotel row, and Book Nook on the shop row at a measured uniform 1.15.
  'building_tower_03', 'building_tower_06', 'building_shop_02', 'building_factory_n1',
  'building_deli_s1', 's-1_-2_w1', 's-1_-2_w3', 's-1_-2_w5']


/**
 * sha256 of BUILDINGS (with ONLY these three lots' `visual` removed) and of PROPS exactly as the
 * delivered 5 x 5 slice `5ef710b8` exported them, captured before this slice's source changed. Any
 * other change to any placement — including the twenty earlier issue #55 mappings — fails here.
 */
const BUILDINGS_WITHOUT_THE_THREE_VISUALS_SHA256 = 'a49a07c520a4c3a9c04f258c5a53ea31cc08f2dc4b2c67a7f4e1f849ff730aef'
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

describe('issue #55 townhouse slice — three compiled townhouse lots on the shipped row-house body', () => {
  it('the row-house body is the shipped file, byte for byte, and its row is unchanged', () => {
    expect(createHash('sha256').update(readFileSync(`public/${ROW_FILE}`)).digest('hex')).toBe(ROW_FILE_SHA256)
    const entry = ASSET_MANIFEST_BY_ID.get(ROW)!
    expect(entry.glbPath).toBe(ROW_FILE)
    expect(entry.enabled).toBe(true)
    expect(entry.fallbackKey).toBe('BuildingMesh')
    expect(entry.scale).toEqual([0.8835, 0.8835, 0.8835])
    expect(entry.rotation).toEqual([0, 0, 0])
    expect(entry.positionOffset).toEqual([0, 0, 0])
    expect(entry.labelHeight).toBe(9.2)
    expect(entry.bounds).toEqual({ width: 6.9612, height: 7.9515, depth: 5.2868 })
    expect(entry.renderedTopY).toBe(7.9515)
    expect(entry.materialSlots).toEqual({})
    expect(entry.variants).toBeUndefined()
    // Its own Wave 3 placement still reaches it through its manifest id, with no projection.
    expect(defFor(ROW).visual, 'the Wave 3 townhomes placement is untouched').toBeUndefined()
  })

  it('keeps every exported authored fact of the three lots', () => {
    for (const [id, want] of Object.entries(TOWNHOUSES)) {
      const def = defFor(id)
      expect(def, `${id} still authored`).toBeTruthy()
      expect(def.position[0], `${id} x`).toBeCloseTo(want.position[0], 9)
      expect(def.position[1], `${id} z`).toBeCloseTo(want.position[1], 9)
      expect(def.size, `${id} authored box`).toEqual([7, 6, 7])
      expect(def.door, `${id} door`).toBe(want.door)
      expect([def.color, def.roofColor, def.accentColor], `${id} fallback colours`).toEqual(TEMPLATE_COLORS)
      expect(def.label, `${id} label`).toBeUndefined()
      expect(def.paletteVariant, `${id} tints nothing`).toBeUndefined()
    }
  })

  it('adds exactly these three mappings: 37 of 73 placements mapped (40 with issues #60 and #61)', () => {
    expect(BUILDINGS.filter((b) => b.visual?.assetId === ROW).map((b) => b.id).sort(), 'projections of the row-house body')
      .toEqual([...IDS, ...ISSUE_53_ROWHOUSE].sort())
    const glbBodies = BUILDINGS.filter((b) => {
      const entry = ASSET_MANIFEST_BY_ID.get(b.visual?.assetId ?? b.id)
      return Boolean(entry?.enabled && entry.glbPath)
    })
    // Mapped placements (own-row bodies + projections), not unique assets and not visual acceptance.
    // This slice made it 37 / 28; issue #60's two Marts (commercialMartsContract.test.ts) and issue #61's
    // Bay Supply (commercialBaySupplyContract.test.ts) add three more.
    // ...and issue #63's two offices (commercialOfficesContract.test.ts) two more.
    expect(glbBodies.length, 'mapped placements').toBe(37 + ISSUE_60_MARTS.length + ISSUE_61_BAY.length + ISSUE_63_OFFICES.length + ISSUE_53_REUSE.length)
    expect(BUILDINGS.filter((b) => b.visual).length, 'visual-projected placements').toBe(28 + ISSUE_60_MARTS.length + ISSUE_61_BAY.length + ISSUE_63_OFFICES.length + ISSUE_53_REUSE.length)
    expect(BUILDINGS.length, 'authored placements').toBe(73)
  })

  it('every other placement — including the twenty earlier issue #55 mappings — and every prop is unchanged', () => {
    const withoutTheThree = BUILDINGS.map((b) => (IDS.includes(b.id) || ISSUE_60_MARTS.includes(b.id) || ISSUE_61_BAY.includes(b.id) || ISSUE_63_OFFICES.includes(b.id) || ISSUE_53_REUSE.includes(b.id)
      ? Object.fromEntries(Object.entries(b).filter(([key]) => key !== 'visual'))
      : b))
    expect({ buildings: sha256(withoutTheThree), props: sha256(PROPS) }, 'delivered 5 x 5 slice export digests').toEqual({
      buildings: BUILDINGS_WITHOUT_THE_THREE_VISUALS_SHA256,
      props: PROPS_SHA256,
    })
  })

  it('projects the body uniformly and facing-only onto each authored door', () => {
    for (const [id, want] of Object.entries(TOWNHOUSES)) {
      const def = defFor(id)
      expect(def.visual, `${id} visual`).toEqual({ assetId: ROW, referenceSize: [7, 6, 7], canonicalFacing: 'south', maxScaleDeviation: 0 })
      const v = resolveBuildingVisual(def)!
      expect(v.scale, `${id} resolved scale`).toEqual([1, 1, 1])
      expect(v.offset, `${id} resolved offset`).toEqual([0, 0, 0])
      expect(v.paletteVariant, `${id} palette`).toBeUndefined()
      expect(Math.sin(v.rotationY), `${id} yaw`).toBeCloseTo(Math.sin(YAW[want.door]), 9)
      expect(Math.cos(v.rotationY), `${id} yaw`).toBeCloseTo(Math.cos(YAW[want.door]), 9)
    }
  })

  it('the rendered body stays inside each 7 x 7 lot after its yaw — measured from the bytes', () => {
    const entry = ASSET_MANIFEST_BY_ID.get(ROW)!
    const { min, max } = glbBounds(ROW_FILE)
    expect(min[1] * entry.scale[1], 'base at the ground').toBeCloseTo(0, 6)
    for (const [id, want] of Object.entries(TOWNHOUSES)) {
      const yaw = YAW[want.door]
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
      expect(halfX, `${id} rendered half-X`).toBeLessThanOrEqual(3.5)
      expect(halfZ, `${id} rendered half-Z`).toBeLessThanOrEqual(3.5)
    }
  })

  it('occlusion keeps the authored footprint and covers the projected 7.95 m roof, not the 6 m box', () => {
    const top = ASSET_MANIFEST_BY_ID.get(ROW)!.renderedTopY!
    for (const id of IDS) {
      const def = defFor(id)
      const occ = getBuildingOccluderDescriptor(def)
      expect(occ.bounds2D, `${id} occluder footprint`).toEqual({
        minX: def.position[0] - 3.5, maxX: def.position[0] + 3.5,
        minZ: def.position[1] - 3.5, maxZ: def.position[1] + 3.5,
      })
      expect(occ.minY, `${id} occluder minY`).toBe(0)
      // The body's rendered top (7.9515 m) is taller than the 6 m box plus its 0.5 m slab.
      expect(top, 'rendered roof above the box').toBeGreaterThan(def.size[1] + 0.5)
      expect(occ.maxY, `${id} occluder maxY is the projected top`).toBeCloseTo(top, 9)
      expect(occ.enabled, `${id} participates in occlusion`).toBe(true)
    }
  })

  it('carries no window-overlay grid, and each townhouse keeps its own overlay seed', () => {
    for (const id of [ROW, ...IDS]) {
      expect(WINDOW_OVERLAYS.filter((o) => o.buildingAssetId === id), `${id} overlays`).toEqual([])
    }
    const seeds = [ROW, ...IDS].map((id) => resolveBuildingVisual(defFor(id))?.overlaySeed ?? id)
    expect(new Set(seeds).size, 'distinct seeds').toBe(4)
  })
})
