// @vitest-environment node
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import * as THREE from 'three'
import { describe, expect, it } from 'vitest'
import { ASSET_MANIFEST_BY_ID } from './assetManifest'
import { BUILDINGS } from '../world/cityLayout'
import { getBuildingOccluderDescriptor } from '../visibility/occluderData'
import { resolveBuildingVisual } from '../world/buildingProjection'
import { CAMERA_OFFSET, MAX_WORLD_RENDER_HEIGHT } from '../camera/cameraGeometry'
import type { BuildingDef } from '../world/worldTypes'

/**
 * `s1_-2_s3` — the compiled mixed-use tower lot on Main Street North, drawn by the already-shipped
 * office body (`building_office_01` → `arch_office_01.glb`) at a measured UNIFORM 1.02.
 *
 * This lot was previously rejected on the claim that the shop, garage and office rows were all "far
 * too small" for a [9, 9, 8] box. For the office that was never measured, and it is wrong. Two things
 * make this placement work, and both are asserted below rather than described:
 *
 *   1. **The yaw swaps the axes.** The lot's authored door is NORTH and the row's canonical facing is
 *      west, so the composed yaw is −π/2 and the body's X and Z trade places against the lot. The fit
 *      is therefore computed AFTER the yaw: half-extents 2.590986 / 2.545685 in a 4.5 / 4 half-lot.
 *      At 1:1 that leaves 1.959817 m per side on X — over the 1.93 m ceiling — so the up-fit is
 *      necessary, and 1.02 sits inside the DEFAULT ±15 % band with no alias row and no source edit.
 *   2. **The body is taller than its box, and that is a supported case, not a violation.** Its top is
 *      9.690280, which is 0.690280 above the authored 9 m box and 0.190280 above the box plus its
 *      roof slab, so `getBuildingOccluderDescriptor` raises `maxY` to the RENDERED body. The fade was
 *      captured with the player behind it: the body fades to 0.25 and the player stays visible.
 *
 * Distinct from the rejected apartment candidate for this same lot, which stands 14.9996 m on a 9 m
 * box — a 6 m massing break, not a 0.69 m one. Mapping intent, not visual acceptance.
 */

type Vec3 = [number, number, number]

const ID = 's1_-2_s3'
const ROW = 'building_office_01'
const ROW_FILE = 'assets/models/city/arch_office_01.glb'
const ROW_FILE_SHA256 = 'fb5b709ac0758d32f8a0e3af728c726424c3ae3fa666090a1faafc00e465f624'

/** Authored lot facts, transcribed BEFORE this change. */
const LOT = { position: [135, -288] as [number, number], size: [9, 9, 8] as Vec3, door: 'north' as const }
const FIT = 1.02
/** Recomputed below from the bytes; never trusted from here. */
const MEASURED = { halfX: 2.590986, halfZ: 2.545685, top: 9.690280, gapX: 1.909014, gapZ: 1.454315 }
const MAX_HALF_EXTENT_SLACK = 1.93

const defFor = (id: string): BuildingDef => BUILDINGS.find((b) => b.id === id)!

function glbBounds(path: string): { min: Vec3; max: Vec3 } {
  const buf = readFileSync(`public/${path}`)
  let json: any = null
  for (let o = 12, total = buf.readUInt32LE(8); o < total;) {
    const len = buf.readUInt32LE(o)
    if (buf.readUInt32LE(o + 4) === 0x4e4f534a) json = JSON.parse(buf.subarray(o + 8, o + 8 + len).toString())
    o += 8 + len
  }
  const box = new THREE.Box3()
  const visit = (i: number, parent: THREE.Matrix4): void => {
    const n = json.nodes[i]
    const local = n.matrix
      ? new THREE.Matrix4().fromArray(n.matrix)
      : new THREE.Matrix4().compose(
        new THREE.Vector3(...(n.translation ?? [0, 0, 0])),
        new THREE.Quaternion(...(n.rotation ?? [0, 0, 0, 1])),
        new THREE.Vector3(...(n.scale ?? [1, 1, 1])),
      )
    const world = parent.clone().multiply(local)
    if (n.mesh !== undefined) {
      for (const prim of json.meshes[n.mesh].primitives) {
        const a = json.accessors[prim.attributes.POSITION]
        for (let c = 0; c < 8; c++) {
          box.expandByPoint(new THREE.Vector3(
            c & 1 ? a.max[0] : a.min[0], c & 2 ? a.max[1] : a.min[1], c & 4 ? a.max[2] : a.min[2],
          ).applyMatrix4(world))
        }
      }
    }
    for (const child of n.children ?? []) visit(child, world)
  }
  for (const root of json.scenes[json.scene ?? 0].nodes) visit(root, new THREE.Matrix4())
  return { min: box.min.toArray() as Vec3, max: box.max.toArray() as Vec3 }
}

function reach(total: number, yaw: number): { halfX: number; halfZ: number; top: number; base: number } {
  const { min, max } = glbBounds(ROW_FILE)
  let halfX = 0
  let halfZ = 0
  for (const x of [min[0], max[0]]) {
    for (const z of [min[2], max[2]]) {
      const lx = x * total
      const lz = z * total
      halfX = Math.max(halfX, Math.abs(lx * Math.cos(yaw) + lz * Math.sin(yaw)))
      halfZ = Math.max(halfZ, Math.abs(-lx * Math.sin(yaw) + lz * Math.cos(yaw)))
    }
  }
  return { halfX, halfZ, top: (max[1] - min[1]) * total, base: min[1] * total }
}

const composedYaw = (): number => {
  const v = resolveBuildingVisual(defFor(ID))!
  return v.rotationY + ASSET_MANIFEST_BY_ID.get(ROW)!.rotation[1]
}

describe('the mixed-use tower lot on the shipped office row at a measured 1.02', () => {
  it('draws the shipped row, byte for byte, with no alias and no source edit', () => {
    expect(createHash('sha256').update(readFileSync(`public/${ROW_FILE}`)).digest('hex'), 'row bytes').toBe(ROW_FILE_SHA256)
    const entry = ASSET_MANIFEST_BY_ID.get(ROW)!
    expect(entry.scale, 'row calibration untouched').toEqual([0.9501, 0.9501, 0.9501])
    expect(entry.rotation, 'row mounted yaw untouched').toEqual([0, 0, 0])
    expect([...ASSET_MANIFEST_BY_ID.values()].filter((e) => e.glbPath === ROW_FILE).map((e) => e.id), 'one row per file').toEqual([ROW])
  })

  it('keeps every authored fact of the compiled lot', () => {
    const def = defFor(ID)
    expect(def.position, 'position').toEqual(LOT.position)
    expect(def.size, 'authored box').toEqual(LOT.size)
    expect(def.door, 'authored door').toBe(LOT.door)
    expect(def.paletteVariant, 'tints nothing').toBeUndefined()
    expect(def.visual?.assetId, 'body').toBe(ROW)
    expect(def.visual?.canonicalFacing, 'canonical facing').toBe('west')
    expect(def.visual?.maxScaleDeviation, 'uses the DEFAULT band').toBeUndefined()
    expect(def.visual?.visualOffset, 'no offset').toBeUndefined()
  })

  it('resolves a uniform 1.02 and a composed −π/2 that swaps the axes', () => {
    const def = defFor(ID)
    expect(def.visual!.referenceSize, 'reference box is the lot over the fit')
      .toEqual([LOT.size[0] / FIT, LOT.size[1] / FIT, LOT.size[2] / FIT])
    const v = resolveBuildingVisual(def)!
    for (const axis of v.scale) expect(axis, 'uniform 1.02').toBeCloseTo(FIT, 9)
    expect(Math.max(...v.scale) - Math.min(...v.scale), 'no axis stretched alone').toBeLessThan(1e-5)
    expect(Math.abs(FIT - 1), 'inside the default deviation').toBeLessThanOrEqual(0.15)
    expect(v.offset, 'no offset').toEqual([0, 0, 0])
    const yaw = composedYaw()
    expect(Math.sin(yaw), 'composed yaw is −π/2').toBeCloseTo(-1, 9)
    expect(Math.cos(yaw), 'composed yaw is −π/2').toBeCloseTo(0, 9)
  })

  it('puts the modelled door on the authored door, and glazed elevations at the camera', () => {
    const yaw = composedYaw()
    const rotate = (v: Vec3): THREE.Vector3 =>
      new THREE.Vector3(...v).applyAxisAngle(new THREE.Vector3(0, 1, 0), yaw)
    const cam = new THREE.Vector3(CAMERA_OFFSET[0], 0, CAMERA_OFFSET[2])
    // The body carries a modelled door on its −x elevation. Under this yaw that lands on world NORTH,
    // which is exactly where the lot authors its door — the entrance is drawn where gameplay puts it.
    const modelledDoor = rotate([-1, 0, 0])
    expect(modelledDoor.z, 'the modelled −x door faces world north').toBeCloseTo(-1, 9)
    expect(modelledDoor.dot(cam), 'and is therefore away from the camera, like the authored door').toBeLessThan(0)
    // The two elevations the fixed rig can see are the body's +x and −z, both fully glazed (this body
    // is decorated on all four sides, which is why it carries no facing requirement).
    expect(rotate([1, 0, 0]).dot(cam), 'the +x elevation faces the camera').toBeGreaterThan(0)
    expect(rotate([0, 0, -1]).dot(cam), 'the −z elevation faces the camera').toBeGreaterThan(0)
  })

  it('holds the yawed body inside the lot, grounded — and needs the up-fit to do it', () => {
    const entry = ASSET_MANIFEST_BY_ID.get(ROW)!
    const v = resolveBuildingVisual(defFor(ID))!
    const yaw = composedYaw()
    const r = reach(entry.scale[0] * v.scale[0], yaw)
    expect(r.base, 'base on the ground').toBeCloseTo(0, 6)
    expect(r.halfX, 'measured half-X').toBeCloseTo(MEASURED.halfX, 5)
    expect(r.halfZ, 'measured half-Z').toBeCloseTo(MEASURED.halfZ, 5)
    expect(r.top, 'measured top').toBeCloseTo(MEASURED.top, 5)
    const gapX = LOT.size[0] / 2 - r.halfX
    const gapZ = LOT.size[2] / 2 - r.halfZ
    expect(gapX, 'bare lot per side on X').toBeCloseTo(MEASURED.gapX, 5)
    expect(gapZ, 'bare lot per side on Z').toBeCloseTo(MEASURED.gapZ, 5)
    expect(gapX, 'X slack inside the ceiling').toBeLessThanOrEqual(MAX_HALF_EXTENT_SLACK)
    expect(gapZ, 'Z slack inside the ceiling').toBeLessThanOrEqual(MAX_HALF_EXTENT_SLACK)
    expect(gapX, 'inside the lot on X').toBeGreaterThanOrEqual(0)
    expect(gapZ, 'inside the lot on Z').toBeGreaterThanOrEqual(0)
    // The yaw really does swap the axes: the body is wider across the lot's X than its own X extent.
    const unyawed = reach(entry.scale[0] * v.scale[0], 0)
    expect(r.halfX, 'the yaw puts the model depth on the lot width').toBeCloseTo(unyawed.halfZ, 9)
    expect(r.halfZ, 'and the model width on the lot depth').toBeCloseTo(unyawed.halfX, 9)
    // At 1:1 this lot does NOT fit, which is why the up-fit exists.
    const atOne = reach(entry.scale[0], yaw)
    expect(LOT.size[0] / 2 - atOne.halfX, 'the 1:1 X slack').toBeCloseTo(1.959817, 5)
    expect(LOT.size[0] / 2 - atOne.halfX, 'which is over the ceiling').toBeGreaterThan(MAX_HALF_EXTENT_SLACK)
  })

  it('RAISES the occluder to the rendered body, because the body is genuinely taller than its box', () => {
    const def = defFor(ID)
    const occ = getBuildingOccluderDescriptor(def)
    // Footprint still comes from the authored box, never the model.
    expect(occ.bounds2D, 'occluder footprint is the authored box').toEqual({
      minX: def.position[0] - LOT.size[0] / 2, maxX: def.position[0] + LOT.size[0] / 2,
      minZ: def.position[1] - LOT.size[2] / 2, maxZ: def.position[1] + LOT.size[2] / 2,
    })
    expect(occ.minY, 'starts at the ground').toBe(0)
    expect(occ.enabled, 'participates in occlusion').toBe(true)
    // This is the case the other office placement does NOT exercise: the body out-tops the box.
    expect(MEASURED.top, 'body stands above the authored box').toBeGreaterThan(LOT.size[1])
    expect(MEASURED.top, 'and above the box plus its roof slab').toBeGreaterThan(LOT.size[1] + 0.5)
    // `projectedBodyTop` multiplies the manifest's DECLARED `renderedTopY` by the projection scale,
    // so maxY is 9.5002 x 1.02 = 9.690204 -- not the 9.690280 the bytes measure. The 76 um gap is the
    // manifest's own rounding of a 9.500274 body top, and it is asserted here rather than papered
    // over with a loose tolerance: the occluder follows the DECLARATION, and the declaration is
    // conservative against the geometry by less than a tenth of a millimetre.
    const declared = ASSET_MANIFEST_BY_ID.get(ROW)!.renderedTopY!
    expect(declared, 'the row declares its own rendered top').toBe(9.5002)
    expect(occ.maxY, 'maxY is the DECLARED top through the projection').toBeCloseTo(declared * FIT, 9)
    expect(Math.abs(occ.maxY - MEASURED.top), 'and that sits within 0.1 mm of the measured geometry')
      .toBeLessThan(0.0001)
    expect(occ.maxY, 'either way it is the body, not the box plus slab').toBeGreaterThan(LOT.size[1] + 0.5)
    // Still far under the camera's own clearance limit, so it can never hide the eye.
    expect(occ.maxY, 'under the camera clearance limit').toBeLessThan(MAX_WORLD_RENDER_HEIGHT)
  })

  it('joins the existing office material set rather than minting a new one', () => {
    expect(ASSET_MANIFEST_BY_ID.get(ROW)!.materialSlots, 'the row keeps its one slot').toEqual({ wall: ['wall'] })
    expect(defFor(ID).visual?.paletteVariant ?? defFor(ID).paletteVariant, 'no palette, so the shared key').toBeUndefined()
    expect(BUILDINGS.filter((b) => b.visual?.assetId === ROW).map((b) => b.id).sort(), 'office-body projections')
      .toEqual(['building_gate_offices_01', 's1_-1_n1', 's1_-2_n1', 's1_-2_s3'])
  })
})
