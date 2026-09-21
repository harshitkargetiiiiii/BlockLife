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
import { WATERFRONT_GATEWAY, WATERFRONT_GATEWAY_SPEC } from '../world/authoring/sectors/waterfrontGateway'
import { CITIZEN_DESTINATIONS, PEDESTRIAN_GRAPH } from '../citizens/destinations/pedestrianDestinations'
import type { BuildingDef } from '../world/worldTypes'

/**
 * Issue #61 — Bay Supply (`s0_-2_shop`), the Waterfront Gateway `small_shop` free lot that still rendered
 * the procedural box, now drawn by the already-shipped Wave 3 shop body (`building_shop_01` →
 * `arch_shop_01.glb`) at its existing uniform 1.206 calibration. The only production capability added is
 * the optional `FreeLotAuthoringSpec.visual` pass-through (mirroring `LotAuthoringSpec.visual`); no manifest
 * row, alias, GLB, texture or renderer path. Mapping intent, not visual acceptance.
 */

type Vec3 = [number, number, number]

const ROW = 'building_shop_01'
const ROW_FILE = 'assets/models/city/arch_shop_01.glb'
const ROW_FILE_SHA256 = 'fc758a288365afa4450aa78dc03cce7d7936b6456f81ea0cf19b16ca6b0eaf61'
const BAY = 's0_-2_shop'
/** Issue #60's two Marts on the same row, pinned in commercialMartsContract.test.ts. */
const MARTS = ['s1_-1_s1', 's1_-2_s1']
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
  's1_-1_n2', 's1_-1_n3', 's1_-2_n2', 's1_-2_n3', 's-1_-2_w2', 's-1_-2_w4',
  // Placement closure (2026-09-21), batch 3 of the same programme: the two 11 x 9 backdrop towers on the
  // hotel row, and Book Nook on the shop row at a measured uniform 1.15.
  'building_tower_03', 'building_tower_06', 'building_shop_02']
/** The four of them that project the shop row (the depot projects the garage row). */
const ISSUE_53_SHOPS = ['building_market_02', 'building_gate_retail_01', 'building_cafe_01',
  'building_market_01', 's1_-1_n2', 's1_-2_n2', 'building_shop_02']


/**
 * Digests captured with the PRE-CHANGE compiler and sources at the delivered Marts commit `097b440c`,
 * before this slice edited any file (Map → entries array, Set → array; key order as produced).
 *  - the complete compiled Waterfront Gateway (spec, buildings, props, citizens, segments, destinations,
 *    road / water rects, surfaces, lane dashes, walls, lots, junctions, intersections, walk crossings,
 *    source refs, map) — compared here with ONLY `visual` keys dropped;
 *  - global BUILDINGS (Bay's `visual` removed) and PROPS, as the contracts hash them;
 *  - the citizen destinations and the pedestrian graph, unchanged outright.
 */
const PRE_CHANGE = {
  waterfrontGateway: 'fb49252942a9e74b298534f2b4e9fc724b501d43af6197beb5d4f4f96c9fe006',
  buildingsWithoutBayVisual: 'b2599bfdedcb5f5f8906d93fe06b78f339366eba8aad28863074c1c61450848a',
  props: 'd94702c5e475f075a28e2b7a3b476ac8bc0df42fc9655bfa52ccfdb45732be3b',
  citizenDestinations: '9cdd87b48e7d338a5fdf41404ce0cdf5e612f195b36453390bd60fc9c4caf736',
  pedestrianGraph: '0f7dd3de60cbccf0585465d0c39f1d33b85d64d07133519a0a29c47ae7eed06d',
}

const defFor = (id: string) => BUILDINGS.find((b) => b.id === id) as BuildingDef
const hash = (text: string) => createHash('sha256').update(text).digest('hex')
const canonical = (value: unknown, dropVisual = false) => JSON.stringify(value, (key, v) =>
  dropVisual && key === 'visual' ? undefined : v instanceof Map ? [...v.entries()] : v instanceof Set ? [...v] : v)

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

/** The fitted body's footprint corners, yawed onto the north door (yaw π), relative to the lot centre. */
function yawedCorners(): [number, number][] {
  const entry = ASSET_MANIFEST_BY_ID.get(ROW)!
  const { min, max } = glbBounds(ROW_FILE)
  const yaw = Math.PI
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

describe('issue #61 — Bay Supply on the shipped shop body, through a free-lot visual', () => {
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
    expect(defFor(ROW).visual, 'the Wave 3 Mini Mart placement is untouched').toBeUndefined()
  })

  it('keeps every exported authored fact of Bay Supply', () => {
    const def = defFor(BAY)
    expect(def.position).toEqual([28, -289])
    expect(def.size).toEqual([6, 5, 6])
    expect(def.door).toBe('north')
    expect([def.color, def.roofColor, def.accentColor], 'fallback colours').toEqual(['#e3b448', '#a87f2c', '#5f9ea0'])
    expect(def.label).toBe('Bay Supply')
    expect(def.labelColor).toBe('#fff3c9')
    expect(def.paletteVariant, 'tints nothing').toBeUndefined()
  })

  it('adds exactly this one mapping: three shop projections, 31 projections, 40 of 73 mapped', () => {
    expect(BUILDINGS.filter((b) => b.visual?.assetId === ROW).map((b) => b.id).sort(), 'projections of the shop body').toEqual([...MARTS, BAY, ...ISSUE_53_SHOPS].sort())
    const glbBodies = BUILDINGS.filter((b) => {
      const entry = ASSET_MANIFEST_BY_ID.get(b.visual?.assetId ?? b.id)
      return Boolean(entry?.enabled && entry.glbPath)
    })
    // Mapped placements (own-row bodies + projections), not unique assets and not visual acceptance.
    // This slice made it 40 / 31; issue #63's two offices add two more.
    expect(glbBodies.length, 'mapped placements').toBe(40 + ISSUE_63_OFFICES.length + ISSUE_53_REUSE.length)
    expect(BUILDINGS.filter((b) => b.visual).length, 'visual-projected placements').toBe(31 + ISSUE_63_OFFICES.length + ISSUE_53_REUSE.length)
    expect(BUILDINGS.length, 'authored placements').toBe(73)
  })

  it('the compiled Waterfront Gateway equals the PRE-CHANGE compiler output with only Bay\'s visual dropped', () => {
    expect(hash(canonical(WATERFRONT_GATEWAY, true)), 'complete compiled sector vs pre-change baseline').toBe(PRE_CHANGE.waterfrontGateway)
    // ...and the only visual keys in it are Bay Supply's (its authored free lot + its compiled building).
    expect(canonical(WATERFRONT_GATEWAY).match(/"visual"/g)?.length, 'visual keys in the compiled sector').toBe(2)
    expect((WATERFRONT_GATEWAY_SPEC.freeLots ?? []).filter((free) => 'visual' in free).map((free) => free.localId), 'authored free-lot visuals').toEqual(['shop'])
    expect(WATERFRONT_GATEWAY.buildings.filter((b) => 'visual' in b).map((b) => b.id), 'compiled building visuals').toEqual([BAY])
    expect(WATERFRONT_GATEWAY.buildings.find((b) => b.id === BAY)!.visual).toEqual(
      { assetId: ROW, referenceSize: [6, 5, 6], canonicalFacing: 'south', maxScaleDeviation: 0 },
    )
  })

  it('every other placement, every prop, every destination and the pedestrian graph are unchanged', () => {
    const withoutBay = BUILDINGS.map((b) => (b.id === BAY || ISSUE_63_OFFICES.includes(b.id) || ISSUE_53_REUSE.includes(b.id)
      ? Object.fromEntries(Object.entries(b).filter(([key]) => key !== 'visual'))
      : b))
    expect({
      buildings: hash(JSON.stringify(withoutBay)),
      props: hash(JSON.stringify(PROPS)),
      destinations: hash(canonical(CITIZEN_DESTINATIONS)),
      graph: hash(canonical(PEDESTRIAN_GRAPH)),
    }, 'pre-change export digests').toEqual({
      buildings: PRE_CHANGE.buildingsWithoutBayVisual,
      props: PRE_CHANGE.props,
      destinations: PRE_CHANGE.citizenDestinations,
      graph: PRE_CHANGE.pedestrianGraph,
    })
    // Explicitly: the Shorefront Cafe and Pier Kiosk carry no own visual key.
    for (const id of ['s0_-2_cafe', 's0_-2_pavilion']) expect('visual' in defFor(id), `${id} visual key`).toBe(false)
  })

  it('Bay Supply\'s shop destination, arrival point and edges are exactly as before', () => {
    const dest = CITIZEN_DESTINATIONS.find((d) => d.id === 'pdest_s0_-2_shop')!
    expect(dest).toMatchObject({
      sectorId: 's0_-2', kind: 'shop', position: [28, -293.5], arrivalBehavior: 'queue', capacity: 3,
      weatherPolicy: 'indoor_preferred', activeHours: [8, 21],
      sourceRef: { sectorId: 's0_-2', sourceId: BAY, derivation: 'building door anchor' },
    })
    const neighbours = (PEDESTRIAN_GRAPH.adjacency.get('pdest_s0_-2_shop') ?? []).map((n) => n.to).sort()
    expect(neighbours, 'graph edges').toEqual(['pdest_waterfront_view', 'pn_prom_entry'])
  })

  it('projects the body uniformly and facing-only onto the north door', () => {
    const v = resolveBuildingVisual(defFor(BAY))!
    expect(v.assetId).toBe(ROW)
    expect(v.scale).toEqual([1, 1, 1])
    expect(v.offset).toEqual([0, 0, 0])
    expect(v.paletteVariant).toBeUndefined()
    expect(Math.sin(v.rotationY)).toBeCloseTo(0, 9)
    expect(Math.cos(v.rotationY)).toBeCloseTo(-1, 9)
  })

  it('the rendered body stays inside the 6 x 6 lot after its yaw, grounded — measured from the bytes', () => {
    const entry = ASSET_MANIFEST_BY_ID.get(ROW)!
    const { min } = glbBounds(ROW_FILE)
    expect(min[1] * entry.scale[1], 'base at the ground').toBeCloseTo(0, 6)
    const corners = yawedCorners()
    expect(Math.max(...corners.map(([x]) => Math.abs(x))), 'rendered half-X').toBeLessThanOrEqual(3)
    expect(Math.max(...corners.map(([, z]) => Math.abs(z))), 'rendered half-Z').toBeLessThanOrEqual(3)
  })

  it('the preserved signboard and flower pot stand in front of the rendered shopfront, not inside it', () => {
    const want = [
      { id: 's0_-2_shop_front_0', type: 'signboard', position: [30.1, -293.3] },
      { id: 's0_-2_shop_front_1', type: 'flower_pot', position: [25.9, -293.1] },
    ]
    expect(PROPS.filter((p) => p.id.startsWith(`${BAY}_front_`)).map((p) => p.id).sort(), 'exactly the two front details').toEqual(want.map((p) => p.id))
    const def = defFor(BAY)
    // North door: the street side is -z. How far the yawed body reaches toward it from the lot centre.
    const reach = Math.max(...yawedCorners().map(([, z]) => -z))
    for (const prop of want) {
      const actual = PROPS.find((p) => p.id === prop.id)!
      expect(actual.type, `${prop.id} type`).toBe(prop.type)
      expect(actual.position[0], `${prop.id} x`).toBeCloseTo(prop.position[0], 9)
      expect(actual.position[1], `${prop.id} z`).toBeCloseTo(prop.position[1], 9)
      const out = def.position[1] - prop.position[1]
      expect(out, `${prop.id} is on the street side of the authored box face`).toBeGreaterThan(3)
      expect(out - reach, `${prop.id} clearance in front of the rendered shopfront`).toBeGreaterThan(1)
    }
  })

  it('occlusion keeps the authored footprint; the 5.5 m box-plus-slab stays taller than the 4.824 m body', () => {
    const def = defFor(BAY)
    const occ = getBuildingOccluderDescriptor(def)
    expect(occ.bounds2D).toEqual({ minX: 25, maxX: 31, minZ: -292, maxZ: -286 })
    expect(occ.minY).toBe(0)
    expect(ASSET_MANIFEST_BY_ID.get(ROW)!.renderedTopY!).toBeLessThan(def.size[1] + 0.5)
    expect(occ.maxY).toBeCloseTo(5.5, 9)
    expect(occ.enabled).toBe(true)
  })

  it('the sign anchor moves from the procedural 6.6 m to the row\'s 6 m, above the 4.824 m rendered roof', () => {
    const entry = ASSET_MANIFEST_BY_ID.get(ROW)!
    const def = defFor(BAY)
    const v = resolveBuildingVisual(def)
    expect(def.size[1] + 1.6, 'procedural anchor').toBeCloseTo(6.6, 9)
    expect(projectedLabelHeight(v, entry.labelHeight!), 'model anchor').toBeCloseTo(6, 9)
    expect(projectedLabelHeight(v, entry.labelHeight!) - entry.renderedTopY!, 'anchor above the rendered roof').toBeCloseTo(1.176, 9)
  })

  it('carries no window-overlay grid, and Bay keeps its own overlay seed', () => {
    expect(WINDOW_OVERLAYS.filter((o) => o.buildingAssetId === ROW)).toEqual([])
    const seeds = [ROW, ...MARTS, BAY].map((id) => resolveBuildingVisual(defFor(id))?.overlaySeed ?? id)
    expect(new Set(seeds).size, 'distinct seeds').toBe(4)
  })
})
