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
 * Issue #55, next slice — the fifteen 5 x 5 house lots the first slice left procedural.
 *
 * Two already-shipped bodies, no new file:
 *  - the issue #25 terracotta house `arch_residential_house_01` at its existing uniform 2.95 fit;
 *  - the Wave 3 red gable house `arch_house_01.glb` through a calibrated manifest row
 *    `arch_house_01_compact` (uniform 0.865) that points at the SAME file. The 0.9515 row and its
 *    nine 5.5 x 5.5 placements are untouched.
 * Nine lots are handwritten in cityLayout; six are compiled from the Residential East spec, whose
 * lots now pass an optional typed `visual` through `compileLot`.
 *
 * Every projection is facing-only (`maxScaleDeviation: 0`), so no body is stretched on any axis.
 * Mapping coverage is not visual acceptance.
 */

type Facing = 'north' | 'south' | 'east' | 'west'
type Vec3 = [number, number, number]
const YAW: Record<Facing, number> = { south: 0, north: Math.PI, east: Math.PI / 2, west: -Math.PI / 2 }

const TERRACOTTA = 'arch_residential_house_01'
const COMPACT = 'arch_house_01_compact'
const RED_FILE = 'assets/models/city/arch_house_01.glb'
const TERRACOTTA_FILE = 'assets/models/city/arch_residential_house_01.glb'
const SOURCE_SHA256: Record<string, string> = {
  [TERRACOTTA_FILE]: 'c934c1e28951fe5b98fe4c96c1756677db409589beede3e00f79d1d0015d221a',
  [RED_FILE]: 'cf388916e095c4a386a8acb6475c9b3d3cd5000f517ed328f8cf9fa623b419c0',
}

/** The residential_house template's facts every compiled house lot carries. */
const TEMPLATE_COLORS: [string, string, string] = ['#a2c4d0', '#5f8391', '#f2d5a0']

/** The EXACT fifteen, with the authored facts each lot had before this slice. */
const NEXT15: Record<string, { assetId: string; size: Vec3; door: Facing; colors: [string, string, string]; position?: [number, number] }> = {
  building_house_r3: { assetId: TERRACOTTA, position: [2, -54], size: [5, 4.2, 5], door: 'south', colors: ['#a2c4d0', '#5f8391', '#ffd166'] },
  building_house_w1: { assetId: TERRACOTTA, position: [-57, -14], size: [5, 4, 5], door: 'east', colors: ['#d9a5b5', '#96687a', '#f2d5a0'] },
  building_house_w3: { assetId: TERRACOTTA, position: [-57, 4], size: [5, 4.2, 5], door: 'east', colors: ['#d9c39a', '#9b8455', '#8fb8a8'] },
  building_house_s1: { assetId: TERRACOTTA, position: [-20, 41], size: [5, 4, 5], door: 'south', colors: ['#a3b18a', '#6f7d58', '#ffd166'] },
  building_house_s3: { assetId: TERRACOTTA, position: [5, 41], size: [5, 4, 5], door: 'south', colors: ['#a2c4d0', '#5f8391', '#f2d5a0'] },
  building_house_s5: { assetId: TERRACOTTA, position: [-14, 55.5], size: [5, 4, 5], door: 'north', colors: ['#c9a2c4', '#8a5f85', '#bcd0a2'] },
  building_house_s7: { assetId: TERRACOTTA, position: [15, 55.5], size: [5, 4.2, 5], door: 'north', colors: ['#d9a5b5', '#96687a', '#a2c4d0'] },
  's2_-1_n1': { assetId: TERRACOTTA, size: [5, 4, 5], door: 'south', colors: TEMPLATE_COLORS },
  's2_-1_n3': { assetId: TERRACOTTA, size: [5, 4, 5], door: 'south', colors: TEMPLATE_COLORS },
  's2_-1_s2': { assetId: TERRACOTTA, size: [5, 4, 5], door: 'north', colors: TEMPLATE_COLORS },
  building_house_r5: { assetId: COMPACT, position: [-14, -38], size: [5, 4, 5], door: 'north', colors: ['#c9a2c4', '#8a5f85', '#bcd0a2'] },
  building_house_w5: { assetId: COMPACT, position: [-40, -14], size: [5, 4, 5], door: 'west', colors: ['#e8b4a2', '#a5705c', '#bcd0a2'] },
  's2_-1_n2': { assetId: COMPACT, size: [5, 4, 5], door: 'south', colors: TEMPLATE_COLORS },
  's2_-1_s1': { assetId: COMPACT, size: [5, 4, 5], door: 'north', colors: TEMPLATE_COLORS },
  's2_-1_s3': { assetId: COMPACT, size: [5, 4, 5], door: 'north', colors: TEMPLATE_COLORS },
}
const NEXT15_IDS = Object.keys(NEXT15)
/** The first issue #55 slice (PR #57's five). */
const FIRST5 = ['building_house_r4', 'building_house_w4', 'building_house_w6', 'building_house_s4', 'building_house_s6']
const TWENTY = new Set([...FIRST5, ...NEXT15_IDS])
/** The later townhouse slice's three, pinned in residentialTownhouseContract.test.ts. */
const TOWNHOUSE_SLICE = ['s1_-1_s2', 's1_-2_s2', 's2_-1_n4']
/** The later commercial slice's two Marts (issue #60), pinned in commercialMartsContract.test.ts. */
const ISSUE_60_MARTS = ['s1_-1_s1', 's1_-2_s1']
/** The later free-lot commercial slice's Bay Supply (issue #61), pinned in commercialBaySupplyContract.test.ts. */
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
const ISSUE_53_REUSE = ['building_market_02', 'building_gate_retail_01', 'building_depot_n1',
  'building_cafe_01', 'building_market_01', 'building_tower_02', 'building_tower_05', 'building_gate_tower_01',
  's1_-1_n2', 's1_-1_n3', 's1_-2_n2', 's1_-2_n3', 's-1_-2_w2', 's-1_-2_w4',
  // Placement closure (2026-09-21), batch 3 of the same programme: the two 11 x 9 backdrop towers on the
  // hotel row, and Book Nook on the shop row at a measured uniform 1.15.
  'building_tower_03', 'building_tower_06', 'building_shop_02', 'building_factory_n1',
  'building_deli_s1', 's-1_-2_w1', 's-1_-2_w3', 's-1_-2_w5',
  'building_gate_offices_01', 's1_-2_s3']


/** Every placement that master (d81d73dd) already projected through BuildingDef.visual. */
const MASTER_MAPPED: string[] = ['building_house_01', 'building_house_r1', 'building_house_r2', 'building_house_s2', 'building_house_w2']
/** Placements master already rendered as a GLB body through their OWN manifest row. */
const OWN_ROW_BODIES = [
  'building_apartment_01', 'building_garage_01', 'building_gate_hotel_01', 'building_gate_tower_02', 'building_gym_01',
  'building_office_01', 'building_shop_01', 'building_tower_01', 'building_townhomes_01',
]

/**
 * sha256 of BUILDINGS / PROPS exactly as master exported them, captured before this slice's source
 * changed (the first slice only added visuals). BUILDINGS is hashed with ONLY the twenty lots'
 * `visual` removed, so any other change to any placement fails here.
 */
const BUILDINGS_WITHOUT_THE_TWENTY_VISUALS_SHA256 = '14c2435fa389207510d1e1411abf69bebf2a8c9e00cefc7667c831cdc08f8f56'
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

describe('issue #55 next slice — fifteen 5 x 5 house lots on two existing bodies', () => {
  it('both bodies are the approved source files, byte for byte', () => {
    for (const [file, want] of Object.entries(SOURCE_SHA256)) {
      expect(createHash('sha256').update(readFileSync(`public/${file}`)).digest('hex'), file).toBe(want)
    }
  })

  it('adds exactly twenty house mappings relative to master (plus the townhouse slice\'s three, pinned separately)', () => {
    const mapped = BUILDINGS.filter((b) => b.visual).map((b) => b.id).sort()
    // A placement renders an approved GLB body either through its own enabled manifest row or through
    // a BuildingDef.visual projection of one; both count as a mapped placement.
    const glbBodies = BUILDINGS.filter((b) => {
      const entry = ASSET_MANIFEST_BY_ID.get(b.visual?.assetId ?? b.id)
      return Boolean(entry?.enabled && entry.glbPath)
    }).map((b) => b.id).sort()
    expect(glbBodies.filter((id) => !mapped.includes(id)), 'own-row GLB bodies, exactly as on master').toEqual(OWN_ROW_BODIES)
    expect(mapped.length, 'visual-projected placements (master\'s 5 + these 20 + the townhouse slice\'s 3 + issue #60\'s 2 + issue #61\'s 1 + issue #63\'s 2 + issue #53\'s 5)').toBe(33 + ISSUE_53_REUSE.length)
    expect(mapped.filter((id) => !MASTER_MAPPED.includes(id)), 'added since master').toEqual([...TWENTY, ...TOWNHOUSE_SLICE, ...ISSUE_60_MARTS, ...ISSUE_61_BAY, ...ISSUE_63_OFFICES, ...ISSUE_53_REUSE].sort())
    expect(MASTER_MAPPED.filter((id) => !mapped.includes(id)), 'nothing master mapped was dropped').toEqual([])
    expect(glbBodies.length, 'mapped placements (own-row + projected GLB bodies)').toBe(42 + ISSUE_53_REUSE.length)
    expect(BUILDINGS.length, 'authored placements').toBe(73)
    // Mapped placements, not unique assets and not visual acceptance.
    const byAsset = (assetId: string) => BUILDINGS.filter((b) => b.visual?.assetId === assetId).map((b) => b.id).sort()
    expect(byAsset(TERRACOTTA)).toEqual(['building_house_r1', ...NEXT15_IDS.filter((id) => NEXT15[id].assetId === TERRACOTTA)].sort())
    expect(byAsset(COMPACT)).toEqual(NEXT15_IDS.filter((id) => NEXT15[id].assetId === COMPACT).sort())
    expect(byAsset('arch_house_01')).toEqual(
      ['building_house_01', 'building_house_r2', 'building_house_s2', 'building_house_w2', ...FIRST5].sort(),
    )
  })

  it('every other placement — and every prop — is exactly what master exported', () => {
    const withoutTheTwenty = BUILDINGS.map((b) => (TWENTY.has(b.id) || TOWNHOUSE_SLICE.includes(b.id) || ISSUE_60_MARTS.includes(b.id) || ISSUE_61_BAY.includes(b.id) || ISSUE_63_OFFICES.includes(b.id) || ISSUE_53_REUSE.includes(b.id)
      ? Object.fromEntries(Object.entries(b).filter(([key]) => key !== 'visual'))
      : b))
    expect({ buildings: sha256(withoutTheTwenty), props: sha256(PROPS) }, 'master export digests').toEqual({
      buildings: BUILDINGS_WITHOUT_THE_TWENTY_VISUALS_SHA256,
      props: PROPS_SHA256,
    })
  })

  it('keeps every gameplay-facing authored fact of the fifteen lots', () => {
    for (const [id, want] of Object.entries(NEXT15)) {
      const def = defFor(id)
      expect(def, `${id} still authored`).toBeTruthy()
      if (want.position) expect(def.position, `${id} position`).toEqual(want.position)
      expect(def.size, `${id} authored box`).toEqual(want.size)
      expect(def.door, `${id} door`).toBe(want.door)
      expect([def.color, def.roofColor, def.accentColor], `${id} fallback colours`).toEqual(want.colors)
      expect(def.label, `${id} label`).toBeUndefined()
      expect(def.paletteVariant, `${id} tints nothing`).toBeUndefined()
    }
  })

  it('projects each body uniformly and facing-only onto its authored door', () => {
    for (const [id, want] of Object.entries(NEXT15)) {
      const def = defFor(id)
      expect(def.visual, `${id} visual`).toEqual({
        assetId: want.assetId, referenceSize: [5, 4, 5], canonicalFacing: 'south', maxScaleDeviation: 0,
      })
      const v = resolveBuildingVisual(def)!
      // maxScaleDeviation 0: the 4.2 m lots do not stretch the body on Y.
      expect(v.scale, `${id} resolved scale`).toEqual([1, 1, 1])
      expect(v.offset, `${id} resolved offset`).toEqual([0, 0, 0])
      expect(v.paletteVariant, `${id} palette`).toBeUndefined()
      expect(Math.sin(v.rotationY), `${id} yaw`).toBeCloseTo(Math.sin(YAW[want.door]), 9)
      expect(Math.cos(v.rotationY), `${id} yaw`).toBeCloseTo(Math.cos(YAW[want.door]), 9)
      const entry = ASSET_MANIFEST_BY_ID.get(want.assetId)!
      expect(entry.scale[0], `${id} ${want.assetId} is uniform`).toBe(entry.scale[1])
      expect(entry.scale[2], `${id} ${want.assetId} is uniform`).toBe(entry.scale[1])
      expect(entry.rotation, `${want.assetId} rotation`).toEqual([0, 0, 0])
    }
  })

  it('each rendered body stays inside its 5 x 5 lot after its yaw — measured from the bytes', () => {
    const measured = new Map<string, { min: Vec3; max: Vec3 }>()
    for (const [id, want] of Object.entries(NEXT15)) {
      const entry = ASSET_MANIFEST_BY_ID.get(want.assetId)!
      if (!measured.has(entry.glbPath!)) measured.set(entry.glbPath!, glbBounds(entry.glbPath!))
      const { min, max } = measured.get(entry.glbPath!)!
      const yaw = YAW[want.door]
      let halfX = 0
      let halfZ = 0
      for (const x of [min[0], max[0]]) {
        for (const z of [min[2], max[2]]) {
          const lx = x * entry.scale[0] + entry.positionOffset[0]
          const lz = z * entry.scale[2] + entry.positionOffset[2]
          halfX = Math.max(halfX, Math.abs(lx * Math.cos(yaw) + lz * Math.sin(yaw)))
          halfZ = Math.max(halfZ, Math.abs(-lx * Math.sin(yaw) + lz * Math.cos(yaw)))
        }
      }
      expect(halfX, `${id} rendered half-X`).toBeLessThanOrEqual(want.size[0] / 2)
      expect(halfZ, `${id} rendered half-Z`).toBeLessThanOrEqual(want.size[2] / 2)
    }
  })

  it('the compact row is a calibration of the SAME red-house file — the 0.9515 row is untouched', () => {
    const compact = ASSET_MANIFEST_BY_ID.get(COMPACT)!
    const original = ASSET_MANIFEST_BY_ID.get('arch_house_01')!
    expect(compact.glbPath, 'same file, not a copy').toBe(RED_FILE)
    expect(original.glbPath).toBe(RED_FILE)
    expect(compact.enabled).toBe(true)
    expect(compact.category).toBe('city')
    expect(compact.fallbackKey).toBe('BuildingMesh')
    expect(compact.scale).toEqual([0.865, 0.865, 0.865])
    expect(compact.positionOffset).toEqual([0, 0, 0])
    expect(compact.materialSlots).toEqual({})
    expect(compact.variants).toBeUndefined()
    const { min, max } = glbBounds(RED_FILE)
    const size = [max[0] - min[0], max[1] - min[1], max[2] - min[2]]
    expect(compact.bounds!.width).toBeCloseTo(size[0] * 0.865, 3)
    expect(compact.bounds!.height).toBeCloseTo(size[1] * 0.865, 3)
    expect(compact.bounds!.depth).toBeCloseTo(size[2] * 0.865, 3)
    expect(compact.renderedTopY!).toBeCloseTo(max[1] * 0.865, 3)
    // Wave 3's row, and therefore its nine 5.5 x 5.5 placements, exactly as shipped.
    expect(original.scale).toEqual([0.9515, 0.9515, 0.9515])
    expect(original.bounds).toEqual({ width: 5.4935, height: 4.757, depth: 5.0635 })
    expect(original.renderedTopY).toBe(4.757)
    // The terracotta row keeps its issue #25 calibration.
    const terracotta = ASSET_MANIFEST_BY_ID.get(TERRACOTTA)!
    expect(terracotta.glbPath).toBe(TERRACOTTA_FILE)
    expect(terracotta.scale).toEqual([2.95, 2.95, 2.95])
    expect(terracotta.positionOffset).toEqual([0, 2.81, 0])
    expect(terracotta.renderedTopY).toBe(5.6214)
    expect(defFor('building_house_r1').visual, 'r1 keeps its own projection').toEqual({
      assetId: TERRACOTTA, referenceSize: [5, 4, 5], canonicalFacing: 'south',
    })
  })

  it('the occluder keeps the authored footprint and covers whichever is taller, box or body', () => {
    for (const [id, want] of Object.entries(NEXT15)) {
      const def = defFor(id)
      const occ = getBuildingOccluderDescriptor(def)
      const [w, h, d] = want.size
      expect(occ.bounds2D, `${id} occluder footprint`).toEqual({
        minX: def.position[0] - w / 2, maxX: def.position[0] + w / 2,
        minZ: def.position[1] - d / 2, maxZ: def.position[1] + d / 2,
      })
      expect(occ.minY, `${id} occluder minY`).toBe(0)
      const top = ASSET_MANIFEST_BY_ID.get(want.assetId)!.renderedTopY!
      expect(occ.maxY, `${id} occluder maxY`).toBeCloseTo(Math.max(h + 0.5, top), 9)
      expect(occ.enabled, `${id} participates in occlusion`).toBe(true)
    }
  })

  it('carries no window-overlay grid, and every reused house keeps its own overlay seed', () => {
    for (const assetId of [TERRACOTTA, COMPACT, ...NEXT15_IDS]) {
      expect(WINDOW_OVERLAYS.filter((o) => o.buildingAssetId === assetId), `${assetId} overlays`).toEqual([])
    }
    const houses = BUILDINGS.filter((b) => [TERRACOTTA, COMPACT, 'arch_house_01'].includes(b.visual?.assetId ?? ''))
    const seeds = houses.map((b) => resolveBuildingVisual(b)!.overlaySeed)
    expect(new Set(seeds).size, 'distinct per-placement seeds').toBe(houses.length)
  })
})
