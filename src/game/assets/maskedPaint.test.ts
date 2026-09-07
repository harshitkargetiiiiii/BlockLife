import { describe, expect, it } from 'vitest'
import * as THREE from 'three'
import {
  configurePaintMask,
  createMaskedPaintMaterial,
  referencePaintLuma,
  setMaskedPaintColor,
  wheelNodeTransform,
} from './maskedPaint'
import { ASSET_MANIFEST_BY_ID } from './assetManifest'

/**
 * Issue #50 — the masked-paint mechanism, tested where it is arithmetic rather than pixels.
 *
 * What this file can and cannot settle is worth being explicit about. It settles the colour space,
 * the per-instance isolation, the wheel transform algebra and the shader text that is injected.
 * It does NOT settle what the rendered image looks like — filtering, mipmaps and the semantic
 * question of whether the mask really covers only panels are answered by rendered evidence, which
 * is why those claims live with the screenshots rather than here.
 */

function standardMaterial(name: string): THREE.MeshStandardMaterial {
  const m = new THREE.MeshStandardMaterial({ name })
  m.map = new THREE.Texture()
  return m
}

describe('issue #50 — reference luma is measured in the LINEAR working space', () => {
  it('converts the sRGB reference the same way the sampled atlas is converted', () => {
    // `diffuseColor` after <map_fragment> is linear (three decodes an sRGB map), so dividing it by
    // an sRGB-encoded reference would be wrong by a gamma and every recolor would come out dark.
    const linear = new THREE.Color('#fdd302')
    const measured = referencePaintLuma('#fdd302')
    expect(measured).toBeCloseTo(0.2126 * linear.r + 0.7152 * linear.g + 0.0722 * linear.b, 12)
    // Guard the actual mistake: the sRGB-space luma of this hex is ~0.81 against the linear ~0.68,
    // so getting it wrong would darken every recolor by around 20%.
    const srgbLuma = (0.2126 * 0xfd + 0.7152 * 0xd3 + 0.0722 * 0x02) / 255
    expect(srgbLuma - measured).toBeGreaterThan(0.1)
    expect(THREE.ColorManagement.enabled, 'colour management must be on for this to hold').toBe(true)
  })
})

describe('issue #50 — masked paint is per instance and leaves the source material alone', () => {
  it('clones the material so two vehicles from one file wear different colours', () => {
    const source = standardMaterial('paint_body')
    const mask = new THREE.Texture()
    const a = createMaskedPaintMaterial(source, mask, '#fdd302')
    const b = createMaskedPaintMaterial(source, mask, '#fdd302')
    expect(a.material).not.toBe(source)
    expect(a.material).not.toBe(b.material)
    expect(a.uniforms.uPaintColor.value).not.toBe(b.uniforms.uPaintColor.value)

    setMaskedPaintColor(a, '#2c2c33')
    setMaskedPaintColor(b, '#5b7fc2')
    expect(a.uniforms.uPaintColor.value.getHexString()).toBe('2c2c33')
    expect(b.uniforms.uPaintColor.value.getHexString()).toBe('5b7fc2')
    // The shared source material — the one the drei cache holds — is never written to.
    expect(source.color.getHexString()).toBe('ffffff')
  })

  it('starts inert and only paints once a colour is chosen', () => {
    const target = createMaskedPaintMaterial(standardMaterial('paint_wheel'), new THREE.Texture(), '#fdd302')
    expect(target.uniforms.uPaintStrength.value, 'no colour yet -> the body renders as authored').toBe(0)
    setMaskedPaintColor(target, '#4c956c')
    expect(target.uniforms.uPaintStrength.value).toBe(1)
    // An absent wheel style must go back to the authored rim, not to some guessed colour.
    setMaskedPaintColor(target, undefined)
    expect(target.uniforms.uPaintStrength.value).toBe(0)
  })

  it('injects the CONTRIBUTION program — subtract the authored paint, add the chosen one', () => {
    const target = createMaskedPaintMaterial(standardMaterial('paint_body'), new THREE.Texture(), '#fdd302')
    const shader = {
      uniforms: {} as Record<string, unknown>,
      fragmentShader: '#include <map_pars_fragment>\nvoid main(){\n#include <map_fragment>\n}',
      vertexShader: '',
    }
    target.material.onBeforeCompile!(shader as never, null as never)
    // The uniforms the material owns are the ones the program reads — not copies.
    expect(shader.uniforms.uPaintColor).toBe(target.uniforms.uPaintColor)
    expect(shader.uniforms.uPaintMask).toBe(target.uniforms.uPaintMask)
    expect(shader.uniforms.uPaintRefLuma).toBe(target.uniforms.uPaintRefLuma)
    expect(shader.uniforms.uPaintStrength).toBe(target.uniforms.uPaintStrength)
    expect(shader.fragmentShader).toContain('uniform sampler2D uPaintMask;')
    expect(shader.fragmentShader).toContain('texture2D( uPaintMask, vMapUv ).rgb')
    expect(shader.fragmentShader).toContain('max( diffuseColor.rgb - bl_contribution, vec3( 0.0 ) )')
    expect(shader.fragmentShader).toContain('mix( bl_contribution, bl_brightness * uPaintColor, uPaintStrength )')
    // It must run AFTER the map is sampled, or there would be nothing to subtract from.
    expect(shader.fragmentShader.indexOf('#include <map_fragment>'))
      .toBeLessThan(shader.fragmentShader.indexOf('bl_contribution'))
  })

  /**
   * The defect this formulation exists to fix, as arithmetic — and the cases the earlier ones got
   * wrong. Everything here is in the LINEAR working space, which is where the shader operates.
   */
  describe('a filtered boundary lands where a recolored texture would', () => {
    const REF = new THREE.Color('#fdd302')
    const C = new THREE.Color('#2c2c33')
    const lumaOf = (c: THREE.Color) => c.r * 0.2126 + c.g * 0.7152 + c.b * 0.0722
    const refLuma = lumaOf(REF)
    /** The shader, evaluated in JS on already-filtered inputs. */
    const shade = (sampled: THREE.Color, contribution: THREE.Color, chosen: THREE.Color, strength = 1) => {
      const brightness = lumaOf(contribution) / refLuma
      const mixCh = (a: number, b: number) => a + (b - a) * strength
      return new THREE.Color(
        Math.max(sampled.r - contribution.r, 0) + mixCh(contribution.r, brightness * chosen.r),
        Math.max(sampled.g - contribution.g, 0) + mixCh(contribution.g, brightness * chosen.g),
        Math.max(sampled.b - contribution.b, 0) + mixCh(contribution.b, brightness * chosen.b),
      )
    }
    const close = (got: THREE.Color, want: THREE.Color, msg: string) => {
      expect(got.r, `${msg} r`).toBeCloseTo(want.r, 6)
      expect(got.g, `${msg} g`).toBeCloseTo(want.g, 6)
      expect(got.b, `${msg} b`).toBeCloseTo(want.b, 6)
    }

    it('painted against BLACK, sampled halfway', () => {
      const sampled = REF.clone().multiplyScalar(0.5)
      close(shade(sampled, REF.clone().multiplyScalar(0.5), C), C.clone().multiplyScalar(0.5), '0.5 C')
    })

    it('a NON-reference-hue painted texel against a NON-black protected neighbour', () => {
      // A duller, greener panel texel than the reference — the case the scalar encoding could not
      // express — half-covering a dark blue-grey window, which must survive untouched.
      const panel = new THREE.Color(0.42, 0.31, 0.02)
      const glass = new THREE.Color(0.015, 0.018, 0.031)
      const sampled = new THREE.Color(
        0.5 * panel.r + 0.5 * glass.r,
        0.5 * panel.g + 0.5 * glass.g,
        0.5 * panel.b + 0.5 * glass.b,
      )
      const contribution = panel.clone().multiplyScalar(0.5)
      const brightness = lumaOf(contribution) / refLuma
      const want = new THREE.Color(
        0.5 * glass.r + brightness * C.r,
        0.5 * glass.g + brightness * C.g,
        0.5 * glass.b + brightness * C.b,
      )
      close(shade(sampled, contribution, C), want, 'glass kept, panel replaced')
    })

    it('strength 0 is the identity, even mid-boundary', () => {
      const sampled = new THREE.Color(0.3, 0.24, 0.05)
      const contribution = new THREE.Color(0.28, 0.22, 0.01)
      close(shade(sampled, contribution, C, 0), sampled, 'unpainted')
    })

    it('the old coverage `mix` leaves a quarter of the AUTHORED paint behind', () => {
      const sampled = REF.clone().multiplyScalar(0.5)
      const s = lumaOf(sampled) / refLuma
      const mixed = new THREE.Color(
        sampled.r * 0.5 + C.r * s * 0.5,
        sampled.g * 0.5 + C.g * s * 0.5,
        sampled.b * 0.5 + C.b * s * 0.5,
      )
      expect(mixed.r).toBeCloseTo(0.25 * REF.r + 0.25 * C.r, 3)
      expect(mixed.r - 0.5 * C.r, 'which is what showed as a gold edge').toBeGreaterThan(0.2)
    })
  })

  it('is the identity wherever the contribution is zero', () => {
    // Glass, tyres, trim and unpainted padding all read zero, and the expression must not touch
    // them at all: `max(sampled - 0, 0) + mix(0, 0 * C, s)` is `sampled`.
    const C = new THREE.Color('#4c956c')
    const glass = new THREE.Color(0.02, 0.021, 0.03)
    const zero = new THREE.Color(0, 0, 0)
    const brightness = 0
    const out = new THREE.Color(
      Math.max(glass.r - zero.r, 0) + brightness * C.r,
      Math.max(glass.g - zero.g, 0) + brightness * C.g,
      Math.max(glass.b - zero.b, 0) + brightness * C.b,
    )
    expect([out.r, out.g, out.b]).toEqual([glass.r, glass.g, glass.b])
  })

  it('gives every masked material ONE shared program key, distinct from a stock material', () => {
    const a = createMaskedPaintMaterial(standardMaterial('paint_body'), new THREE.Texture(), '#fdd302')
    const b = createMaskedPaintMaterial(standardMaterial('paint_wheel'), new THREE.Texture(), '#fdd302')
    // Sharing one compiled program between masked materials is intended — they compile identical
    // source and differ only in uniforms. What must NOT happen is sharing with a stock material,
    // which is what an unset key would do because three keys the cache on parameters, not source.
    expect(a.material.customProgramCacheKey!()).toBe(b.material.customProgramCacheKey!())
    expect(a.material.customProgramCacheKey!()).not.toBe(new THREE.MeshStandardMaterial().customProgramCacheKey())
  })

  it('samples the contribution map exactly as the atlas it is subtracted from', () => {
    const t = configurePaintMask(new THREE.Texture())
    // GLTFLoader gives the atlas flipY = false and Repeat wrapping, so the two must address the
    // same texel for the same UV.
    expect(t.flipY).toBe(false)
    expect(t.wrapS).toBe(THREE.RepeatWrapping)
    expect(t.wrapT).toBe(THREE.RepeatWrapping)
    // ...and the SAME colour space, because the two are subtracted from each other. Treating the
    // map as raw data would leave the subtraction out by a gamma everywhere.
    expect(t.colorSpace).toBe(THREE.SRGBColorSpace)
    // ...and the same filtering, or `sampled - contribution` would not cancel between texels.
    expect(t.magFilter).toBe(THREE.LinearFilter)
    expect(t.minFilter).toBe(THREE.LinearMipmapLinearFilter)
    expect(t.generateMipmaps).toBe(true)
  })
})

describe('issue #50 — wheel size is an absolute transform that keeps the wheel on the road', () => {
  const RADIUS = 0.140895

  it('is identity for the default style, so the source silhouette is reproduced exactly', () => {
    expect(wheelNodeTransform(RADIUS, 1)).toEqual({ scale: [1, 1, 1], liftY: 0, clamped: false })
  })

  it('scales only the radial plane — a bigger wheel does not become a wider one', () => {
    const { scale } = wheelNodeTransform(RADIUS, 1.18)
    // The segmentation step asserts the axle axis is Z, which is why Z stays 1.
    expect(scale).toEqual([1.18, 1.18, 1])
  })

  it('clamps to what a body can hold, and says so rather than pretending', () => {
    // The sports body's authored arches clear 1.04 and collide at 1.05 (wheelClearance.test.ts
    // measures both from the shipped geometry), so the off-road style cannot render at 1.18 there.
    const capped = wheelNodeTransform(RADIUS, 1.18, 1.04)
    expect(capped.scale).toEqual([1.04, 1.04, 1])
    expect(capped.clamped, 'the reduction is reported, not silent').toBe(true)
    // ...and it is still on the road afterwards.
    expect(RADIUS + capped.liftY - RADIUS * 1.04).toBeCloseTo(0, 12)
    // A style that already fits is untouched and is NOT reported as clamped.
    expect(wheelNodeTransform(RADIUS, 1, 1.04)).toEqual({ scale: [1, 1, 1], liftY: 0, clamped: false })
  })

  it('lifts by exactly the amount growth would have sunk it', () => {
    for (const s of [1, 1.18, 0.8, 1.5]) {
      const { liftY } = wheelNodeTransform(RADIUS, s)
      // The wheel touches y = 0 in local space, so its centre height IS its radius. After scaling
      // about the centre and lifting, the lowest point must be back at 0.
      const bottomAfter = RADIUS + liftY - RADIUS * s
      expect(bottomAfter, `radiusScale ${s}`).toBeCloseTo(0, 12)
    }
  })

  it('does not compound when a style is applied repeatedly', () => {
    // The runtime SETS the transform rather than multiplying it, so this is the algebra that
    // property depends on: the same input always yields the same absolute output.
    const first = wheelNodeTransform(RADIUS, 1.18)
    for (let i = 0; i < 10; i++) expect(wheelNodeTransform(RADIUS, 1.18)).toEqual(first)
    // ...and going back to the default returns the wheel exactly to where it started.
    expect(wheelNodeTransform(RADIUS, 1)).toEqual({ scale: [1, 1, 1], liftY: 0, clamped: false })
  })

  it('treats a non-positive scale as the default rather than collapsing the wheel', () => {
    expect(wheelNodeTransform(RADIUS, 0)).toEqual({ scale: [1, 1, 1], liftY: 0, clamped: false })
    expect(wheelNodeTransform(RADIUS, -2)).toEqual({ scale: [1, 1, 1], liftY: 0, clamped: false })
  })
})

describe('issue #50 — the manifest declaration describes the body it is aimed at', () => {
  const entry = ASSET_MANIFEST_BY_ID.get('vehicle_sports_car_01')!

  it('keeps the empty slot map — a whole-material tint stays unavailable', () => {
    expect(entry.materialSlots).toEqual({})
    expect(entry.paintMask, 'the sports body declares a derived mask').toBeDefined()
  })

  it('declares four wheel pivots with plausible rolling radii', () => {
    const nodes = entry.paintMask!.wheelNodes
    expect(nodes).toHaveLength(4)
    expect(new Set(nodes.map((n) => n.name)).size, 'wheel node names are unique').toBe(4)
    for (const n of nodes) {
      expect(n.name).toMatch(/^wheel_x(pos|neg)_z(pos|neg)$/)
      expect(n.radius).toBeGreaterThan(0.1)
      expect(n.radius).toBeLessThan(0.2)
    }
  })

  it('is the ONLY entry claiming a derived mask — this does not silently change other bodies', () => {
    const withMask = [...ASSET_MANIFEST_BY_ID.values()].filter((e) => e.paintMask)
    expect(withMask.map((e) => e.id)).toEqual(['vehicle_sports_car_01'])
  })
})
