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
import { MAIN_STREET_EAST } from '../world/authoring/sectors/mainStreetEast'
import { MAIN_STREET_NORTH } from '../world/authoring/sectors/mainStreetNorth'
import { CITIZEN_DESTINATIONS, PEDESTRIAN_GRAPH } from '../citizens/destinations/pedestrianDestinations'
import type { BuildingDef } from '../world/worldTypes'

/**
 * Issue #63 — Main St Offices and North Exchange, the two compiled `office_tower` lots that still rendered
 * the procedural box, now drawn by the already-shipped Nook Offices body (`building_office_01` →
 * `arch_office_01.glb`) at its existing uniform 0.9501 calibration. The body's entrance is its model WEST
 * elevation (Wave 0's `wave0-office-entrance-west` capture, reviewed by Main), so the projection declares
 * `canonicalFacing: 'west'` and yaws +π/2 onto each lot's south door. No manifest row, alias, GLB, texture,
 * renderer or compiler change: the existing road-lot `LotAuthoringSpec.visual`. Mapping intent, not
 * visual acceptance.
 */

type Vec3 = [number, number, number]

const ROW = 'building_office_01'
const ROW_FILE = 'assets/models/city/arch_office_01.glb'
const ROW_FILE_SHA256 = 'fb5b709ac0758d32f8a0e3af728c726424c3ae3fa666090a1faafc00e465f624'
/** The office_tower template's facts every compiled office lot carries. */
const TEMPLATE_COLORS: [string, string, string] = ['#7f93ad', '#54637a', '#9fc2ec']
const VISUAL = { assetId: ROW, referenceSize: [8, 12, 8], canonicalFacing: 'west', maxScaleDeviation: 0 }

/** The EXACT two, with the authored facts and front planters each lot had before this slice. */
const OFFICES: Record<string, { position: [number, number]; label: string; localId: string; front: { id: string; position: [number, number] }[] }> = {
  's1_-1_n1': {
    position: [80.6, -112], label: 'Main St Offices', localId: 'n1',
    front: [{ id: 's1_-1_n1_front_0', position: [83.2, -106.5] }, { id: 's1_-1_n1_front_1', position: [78, -106.5] }],
  },
  's1_-2_n1': {
    position: [80, -316], label: 'North Exchange', localId: 'n1',
    front: [{ id: 's1_-2_n1_front_0', position: [82.6, -310.5] }, { id: 's1_-2_n1_front_1', position: [77.4, -310.5] }],
  },
}
const IDS = Object.keys(OFFICES)

/**
 * Digests captured with the PRE-CHANGE compiler and sources at the delivered Bay commit `c6d369bc`,
 * before this slice edited any file (Map → entries array, Set → array; key order as produced):
 * the complete compiled Main Street East / North sectors, global BUILDINGS (these two lots carried no
 * visual) and PROPS as the contracts hash them, the citizen destinations and the pedestrian graph.
 */
const PRE_CHANGE = {
  mainStreetEast: '0b9d298f3845d32e706cca53401817662a0f8bece744acd60dcb23b34db11662',
  mainStreetNorth: '12457be58c195b75c6b27fffce2ae7c59cac662b3a25c5fcca18085e33cd1ffc',
  buildingsWithoutTheTwoVisuals: '618410592b4437a2945dcb3e6be685975b199037096b57cd2cd7e3b271d79fa6',
  props: 'd94702c5e475f075a28e2b7a3b476ac8bc0df42fc9655bfa52ccfdb45732be3b',
  citizenDestinations: '9cdd87b48e7d338a5fdf41404ce0cdf5e612f195b36453390bd60fc9c4caf736',
  pedestrianGraph: '0f7dd3de60cbccf0585465d0c39f1d33b85d64d07133519a0a29c47ae7eed06d',
}
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
  'building_deli_s1', 's-1_-2_w1', 's-1_-2_w3', 's-1_-2_w5']

const defFor = (id: string) => BUILDINGS.find((b) => b.id === id) as BuildingDef
const hash = (text: string) => createHash('sha256').update(text).digest('hex')
const canonical = (value: unknown) => JSON.stringify(value, (_key, v) => v instanceof Map ? [...v.entries()] : v instanceof Set ? [...v] : v)

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

/** The fitted body's footprint corners after the +π/2 yaw, relative to the lot centre (world X, world Z). */
function yawedCorners(): [number, number][] {
  const entry = ASSET_MANIFEST_BY_ID.get(ROW)!
  const { min, max } = glbBounds(ROW_FILE)
  const yaw = Math.PI / 2
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

/**
 * A compiled sector with the office lot's authored and compiled `visual` removed — and, since issue #53
 * later added `visual` keys to the n2 / n3 lots of these same two sectors, those two as well. Nothing
 * else is touched: the s1 / s2 visuals from issues #60 / #55 were already in the pre-change capture, so
 * any OTHER new visual still breaks this digest.
 */
const ISSUE_53_LOCAL_IDS = ['n2', 'n3']
function withoutOfficeVisual(compiled: unknown, buildingId: string, localId: string): string {
  const copy = JSON.parse(canonical(compiled)) as { spec: { lots: { localId: string; visual?: unknown }[] }; buildings: { id: string; visual?: unknown }[] }
  const lot = copy.spec.lots.find((l) => l.localId === localId)!
  const building = copy.buildings.find((b) => b.id === buildingId)!
  expect(lot.visual, `${buildingId} authored visual`).toEqual(VISUAL)
  expect(building.visual, `${buildingId} compiled visual`).toEqual(VISUAL)
  delete lot.visual
  delete building.visual
  // The s1 / s2 lots' visuals (issues #60 / #55) were ALREADY in the pre-change capture and stay.
  const sectorId = buildingId.slice(0, buildingId.lastIndexOf('_'))
  for (const local of ISSUE_53_LOCAL_IDS) {
    const laterLot = copy.spec.lots.find((l) => l.localId === local)!
    const laterBuilding = copy.buildings.find((b) => b.id === `${sectorId}_${local}`)!
    expect(laterLot.visual, `${sectorId}_${local} authored visual`).toBeDefined()
    expect(laterBuilding.visual, `${sectorId}_${local} compiled visual`).toEqual(laterLot.visual)
    delete laterLot.visual
    delete laterBuilding.visual
  }
  return JSON.stringify(copy)
}

describe('issue #63 — Main St Offices and North Exchange on the shipped office body', () => {
  it('the office body is the shipped file, byte for byte, its row is unchanged, and it keeps exactly two overlay grids', () => {
    expect(createHash('sha256').update(readFileSync(`public/${ROW_FILE}`)).digest('hex')).toBe(ROW_FILE_SHA256)
    const entry = ASSET_MANIFEST_BY_ID.get(ROW)!
    expect(entry.glbPath).toBe(ROW_FILE)
    expect(entry.enabled).toBe(true)
    expect(entry.fallbackKey).toBe('BuildingMesh')
    expect(entry.scale).toEqual([0.9501, 0.9501, 0.9501])
    expect(entry.rotation).toEqual([0, 0, 0])
    expect(entry.positionOffset).toEqual([0, 0, 0])
    expect(entry.labelHeight).toBe(10.2)
    expect(entry.renderedTopY).toBe(9.5002)
    expect(entry.materialSlots).toEqual({ wall: ['wall'] })
    expect(entry.variants).toBeUndefined()
    // Issue #64 re-authored the row's two grids onto measured glass panes (pinned and surface-checked in
    // wave0Contract.test.ts); still two definitions with the same facades and seeds.
    expect(WINDOW_OVERLAYS.filter((o) => o.buildingAssetId === ROW).map((o) => [o.facade, o.facadeDistance, o.rows, o.columns, o.seed]), 'the two measured pane grids').toEqual([
      ['east', 2.13, 2, 3, 31],
      ['south', 2.12, 2, 2, 32],
    ])
    const nook = defFor(ROW)
    expect(nook.visual, 'Nook Offices keeps its own row, no projection').toBeUndefined()
    expect([nook.position, nook.size, nook.door, nook.label], 'Nook Offices authored facts').toEqual([[16.5, -1], [7, 9.5, 7], 'west', 'Nook Offices'])
  })

  it('keeps every exported authored fact of the two lots', () => {
    for (const [id, want] of Object.entries(OFFICES)) {
      const def = defFor(id)
      expect(def, `${id} still authored`).toBeTruthy()
      expect(def.position[0], `${id} x`).toBeCloseTo(want.position[0], 9)
      expect(def.position[1], `${id} z`).toBeCloseTo(want.position[1], 9)
      expect(def.size, `${id} authored box`).toEqual([8, 12, 8])
      expect(def.door, `${id} door`).toBe('south')
      expect([def.color, def.roofColor, def.accentColor], `${id} fallback colours`).toEqual(TEMPLATE_COLORS)
      expect(def.label, `${id} label`).toBe(want.label)
      expect(def.labelColor, `${id} label colour`).toBe('#cfe3ff')
      expect(def.paletteVariant, `${id} tints nothing`).toBeUndefined()
    }
  })

  it('adds exactly these two mappings: 33 projections, 42 of 73 placements mapped to a GLB body', () => {
    expect(BUILDINGS.filter((b) => b.visual?.assetId === ROW).map((b) => b.id).sort(), 'projections of the office body').toEqual([...IDS].sort())
    const glbBodies = BUILDINGS.filter((b) => {
      const entry = ASSET_MANIFEST_BY_ID.get(b.visual?.assetId ?? b.id)
      return Boolean(entry?.enabled && entry.glbPath)
    })
    // Mapped placements (own-row bodies + projections), not unique assets and not visual acceptance.
    expect(glbBodies.length, 'mapped placements').toBe(42 + ISSUE_53_REUSE.length)
    expect(BUILDINGS.filter((b) => b.visual).length, 'visual-projected placements').toBe(33 + ISSUE_53_REUSE.length)
    expect(BUILDINGS.length, 'authored placements').toBe(73)
  })

  it('both compiled sectors equal the PRE-CHANGE compiler output with only the office lot visual removed', () => {
    expect(hash(withoutOfficeVisual(MAIN_STREET_EAST, 's1_-1_n1', 'n1')), 'Main Street East vs pre-change').toBe(PRE_CHANGE.mainStreetEast)
    expect(hash(withoutOfficeVisual(MAIN_STREET_NORTH, 's1_-2_n1', 'n1')), 'Main Street North vs pre-change').toBe(PRE_CHANGE.mainStreetNorth)
  })

  it('every other placement, every prop, every destination and the pedestrian graph are unchanged', () => {
    const withoutTheTwo = BUILDINGS.map((b) => (IDS.includes(b.id) || ISSUE_53_REUSE.includes(b.id)
      ? Object.fromEntries(Object.entries(b).filter(([key]) => key !== 'visual'))
      : b))
    expect({
      buildings: hash(JSON.stringify(withoutTheTwo)),
      props: hash(JSON.stringify(PROPS)),
      destinations: hash(canonical(CITIZEN_DESTINATIONS)),
      graph: hash(canonical(PEDESTRIAN_GRAPH)),
    }, 'pre-change export digests').toEqual({
      buildings: PRE_CHANGE.buildingsWithoutTheTwoVisuals,
      props: PRE_CHANGE.props,
      destinations: PRE_CHANGE.citizenDestinations,
      graph: PRE_CHANGE.pedestrianGraph,
    })
  })

  it('projects the body uniformly and facing-only: canonical west onto the south door is +π/2', () => {
    for (const id of IDS) {
      const def = defFor(id)
      expect(def.visual, `${id} visual`).toEqual(VISUAL)
      const v = resolveBuildingVisual(def)!
      expect(v.scale, `${id} resolved scale`).toEqual([1, 1, 1])
      expect(v.offset, `${id} resolved offset`).toEqual([0, 0, 0])
      expect(v.paletteVariant, `${id} palette`).toBeUndefined()
      expect(Math.sin(v.rotationY), `${id} yaw`).toBeCloseTo(1, 9)
      expect(Math.cos(v.rotationY), `${id} yaw`).toBeCloseTo(0, 9)
    }
  })

  it('the rendered body stays inside each 8 x 8 lot after its yaw, grounded — measured from the bytes', () => {
    const entry = ASSET_MANIFEST_BY_ID.get(ROW)!
    const { min } = glbBounds(ROW_FILE)
    expect(min[1] * entry.scale[1], 'base at the ground').toBeCloseTo(0, 6)
    const corners = yawedCorners()
    const halfX = Math.max(...corners.map(([x]) => Math.abs(x)))
    const halfZ = Math.max(...corners.map(([, z]) => Math.abs(z)))
    expect(halfX, 'rendered half-X').toBeLessThanOrEqual(4)
    expect(halfZ, 'rendered half-Z').toBeLessThanOrEqual(4)
    // The under-fill is real: roughly 1.5 m of bare lot on each side of a ~5 m body.
    expect(4 - halfX, 'bare margin X').toBeGreaterThan(1.4)
    expect(4 - halfZ, 'bare margin Z').toBeGreaterThan(1.4)
  })

  it('the preserved street planters stand in front of the rendered entrance, not inside it', () => {
    // South door: the street side is +z. How far the yawed body reaches toward it from the lot centre.
    const reach = Math.max(...yawedCorners().map(([, z]) => z))
    const planterHalf = 0.7 // street_planter visual half-extent (propPlacement.ts), rotation-agnostic
    for (const [id, want] of Object.entries(OFFICES)) {
      expect(PROPS.filter((p) => p.id.startsWith(`${id}_front_`)).map((p) => p.id).sort(), `${id} front details`).toEqual(want.front.map((p) => p.id))
      for (const prop of want.front) {
        const actual = PROPS.find((p) => p.id === prop.id)!
        expect(actual.type, `${prop.id} type`).toBe('street_planter')
        expect(actual.position[0], `${prop.id} x`).toBeCloseTo(prop.position[0], 9)
        expect(actual.position[1], `${prop.id} z`).toBeCloseTo(prop.position[1], 9)
        const out = prop.position[1] - want.position[1]
        expect(out, `${prop.id} is on the street side of the authored box face`).toBeGreaterThan(4)
        expect(out - planterHalf - reach, `${prop.id} clearance in front of the rendered entrance`).toBeGreaterThan(1)
      }
    }
  })

  it('occlusion keeps the authored footprint; the 12.5 m box-plus-slab stays taller than the 9.5 m body', () => {
    const top = ASSET_MANIFEST_BY_ID.get(ROW)!.renderedTopY!
    for (const id of IDS) {
      const def = defFor(id)
      const occ = getBuildingOccluderDescriptor(def)
      expect(occ.bounds2D, `${id} occluder footprint`).toEqual({
        minX: def.position[0] - 4, maxX: def.position[0] + 4,
        minZ: def.position[1] - 4, maxZ: def.position[1] + 4,
      })
      expect(occ.minY, `${id} occluder minY`).toBe(0)
      expect(top, 'rendered roof below the box plus slab').toBeLessThan(def.size[1] + 0.5)
      expect(occ.maxY, `${id} occluder maxY is the box plus slab`).toBeCloseTo(12.5, 9)
      expect(occ.enabled, `${id} participates in occlusion`).toBe(true)
    }
  })

  it('the sign anchor moves from the procedural 13.6 m to the row\'s 10.2 m, 0.7 m above the rendered roof', () => {
    const entry = ASSET_MANIFEST_BY_ID.get(ROW)!
    for (const id of IDS) {
      const def = defFor(id)
      const v = resolveBuildingVisual(def)
      expect(def.size[1] + 1.6, `${id} procedural anchor`).toBeCloseTo(13.6, 9)
      expect(projectedLabelHeight(v, entry.labelHeight!), `${id} model anchor`).toBeCloseTo(10.2, 9)
      expect(projectedLabelHeight(v, entry.labelHeight!) - entry.renderedTopY!, `${id} anchor above the rendered roof`).toBeCloseTo(0.6998, 9)
    }
  })

  it('each office keeps its own per-placement overlay seed, so no two show the same lit-window pattern', () => {
    const base = WINDOW_OVERLAYS.filter((o) => o.buildingAssetId === ROW).map((o) => o.seed)
    // BuildingWindowOverlays: a projected placement renders seed (d.seed ^ overlaySeed) >>> 0 || d.seed;
    // Nook Offices (own row, no projection) keeps the authored seeds.
    const patterns = [base, ...IDS.map((id) => {
      const seed = resolveBuildingVisual(defFor(id))!.overlaySeed
      return base.map((s) => ((s ^ seed) >>> 0) || s)
    })].map((seeds) => seeds.join(','))
    expect(new Set(patterns).size, 'Nook Offices + the two offices show distinct seed sets').toBe(3)
  })
})
