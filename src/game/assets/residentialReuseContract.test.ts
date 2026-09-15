// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { ASSET_MANIFEST_BY_ID } from './assetManifest'
import { BUILDINGS } from '../world/cityLayout'
import { WINDOW_OVERLAYS } from '../world/windowOverlayData'
import { getBuildingOccluderDescriptor } from '../visibility/occluderData'
import { resolveBuildingVisual } from '../world/buildingProjection'
import type { BuildingDef } from '../world/worldTypes'

/**
 * Issue #55 — reuse the approved `arch_house_01` detached-house archetype on FIVE more authored
 * residential lots that already share its exact 5.5 x 5.5 footprint.
 *
 * This is an expansion of an existing mapping, not a new intake: no GLB, texture, manifest row or
 * renderer is added, and the archetype's calibration (uniform 0.9515, measured +z front) is the one
 * Wave 3 shipped. Wave 3's own four placements stay pinned by `wave3Contract.test.ts`; this file
 * pins the five new ones, the union, and everything that must NOT have moved.
 *
 * The 5 x 5 lots are deliberately excluded: fitting this 5.5 m body into them would need a second
 * correctly fitted size class, which is a later slice, not a copied constant.
 */

type Facing = 'north' | 'south' | 'east' | 'west'

/** Wave 3's initial placements (issue #44). */
const WAVE3_HOUSES = ['building_house_01', 'building_house_r2', 'building_house_s2', 'building_house_w2']

/** The EXACT issue #55 expansion, with the authored facts each lot had before it. */
const ISSUE55_REUSE: Record<string, {
  position: [number, number]
  size: [number, number, number]
  door: Facing
  colors: [string, string, string]
  yaw: number
}> = {
  building_house_r4: { position: [10, -54.5], size: [5.5, 4, 5.5], door: 'south', colors: ['#d9c39a', '#9b8455', '#8fb8a8'], yaw: 0 },
  building_house_w4: { position: [-57, 13], size: [5.5, 4, 5.5], door: 'east', colors: ['#bcd0a2', '#7d9460', '#ffd166'], yaw: Math.PI / 2 },
  building_house_w6: { position: [-40, 14], size: [5.5, 4.3, 5.5], door: 'west', colors: ['#c9a2c4', '#8a5f85', '#e8c9e4'], yaw: -Math.PI / 2 },
  building_house_s4: { position: [14, 41], size: [5.5, 4.5, 5.5], door: 'south', colors: ['#d9c39a', '#9b8455', '#e07a5f'], yaw: 0 },
  building_house_s6: { position: [-5, 55.5], size: [5.5, 4, 5.5], door: 'north', colors: ['#bcd0a2', '#7d9460', '#d9825f'], yaw: Math.PI },
}
const IDS = Object.keys(ISSUE55_REUSE)

const defFor = (id: string) => BUILDINGS.find((b) => b.id === id) as BuildingDef

describe('issue #55 — approved house archetype reused on five more 5.5 x 5.5 lots', () => {
  it('maps EXACTLY these five, and the archetype backs Wave 3\'s four plus these five — nothing else', () => {
    const mapped = BUILDINGS.filter((b) => resolveBuildingVisual(b)?.assetId === 'arch_house_01').map((b) => b.id).sort()
    expect(mapped).toEqual([...WAVE3_HOUSES, ...IDS].sort())
    // A reusable ARCHETYPE and an authored PLACEMENT must never share an id.
    expect(BUILDINGS.some((b) => b.id === 'arch_house_01'), 'archetype is not a placement').toBe(false)
  })

  it('leaves every other house lot as it was — the 5 x 5 lots need their own fit class', () => {
    expect(defFor('building_house_r1').visual?.assetId, 'issue #25 archetype preserved').toBe('arch_residential_house_01')
    const others = BUILDINGS.filter((b) => b.id.startsWith('building_house_')
      && ![...WAVE3_HOUSES, ...IDS, 'building_house_r1'].includes(b.id))
    expect(others.length, 'there really are unmapped house lots left').toBeGreaterThan(0)
    for (const def of others) {
      expect(def.visual, `${def.id} stays procedural in this slice`).toBeUndefined()
      // None of them could take this body unchanged: they are not 5.5 x 5.5.
      expect([def.size[0], def.size[2]], `${def.id} footprint`).not.toEqual([5.5, 5.5])
    }
  })

  it('keeps every gameplay-facing authored fact of the five lots untouched', () => {
    for (const [id, want] of Object.entries(ISSUE55_REUSE)) {
      const def = defFor(id)
      expect(def, `${id} still authored`).toBeTruthy()
      expect(def.position, `${id} position`).toEqual(want.position)
      expect(def.size, `${id} authored box`).toEqual(want.size)
      expect(def.door, `${id} door`).toBe(want.door)
      // The procedural fallback's look is part of the failure path, so its colours are pinned too.
      expect([def.color, def.roofColor, def.accentColor], `${id} fallback colours`).toEqual(want.colors)
      expect(def.label, `${id} label`).toBeUndefined()
      expect(def.labelColor, `${id} label colour`).toBeUndefined()
      expect(def.windows, `${id} windows flag`).toBeUndefined()
      expect(def.paletteVariant, `${id} tints nothing`).toBeUndefined()
    }
  })

  it('projects facing-only with Wave 3\'s calibration: uniform body, door yaw, no offset or tint', () => {
    const entry = ASSET_MANIFEST_BY_ID.get('arch_house_01')!
    // The archetype row itself is unchanged by this expansion.
    expect(entry.enabled).toBe(true)
    expect(entry.glbPath).toBe('assets/models/city/arch_house_01.glb')
    expect(entry.fallbackKey).toBe('BuildingMesh')
    expect(entry.scale).toEqual([0.9515, 0.9515, 0.9515])
    expect(entry.bounds).toEqual({ width: 5.4935, height: 4.757, depth: 5.0635 })
    expect(entry.renderedTopY).toBe(4.757)
    expect(entry.materialSlots).toEqual({})
    expect(entry.variants).toBeUndefined()

    for (const [id, want] of Object.entries(ISSUE55_REUSE)) {
      const def = defFor(id)
      expect(def.visual, `${id} visual`).toEqual({
        assetId: 'arch_house_01', referenceSize: [5.5, 4.5, 5.5], canonicalFacing: 'south', maxScaleDeviation: 0,
      })
      const v = resolveBuildingVisual(def)!
      // `maxScaleDeviation: 0` is what stops lots authored at 4.0 / 4.3 m from squashing the body on Y.
      expect(v.scale, `${id} resolved scale`).toEqual([1, 1, 1])
      expect(v.offset, `${id} resolved offset`).toEqual([0, 0, 0])
      expect(v.paletteVariant, `${id} palette`).toBeUndefined()
      expect(Math.sin(v.rotationY), `${id} yaw`).toBeCloseTo(Math.sin(want.yaw), 9)
      expect(Math.cos(v.rotationY), `${id} yaw`).toBeCloseTo(Math.cos(want.yaw), 9)
    }
  })

  it('the rendered body stays inside every authored lot after its yaw', () => {
    const { width, depth } = ASSET_MANIFEST_BY_ID.get('arch_house_01')!.bounds!
    for (const [id, want] of Object.entries(ISSUE55_REUSE)) {
      const swapped = Math.abs(Math.sin(want.yaw)) > 0.5
      const halfX = (swapped ? depth : width) / 2
      const halfZ = (swapped ? width : depth) / 2
      expect(halfX, `${id} rendered half-X`).toBeLessThanOrEqual(want.size[0] / 2)
      expect(halfZ, `${id} rendered half-Z`).toBeLessThanOrEqual(want.size[2] / 2)
    }
  })

  it('the occluder keeps the authored footprint and covers whichever is taller, box or body', () => {
    const top = ASSET_MANIFEST_BY_ID.get('arch_house_01')!.renderedTopY!
    for (const [id, want] of Object.entries(ISSUE55_REUSE)) {
      const occ = getBuildingOccluderDescriptor(defFor(id))
      const [w, h, d] = want.size
      expect(occ.bounds2D, `${id} occluder footprint`).toEqual({
        minX: want.position[0] - w / 2, maxX: want.position[0] + w / 2,
        minZ: want.position[1] - d / 2, maxZ: want.position[1] + d / 2,
      })
      expect(occ.minY, `${id} occluder minY`).toBe(0)
      // The body renders 4.757 m whatever the lot's authored height; a 4.0 m lot's procedural box
      // (4.5 m with its roof slab) is shorter than that, so detection must see the body.
      expect(occ.maxY, `${id} occluder maxY`).toBeCloseTo(Math.max(h + 0.5, top), 9)
      expect(occ.fadeMode, `${id} fade mode`).toBe('wholeObject')
      expect(occ.enabled, `${id} participates in occlusion`).toBe(true)
    }
  })

  it('carries no window-overlay grid, and every reused placement keeps its own overlay seed', () => {
    for (const id of IDS) {
      expect(WINDOW_OVERLAYS.filter((o) => o.buildingAssetId === id), `${id} overlays`).toEqual([])
    }
    expect(WINDOW_OVERLAYS.filter((o) => o.buildingAssetId === 'arch_house_01'), 'archetype overlays').toEqual([])
    const seeds = [...WAVE3_HOUSES, ...IDS].map((id) => resolveBuildingVisual(defFor(id))!.overlaySeed)
    expect(new Set(seeds).size, 'distinct per-placement seeds across all nine').toBe(9)
  })
})
