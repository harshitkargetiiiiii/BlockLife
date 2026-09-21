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
describe('rooftop plant', () => {
  const industrial = BUILDINGS.filter((b) => resolveFacadeStyle(b) === 'industrial')
  const shops = BUILDINGS.filter((b) => resolveFacadeStyle(b) === 'shop')
  const dressed = [...industrial, ...shops]

  it('covers the industrial and shop lots, and nothing else', () => {
    expect(industrial.length).toBeGreaterThanOrEqual(4)
    expect(shops.length).toBeGreaterThanOrEqual(3)
    for (const def of dressed) {
      expect(computeRoofDetails(def).length, `${def.id} has no rooftop plant`).toBeGreaterThan(0)
    }
    // Towers, houses and plain blocks keep their authored roofs: the towers already carry an
    // antenna, the apartment a water tank, and a house roof is too small to read as plant.
    for (const def of BUILDINGS.filter((b) => !['industrial', 'shop'].includes(resolveFacadeStyle(b)))) {
      expect(computeRoofDetails(def), `${def.id} should keep its authored roof`).toEqual([])
    }
  })

  it('keeps the shop profile quieter than the industrial one', () => {
    for (const def of shops) {
      const boxes = computeRoofDetails(def)
      expect(boxes.length, `${def.id} shop roof`).toBeLessThanOrEqual(2)
      expect(boxes.map((b) => b.role)).toContain('skylight')
    }
  })

  it('is deterministic and bounded', () => {
    for (const def of dressed) {
      const a = computeRoofDetails(def)
      expect(a).toEqual(computeRoofDetails(def))
      expect(a.length).toBeLessThanOrEqual(5)
    }
  })

  it('keeps every box on the slab and under the height ceiling', () => {
    for (const def of dressed) {
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
