import { describe, expect, it } from 'vitest'
import { BUILDINGS } from '../../world/cityLayout'
import { ASSET_MANIFEST_BY_ID } from '../../assets/assetManifest'
import { resolveBuildingVisual } from '../../world/buildingProjection'
import { BUILDING_ROOF_EXTRA } from '../../world/buildingMassing'
import { getBuildingOccluderDescriptor } from '../occluderData'
import { countBlockedSamples, isMeaningfullyOccluded } from '../occlusionDetection'
import { CAMERA_HORIZONTAL_REACH, CAMERA_OFFSET } from '../../camera/cameraGeometry'
import type { VisibilitySubject } from '../visibilityTypes'

/**
 * Issue #46 §3 — the occluder-height gap, closed and gated.
 *
 * `getBuildingOccluderDescriptor` derived `maxY` from `def.size[1] + ROOF_EXTRA`, so a
 * placement whose GLB renders TALLER than its authored box carried mass the visibility system
 * could not see. The sight line passed over the descriptor's roof while the real facade stood
 * in front of the player, no fade fired, and the player sat hidden behind an opaque wall.
 *
 * Issue #46 asked for an explicit decision between capping projections at the authored box and
 * driving `maxY` from what renders. The decision is the latter (see `occluderData`), and this
 * file is what makes it a contract rather than a comment: it re-derives every placement's
 * rendered top through the same transform chain `Buildings.tsx` applies, asserts the descriptor
 * covers it, and demonstrates the defect concretely on the placement with the largest gap.
 */

/** The rendered top of a placement's GLB body, recomputed here rather than read back. */
function renderedTop(def: (typeof BUILDINGS)[number]): number | null {
  const visual = resolveBuildingVisual(def)
  const entry = ASSET_MANIFEST_BY_ID.get(visual?.assetId ?? def.id)
  if (!entry?.enabled || !entry.glbPath || entry.renderedTopY == null) return null
  return visual ? visual.offset[1] + visual.scale[1] * entry.renderedTopY : entry.renderedTopY
}

/** Placements that render a GLB body, with the box top they were previously measured against. */
const PROJECTED = BUILDINGS.flatMap((def) => {
  const top = renderedTop(def)
  return top == null ? [] : [{ def, top, boxTop: def.size[1] + BUILDING_ROOF_EXTRA }]
})

describe('issue #46 §3 — an occluder covers the body it actually renders', () => {
  it('finds a real, non-trivial set of projected placements', () => {
    expect(PROJECTED.length, 'projected placements under test').toBeGreaterThanOrEqual(9)
    // The whole point is that some render taller than their box. If none did, this gate would
    // be passing vacuously and the next tall body would reopen the hole unnoticed.
    const overBox = PROJECTED.filter((p) => p.top > p.boxTop)
    expect(overBox.length, 'placements rendering above their authored box').toBeGreaterThanOrEqual(4)
  })

  it('every projected placement is occluded to its full rendered height', () => {
    for (const { def, top, boxTop } of PROJECTED) {
      const desc = getBuildingOccluderDescriptor(def)
      expect(desc.maxY, `${def.id} occluder covers its rendered body (${top.toFixed(2)}u)`).toBeGreaterThanOrEqual(top)
      // …and never SHRINKS below the procedural fallback, which is what stands there when the
      // file is missing.
      expect(desc.maxY, `${def.id} occluder still covers its procedural fallback`).toBeGreaterThanOrEqual(boxTop)
      expect(desc.maxY).toBe(Math.max(boxTop, top))
    }
  })

  it('the footprint, the participation rule and the ids are untouched', () => {
    // Only the vertical extent moved. A change to any of these would be a gameplay change:
    // the footprint is the collider/routing authority and participation is certified per
    // district by occlusionParity.
    for (const def of BUILDINGS) {
      const desc = getBuildingOccluderDescriptor(def)
      expect(desc.id).toBe(def.id)
      expect(desc.bounds2D.minX).toBeCloseTo(def.position[0] - def.size[0] / 2, 10)
      expect(desc.bounds2D.maxX).toBeCloseTo(def.position[0] + def.size[0] / 2, 10)
      expect(desc.bounds2D.minZ).toBeCloseTo(def.position[1] - def.size[2] / 2, 10)
      expect(desc.bounds2D.maxZ).toBeCloseTo(def.position[1] + def.size[2] / 2, 10)
      expect(desc.minY).toBe(0)
      expect(desc.enabled).toBe(def.size[1] >= 3.5)
    }
  })

  it('a subject the tall body really hides is now detected — it was not before', () => {
    // building_apartment_01: a 15.0 m body over a 9 x 7.5 x 9 authored box — the largest gap in
    // the city. Stand the subject on the far side so the building lies between it and the
    // camera, far enough out that the sight line ENTERS the footprint above the old 8.0 m
    // descriptor roof. Detection is a range overlap over the whole crossing, so what matters is
    // the height at the near edge, not at the centre: at 15 m the ray enters at ~9.2 m, which
    // the box-derived occluder never saw and the real 15 m facade plainly blocks.
    const def = BUILDINGS.find((b) => b.id === 'building_apartment_01')!
    const desc = getBuildingOccluderDescriptor(def)
    const boxTop = def.size[1] + BUILDING_ROOF_EXTRA
    expect(desc.maxY).toBeCloseTo(14.9996, 4)
    expect(boxTop).toBe(8)

    const gap = 15
    const dir = Math.SQRT1_2
    const subject: VisibilitySubject = {
      id: 'player',
      kind: 'player',
      x: def.position[0] - dir * gap,
      z: def.position[1] - dir * gap,
      groundY: 0,
      radius: 0.36,
      sampleHeights: [0.4, 1.0, 1.7],
      minBlockedSamples: 2,
    }
    const camera = {
      x: subject.x + CAMERA_OFFSET[0],
      y: CAMERA_OFFSET[1],
      z: subject.z + CAMERA_OFFSET[2],
    }
    // The camera really is on the same bearing as the building, at the shipped reach.
    expect(Math.hypot(camera.x - subject.x, camera.z - subject.z)).toBeCloseTo(CAMERA_HORIZONTAL_REACH, 9)

    expect(isMeaningfullyOccluded(camera, subject, desc), 'the 15m body hides this subject').toBe(true)
    expect(countBlockedSamples(camera, subject, desc)).toBe(subject.sampleHeights.length)
    // The SAME geometry against the old box-derived descriptor: nothing blocked at all. This is
    // the defect, reproduced — a player standing behind an opaque 15 m facade with no fade.
    const boxOnly = { ...desc, maxY: boxTop }
    expect(countBlockedSamples(camera, subject, boxOnly), 'the box-derived occluder saw nothing').toBe(0)
    expect(isMeaningfullyOccluded(camera, subject, boxOnly)).toBe(false)
  })

  it('a projected placement reaches its ARCHETYPE manifest row, not its own id', () => {
    // building_house_r1 renders `arch_residential_house_01`; there is no manifest entry named
    // building_house_r1, so a lookup on def.id returned undefined and silently dropped any
    // occlusion override the archetype declares.
    const def = BUILDINGS.find((b) => b.id === 'building_house_r1')!
    expect(ASSET_MANIFEST_BY_ID.has(def.id), 'the placement id is NOT a manifest id').toBe(false)
    expect(resolveBuildingVisual(def)?.assetId).toBe('arch_residential_house_01')
    const desc = getBuildingOccluderDescriptor(def)
    // 0.953 * 2.95 + 2.81 = 5.6214, over a 4.0 + 0.5 box.
    expect(desc.maxY).toBeCloseTo(5.6214, 3)
    expect(desc.maxY).toBeGreaterThan(def.size[1] + BUILDING_ROOF_EXTRA)
  })
})
