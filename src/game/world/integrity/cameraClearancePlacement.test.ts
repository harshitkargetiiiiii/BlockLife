import { describe, expect, it } from 'vitest'
import { validateCameraClearance } from './placementValidation'
import { validateSectorPlacement } from './sectorPlacementReport'
import { BUILDING_ROOF_EXTRA, buildingMassingTop } from '../buildingMassing'
import { CAMERA_EYE_HEIGHT } from '../../camera/cameraGeometry'
import { BUILDINGS } from '../cityLayout'
import type { Vec3 } from '../worldTypes'

/**
 * Issue #46 §2 — the authoring half of the camera-clearance invariant, on SYNTHETIC data.
 *
 * `cityPlacement.test.ts` asserts the real city has zero placement defects, which is necessary
 * but proves nothing about whether this rule can fire: a gate that never sees a violation is
 * indistinguishable from a gate that cannot detect one. So these cases author a building that
 * reaches the camera on purpose and require the report to name it.
 */
const size = (h: number): Vec3 => [8, h, 8]
const building = (id: string, h: number) => ({ id, position: [0, 0] as [number, number], size: size(h) })

describe('issue #46 §2 — an authored box that reaches the camera is a placement FAILURE', () => {
  it('flags a box whose massing reaches the camera eye, and says by how much', () => {
    // Massing = the authored box plus BuildingMesh's roof slab, so the trigger height is
    // CAMERA_EYE_HEIGHT - BUILDING_ROOF_EXTRA = 17.5.
    const tooTall = CAMERA_EYE_HEIGHT - BUILDING_ROOF_EXTRA + 0.25
    const failure = validateCameraClearance(building('building_synthetic_tower', tooTall))
    expect(failure, 'the rule fires').not.toBeNull()
    expect(failure!.kind).toBe('building_over_camera')
    expect(failure!.entityId).toBe('building_synthetic_tower')
    expect(failure!.reason).toContain('camera eye')
    // `correction` is how far it has to come down.
    expect(failure!.correction).toBeCloseTo(buildingMassingTop(tooTall) - CAMERA_EYE_HEIGHT, 6)
  })

  it('is exact at the boundary — reaching the eye fails, clearing it by a hair passes', () => {
    const exactly = CAMERA_EYE_HEIGHT - BUILDING_ROOF_EXTRA
    expect(validateCameraClearance(building('at_the_eye', exactly)), 'touching counts').not.toBeNull()
    expect(validateCameraClearance(building('just_under', exactly - 0.01))).toBeNull()
  })

  it('surfaces through the sector report, which is what the whole-city gate runs', () => {
    const report = validateSectorPlacement({
      sectorId: 'synthetic',
      buildings: [building('ok_block', 6), building('sky_scraper', CAMERA_EYE_HEIGHT + 4)],
      props: [],
    })
    const kinds = report.failures.map((f) => `${f.kind}:${f.entityId}`)
    expect(kinds, 'the tall one is reported').toContain('building_over_camera:sky_scraper')
    expect(kinds.filter((k) => k.startsWith('building_over_camera'))).toHaveLength(1)
  })

  it('the REAL city passes this rule, and not by a comfortable margin', () => {
    // The gate has to be live on shipped data too — and the fact that the tallest authored body
    // clears the eye by only 0.5 m is why this is worth gating rather than assuming.
    const tallest = Math.max(...BUILDINGS.map((b) => buildingMassingTop(b.size[1])))
    expect(BUILDINGS.every((b) => validateCameraClearance({ id: b.id, size: b.size }) === null)).toBe(true)
    expect(tallest, 'something really is close to the eye').toBeGreaterThan(CAMERA_EYE_HEIGHT - 1)
    expect(tallest, '…and still under it').toBeLessThan(CAMERA_EYE_HEIGHT)
  })
})
