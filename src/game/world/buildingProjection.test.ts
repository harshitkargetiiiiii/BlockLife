import { describe, expect, it } from 'vitest'
import { projectedLabelHeight, resolveBuildingVisual } from './buildingProjection'
import type { BuildingDef } from './worldTypes'

/**
 * Issue #25: the reusable-archetype visual projection MATH. Proves per-facing rotation,
 * clamped fit, offset, deterministic per-building seed, and that a legacy (no-visual)
 * building resolves to `undefined` (renders exactly as before). Render-time alignment of
 * the GLB + overlays + label is covered by the projection E2E once the archetype GLB is
 * enabled; these lock the pure resolution.
 */

const base = (over: Partial<BuildingDef>): BuildingDef => ({
  id: 'b',
  position: [0, 0],
  size: [5, 4, 5],
  color: '#ffffff',
  roofColor: '#888888',
  ...over,
})

const ARCH = { assetId: 'arch_residential_house_01', referenceSize: [5, 4, 5] as [number, number, number] }

describe('resolveBuildingVisual', () => {
  it('returns undefined for a legacy (no visual) building', () => {
    expect(resolveBuildingVisual(base({}))).toBeUndefined()
  })

  it('exact footprint + south door → identity rotation and unit scale', () => {
    const v = resolveBuildingVisual(base({ door: 'south', visual: { ...ARCH } }))!
    expect(v.assetId).toBe('arch_residential_house_01')
    expect(v.rotationY).toBe(0)
    expect(v.scale).toEqual([1, 1, 1])
    expect(v.offset).toEqual([0, 0, 0])
  })

  it('derives per-facing rotation from the authored door (canonical +z / south)', () => {
    const yaw = (door: BuildingDef['door']) =>
      resolveBuildingVisual(base({ door, visual: { ...ARCH } }))!.rotationY
    expect(yaw('south')).toBe(0)
    expect(yaw('north')).toBeCloseTo(Math.PI)
    expect(yaw('east')).toBeCloseTo(Math.PI / 2)
    expect(yaw('west')).toBeCloseTo(-Math.PI / 2)
  })

  it('honors a non-default canonicalFacing (model authored facing east)', () => {
    // Model front = +x (east). Placed with a north door → rotate by (north - east).
    const v = resolveBuildingVisual(
      base({ door: 'north', visual: { ...ARCH, canonicalFacing: 'east' } }),
    )!
    expect(v.rotationY).toBeCloseTo(Math.PI - Math.PI / 2)
  })

  it('scales to fit within the ±15% tolerance', () => {
    const v = resolveBuildingVisual(base({ size: [5.5, 4.4, 5.5], visual: { ...ARCH } }))!
    expect(v.scale[0]).toBeCloseTo(1.1)
    expect(v.scale[1]).toBeCloseTo(1.1)
  })

  it('clamps an over-large placement to the tolerance (documented fit, no runaway distortion)', () => {
    const v = resolveBuildingVisual(base({ size: [10, 4, 5], visual: { ...ARCH } }))!
    expect(v.scale[0]).toBeCloseTo(1.15) // 10/5 = 2 → clamped to 1.15
  })

  it('respects an explicit maxScaleDeviation and visualOffset', () => {
    const v = resolveBuildingVisual(
      base({ size: [10, 4, 5], visual: { ...ARCH, maxScaleDeviation: 0.05, visualOffset: [0, 0.3, 0] } }),
    )!
    expect(v.scale[0]).toBeCloseTo(1.05)
    expect(v.offset).toEqual([0, 0.3, 0])
  })

  it('seeds the overlay deterministically per building id, and distinctly across ids', () => {
    const a = resolveBuildingVisual(base({ id: 'building_house_r1', visual: { ...ARCH } }))!
    const a2 = resolveBuildingVisual(base({ id: 'building_house_r1', visual: { ...ARCH } }))!
    const b = resolveBuildingVisual(base({ id: 'building_house_r2', visual: { ...ARCH } }))!
    expect(a.overlaySeed).toBe(a2.overlaySeed) // deterministic
    expect(a.overlaySeed).not.toBe(b.overlaySeed) // distinct per id
  })

  it('carries the palette variant through (from authored colors, not random)', () => {
    const v = resolveBuildingVisual(
      base({ visual: { ...ARCH, paletteVariant: { wall: { color: '#e8b4a2' } } } }),
    )!
    expect(v.paletteVariant).toEqual({ wall: { color: '#e8b4a2' } })
  })
})

describe('projectedLabelHeight', () => {
  it('returns the raw height for a legacy building', () => {
    expect(projectedLabelHeight(undefined, 6.2)).toBe(6.2)
  })

  it('applies Y scale AND Y offset from the projection', () => {
    const v = resolveBuildingVisual(base({ size: [5, 4.4, 5], visual: { ...ARCH, visualOffset: [0, 0.5, 0] } }))!
    // scaleY ≈ 1.1, offsetY = 0.5 → 0.5 + 1.1 * 6.0
    expect(projectedLabelHeight(v, 6.0)).toBeCloseTo(0.5 + 1.1 * 6.0)
  })
})
