import { describe, expect, it } from 'vitest'
import { computeRoofDetails, MAX_ROOF_DETAIL_HEIGHT } from './roofDetails'
import { resolveFacadeStyle } from './facadeDetails'
import { BUILDINGS } from '../cityLayout'

/**
 * Hybrid dressing v1 — rooftop plant for the industrial lots.
 *
 * These four lots (`windows: false`) had a whole approved body rejected on fit, so their volume
 * stays procedural. The camera sits at `CAMERA_OFFSET [12, 18, 12]` and looks down from 18 m, so a
 * 6.5–8 m warehouse shows its ROOF as the biggest surface on screen — and those roofs were bare
 * slabs. A first pilot dressed the walls instead and was rejected on its own screenshots: three of
 * the four author their door on the west face, which the camera never sees.
 */
describe('industrial rooftop plant', () => {
  const industrial = BUILDINGS.filter((b) => resolveFacadeStyle(b) === 'industrial')

  it('covers every industrial lot and nothing else', () => {
    expect(industrial.length).toBeGreaterThanOrEqual(4)
    for (const def of industrial) {
      expect(computeRoofDetails(def).length, `${def.id} has no rooftop plant`).toBeGreaterThan(0)
    }
    for (const def of BUILDINGS.filter((b) => resolveFacadeStyle(b) !== 'industrial')) {
      expect(computeRoofDetails(def), `${def.id} should keep its authored roof`).toEqual([])
    }
  })

  it('is deterministic and bounded', () => {
    for (const def of industrial) {
      const a = computeRoofDetails(def)
      expect(a).toEqual(computeRoofDetails(def))
      expect(a.length).toBeLessThanOrEqual(5)
    }
  })

  it('keeps every box on the slab and under the height ceiling', () => {
    for (const def of industrial) {
      const [w, , d] = def.size
      for (const box of computeRoofDetails(def)) {
        // Fully inside the roof footprint: nothing may hang over an edge and read as floating.
        expect(Math.abs(box.x) + box.w / 2, `${def.id} overhangs in x`).toBeLessThanOrEqual(w / 2)
        expect(Math.abs(box.z) + box.d / 2, `${def.id} overhangs in z`).toBeLessThanOrEqual(d / 2)
        // Sits ON the slab, and stays low enough not to eat the camera's clearance.
        expect(box.y).toBeGreaterThanOrEqual(0)
        expect(box.y + box.h).toBeLessThanOrEqual(MAX_ROOF_DETAIL_HEIGHT)
      }
    }
  })

  it('reads as plant: housings, a duct run and glazing', () => {
    const roles = computeRoofDetails(industrial[0]).map((b) => b.role)
    expect(roles.filter((r) => r === 'plant').length).toBe(2)
    expect(roles).toContain('duct')
    expect(roles.filter((r) => r === 'skylight').length).toBe(2)
  })
})
