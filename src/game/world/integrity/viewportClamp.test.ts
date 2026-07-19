import { describe, expect, it } from 'vitest'
import { clampToViewport, preferredAlignment, type ClampInput } from './viewportClamp'

const base: ClampInput = {
  anchorX: 640,
  anchorY: 400,
  viewportWidth: 1280,
  viewportHeight: 800,
  halfWidth: 60,
  halfHeight: 20,
  margin: 12,
  onScreen: true,
}

describe('clampToViewport', () => {
  it('leaves a comfortably on-screen anchor unchanged', () => {
    const r = clampToViewport(base)
    expect(r.x).toBe(640)
    expect(r.y).toBe(400)
    expect(r.clampedX).toBe(false)
    expect(r.clampedY).toBe(false)
    expect(r.hidden).toBe(false)
  })

  it('clamps a left-edge anchor fully inside the safe margin', () => {
    const r = clampToViewport({ ...base, anchorX: -50 })
    expect(r.x).toBe(12 + 60) // margin + halfWidth
    expect(r.clampedX).toBe(true)
    expect(r.tailX).toBeLessThan(0) // tail points left toward the true anchor
  })

  it('clamps a right-edge anchor', () => {
    const r = clampToViewport({ ...base, anchorX: 1400 })
    expect(r.x).toBe(1280 - 12 - 60)
    expect(r.clampedX).toBe(true)
    expect(r.tailX).toBeGreaterThan(0)
  })

  it('clamps top and bottom edges', () => {
    expect(clampToViewport({ ...base, anchorY: -30 }).y).toBe(12 + 20)
    expect(clampToViewport({ ...base, anchorY: 900 }).y).toBe(800 - 12 - 20)
  })

  it('hides the element when the anchor is off-screen (behind camera)', () => {
    const r = clampToViewport({ ...base, onScreen: false })
    expect(r.hidden).toBe(true)
  })

  it('centres the element in a viewport too small to fit it', () => {
    const r = clampToViewport({ ...base, viewportWidth: 100, viewportHeight: 60 })
    expect(r.x).toBe(50)
    expect(r.y).toBe(30)
  })

  it('flips alignment toward centre-screen when clamped', () => {
    const left = clampToViewport({ ...base, anchorX: -50 })
    expect(preferredAlignment(left, base.viewportWidth)).toBe('left')
    const right = clampToViewport({ ...base, anchorX: 1400 })
    expect(preferredAlignment(right, base.viewportWidth)).toBe('right')
    expect(preferredAlignment(clampToViewport(base), base.viewportWidth)).toBe('center')
  })
})
