// @vitest-environment node
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import * as THREE from 'three'
import { describe, expect, it } from 'vitest'
import { ASSET_MANIFEST_BY_ID } from './assetManifest'
import { BUILDINGS } from '../world/cityLayout'
import { WINDOW_OVERLAYS } from '../world/windowOverlayData'
import { getBuildingOccluderDescriptor } from '../visibility/occluderData'
import { projectedLabelHeight, resolveBuildingVisual } from '../world/buildingProjection'
import { MAX_WORLD_RENDER_HEIGHT } from '../camera/cameraGeometry'
import type { BuildingDef } from '../world/worldTypes'

/**
 * Gateway Offices — the last west-door office lot, drawn by the already-shipped Nook Offices body
 * (`building_office_01` → `arch_office_01.glb`) at a measured UNIFORM 1.04 up-fit.
 *
 * The remaining-lot ledger rejected this lot twice over, and BOTH halves were measurements taken at
 * the wrong scale or transcribed from the wrong body:
 *
 *   1. "2.004 m collider/model gap." True at 1:1 — the body reaches half-X 2.495770 in a 4.5 m
 *      half-lot, which is 2.004230 m of bare lot per side, just over the 1.93 m ceiling this project
 *      measures footprint slack against. A UNIFORM 1.04 brings it to 1.904399, inside the ceiling and
 *      inside the DEFAULT ±15 % projection band, so `maxScaleDeviation` is left unset and no
 *      calibration alias is added.
 *   2. "A west-facing front." That objection belongs to single-elevation bodies. This one is not:
 *      rendered orthographically dead-on to each cardinal (so no adjacent face can leak into frame),
 *      `arch_office_01` carries two glazed storeys with a cornice, spandrel band and plinth on ALL
 *      FOUR elevations, with a modelled door on +z AND on −x. It has no wrong front to point
 *      anywhere — the same "exempt by measurement" status the apartment and hotel rows hold.
 *
 * This file pins the placement on its own because issue #63's contract is written for its two
 * identical [8, 12, 8] sector lots at 1:1, and because the office row differs from the five
 * baked-atlas archetype rows in ways that matter: it has a recolorable `wall` slot, it carries window
 * overlays, and it therefore derives a shared variant-cache key. Mapping intent, not visual
 * acceptance.
 */

type Vec3 = [number, number, number]

const ID = 'building_gate_offices_01'
const ROW = 'building_office_01'
const ROW_FILE = 'assets/models/city/arch_office_01.glb'
const ROW_FILE_SHA256 = 'fb5b709ac0758d32f8a0e3af728c726424c3ae3fa666090a1faafc00e465f624'

/** The authored lot, transcribed BEFORE this change. */
const LOT = { position: [62, -80] as [number, number], size: [9, 11, 8] as Vec3, door: 'west' as const, label: 'Gateway Offices' }
/** The up-fit, and the projection it must resolve to. */
const FIT = 1.04
/** Measured from the shipped bytes; every number below is recomputed, never trusted from here. */
const MEASURED = { halfX: 2.595601, halfZ: 2.641790, top: 9.880285, gapX: 1.904399, gapZ: 1.358210 }
/** The half-extent slack ceiling the shipped apartment placement already accepts, in metres. */
const MAX_HALF_EXTENT_SLACK = 1.93

const defFor = (id: string): BuildingDef => BUILDINGS.find((b) => b.id === id)!

/** Model-local bounds straight out of the GLB's accessor min/max, through the node transforms. */
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

/** World half-extents and top of the rendered body, at a total scale and composed yaw. */
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

describe('Gateway Offices on the shipped office row at a measured 1.04', () => {
  it('draws the shipped row, byte for byte, with its own calibration untouched', () => {
    expect(createHash('sha256').update(readFileSync(`public/${ROW_FILE}`)).digest('hex'), 'row bytes').toBe(ROW_FILE_SHA256)
    const entry = ASSET_MANIFEST_BY_ID.get(ROW)!
    expect(entry.glbPath, 'row path').toBe(ROW_FILE)
    expect(entry.enabled, 'row enabled').toBe(true)
    expect(entry.scale, 'row calibration untouched').toEqual([0.9501, 0.9501, 0.9501])
    expect(entry.rotation, 'row mounted yaw untouched').toEqual([0, 0, 0])
    expect(entry.positionOffset, 'row offset').toEqual([0, 0, 0])
    // No alias row was added for this fit: the office file is served by exactly one manifest entry.
    expect([...ASSET_MANIFEST_BY_ID.values()].filter((e) => e.glbPath === ROW_FILE).map((e) => e.id)).toEqual([ROW])
    // The row's OWN placement stays legacy (id-keyed, no projection).
    expect(defFor(ROW).visual, "Nook Offices' own placement is untouched").toBeUndefined()
  })

  it('keeps every authored fact of the lot', () => {
    const def = defFor(ID)
    expect(def.position, 'position').toEqual(LOT.position)
    expect(def.size, 'authored box').toEqual(LOT.size)
    expect(def.door, 'authored door').toBe(LOT.door)
    expect(def.label, 'label').toBe(LOT.label)
    expect(def.paletteVariant, 'tints nothing').toBeUndefined()
    // The visual is a pure projection: no offset, no palette, no relaxed band.
    expect(def.visual?.assetId, 'body').toBe(ROW)
    expect(def.visual?.canonicalFacing, 'canonical facing').toBe('west')
    expect(def.visual?.maxScaleDeviation, 'uses the DEFAULT band, not a raised one').toBeUndefined()
    expect(def.visual?.visualOffset, 'no offset').toBeUndefined()
    expect(def.visual?.paletteVariant, 'no palette override').toBeUndefined()
  })

  it('resolves a UNIFORM 1.04 inside the default band, and a zero composed yaw', () => {
    const def = defFor(ID)
    // referenceSize is the lot divided by the fit, so the projection resolves exactly [1.04, 1.04, 1.04].
    expect(def.visual!.referenceSize, 'reference box is the lot over the fit')
      .toEqual([LOT.size[0] / FIT, LOT.size[1] / FIT, LOT.size[2] / FIT])
    const v = resolveBuildingVisual(def)!
    for (const axis of v.scale) expect(axis, 'uniform 1.04').toBeCloseTo(FIT, 9)
    expect(Math.max(...v.scale) - Math.min(...v.scale), 'no axis stretched on its own').toBeLessThan(1e-5)
    // Inside the DEFAULT ±15 %: this is what makes an alias unnecessary.
    expect(Math.abs(FIT - 1), 'within the default deviation').toBeLessThanOrEqual(0.15)
    expect(v.offset, 'no offset').toEqual([0, 0, 0])
    expect(v.paletteVariant, 'no palette').toBeUndefined()
    // canonical west onto a west door is a zero yaw, and the row's own mounted yaw is 0.
    const composed = v.rotationY + ASSET_MANIFEST_BY_ID.get(ROW)!.rotation[1]
    expect(Math.sin(composed), 'composed yaw is zero').toBeCloseTo(0, 9)
    expect(Math.cos(composed), 'composed yaw is zero').toBeCloseTo(1, 9)
  })

  it('holds the rendered body inside the lot, grounded, under the camera — measured from the bytes', () => {
    const entry = ASSET_MANIFEST_BY_ID.get(ROW)!
    const v = resolveBuildingVisual(defFor(ID))!
    const total = entry.scale[0] * v.scale[0]
    const composed = v.rotationY + entry.rotation[1]
    const r = reach(total, composed)
    expect(r.base, 'base on the ground').toBeCloseTo(0, 6)
    expect(r.halfX, 'measured half-X').toBeCloseTo(MEASURED.halfX, 5)
    expect(r.halfZ, 'measured half-Z').toBeCloseTo(MEASURED.halfZ, 5)
    expect(r.top, 'measured top').toBeCloseTo(MEASURED.top, 5)
    // Inside the authored footprint, and inside the slack ceiling on BOTH axes.
    const gapX = LOT.size[0] / 2 - r.halfX
    const gapZ = LOT.size[2] / 2 - r.halfZ
    expect(gapX, 'bare lot per side on X').toBeCloseTo(MEASURED.gapX, 5)
    expect(gapZ, 'bare lot per side on Z').toBeCloseTo(MEASURED.gapZ, 5)
    expect(gapX, 'X slack inside the shipped ceiling').toBeLessThanOrEqual(MAX_HALF_EXTENT_SLACK)
    expect(gapZ, 'Z slack inside the shipped ceiling').toBeLessThanOrEqual(MAX_HALF_EXTENT_SLACK)
    expect(gapX, 'body inside the lot on X').toBeGreaterThanOrEqual(0)
    expect(gapZ, 'body inside the lot on Z').toBeGreaterThanOrEqual(0)
    // Under the authored box and under the camera's own clearance limit.
    expect(r.top, 'under the authored box').toBeLessThan(LOT.size[1])
    expect(r.top, 'under the camera clearance limit').toBeLessThan(MAX_WORLD_RENDER_HEIGHT)
    // And the up-fit is what MOVED the X slack inside the ceiling: at 1:1 it does not fit.
    const atOne = reach(entry.scale[0], composed)
    expect(LOT.size[0] / 2 - atOne.halfX, 'the recorded 2.004 m blocker, reproduced at 1:1')
      .toBeCloseTo(2.004230, 5)
    expect(LOT.size[0] / 2 - atOne.halfX, 'which is genuinely over the ceiling')
      .toBeGreaterThan(MAX_HALF_EXTENT_SLACK)
  })

  it('keeps the authored occluder, which stays taller than the body it now draws', () => {
    const def = defFor(ID)
    const occ = getBuildingOccluderDescriptor(def)
    expect(occ.bounds2D, 'occluder footprint is the AUTHORED box, not the model').toEqual({
      minX: def.position[0] - LOT.size[0] / 2, maxX: def.position[0] + LOT.size[0] / 2,
      minZ: def.position[1] - LOT.size[2] / 2, maxZ: def.position[1] + LOT.size[2] / 2,
    })
    expect(occ.minY, 'occluder starts at the ground').toBe(0)
    expect(occ.enabled, 'participates in occlusion').toBe(true)
    // The box plus its roof slab is still the taller of the two, so the fade volume does not change.
    expect(MEASURED.top, 'rendered roof below the box plus slab').toBeLessThan(LOT.size[1] + 0.5)
    expect(occ.maxY, 'occluder maxY is the box plus slab').toBeCloseTo(LOT.size[1] + 0.5, 9)
  })

  it('moves the sign to the row height and states the clearance it actually has', () => {
    const entry = ASSET_MANIFEST_BY_ID.get(ROW)!
    const v = resolveBuildingVisual(defFor(ID))!
    const anchor = projectedLabelHeight(v, entry.labelHeight!)
    // The anchor follows the row, scaled by the same uniform fit.
    expect(anchor, 'anchor is the row height at this fit').toBeCloseTo(entry.labelHeight! * FIT, 9)
    // It clears the rendered roof — but by LESS than a metre, which is the row's own geometry, not
    // this fit's doing: the office body's label sits 0.699726 m above its roof at 1:1, and the up-fit
    // widens that to 0.727715 m. Recorded as measured rather than asserted against a bound this body
    // has never met. A shorter label anchor would be a change to the shipped row, which this
    // placement does not touch.
    const clearance = anchor - MEASURED.top
    expect(clearance, 'clears the rendered roof').toBeGreaterThan(0)
    expect(clearance, 'the measured clearance').toBeCloseTo(0.727715, 5)
    expect(clearance, 'and the up-fit does not reduce it').toBeGreaterThan(entry.labelHeight! - entry.scale[1] * 9.999236106872559)
  })

  it('adds no new variant-cache key and no window-overlay grid of its own', () => {
    // The office row is a SLOTTED body: it shares one tinted material-set across its placements, so a
    // third projection joins the existing key rather than minting one.
    const entry = ASSET_MANIFEST_BY_ID.get(ROW)!
    expect(entry.materialSlots, 'the row keeps its one recolorable slot').toEqual({ wall: ['wall'] })
    expect(defFor(ID).visual?.paletteVariant ?? defFor(ID).paletteVariant, 'no palette, so the shared key').toBeUndefined()
    // Overlays are authored per BODY, not per placement; this mapping adds none.
    expect(WINDOW_OVERLAYS.filter((o) => o.buildingAssetId === ID), 'no overlay keyed to this lot').toEqual([])
    expect(WINDOW_OVERLAYS.filter((o) => o.buildingAssetId === ROW).length, "the row's own two grids are untouched").toBe(2)
  })

  it('is the only lot THIS change maps, alongside the office body\'s other projections', () => {
    // Issue #63's two sector lots at 1:1, this one at 1.04, and the mixed-use tower lot at 1.02
    // (pinned in mixedUseOfficeContract.test.ts). One body, four placements, three calibrations.
    expect(BUILDINGS.filter((b) => b.visual?.assetId === ROW).map((b) => b.id).sort(), 'office-body projections')
      .toEqual(['building_gate_offices_01', 's1_-1_n1', 's1_-2_n1', 's1_-2_s3'])
  })
})
