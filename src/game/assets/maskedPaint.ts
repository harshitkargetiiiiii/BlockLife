/**
 * Masked vehicle paint (issue #50).
 *
 * THE PROBLEM. The approved Wave-1 sports body is ONE baked atlas: the panels, the glass, the
 * lamps, the tyres and the trim all live in the same texture, so the §3 variant system — which
 * recolors a whole material — could only ever recolor the whole car. Wave 1 correctly declared
 * `materialSlots: {}` and recorded that a saved paint and wheel choice were stored, persisted and
 * shown in the Garage but NOT visible on the body. This module is what makes them visible, without
 * re-authoring the art and without touching the approved source.
 *
 * THE MECHANISM. The intake pipeline derives, offline and deterministically, a PAINT CONTRIBUTION
 * MAP over that same atlas (see `scripts/asset-intake/segmentation.mjs`). It is not a mask: for a
 * texel the classifier calls painted panel it holds that texel's ACTUAL colour, byte for byte from
 * the atlas, and zero everywhere else. At render time the shader takes the authored paint OUT of
 * the sample and puts the chosen colour IN, at the same brightness:
 *
 *     contribution = texture(contributionMap, uv)          // filtered exactly like the atlas
 *     remainder    = max(sampled - contribution, 0)        // whatever else was in this sample
 *     brightness   = luma(contribution) / luma(reference)  // how light the authored paint was here
 *     diffuse      = remainder + brightness * chosenPaint
 *
 * Both terms are premultiplied by coverage, which is the quantity hardware filtering interpolates
 * correctly, so this is exact at a boundary as well as inside a panel — including a boundary
 * between paint and a NON-black neighbour, where `remainder` is that neighbour's own contribution.
 *
 * TWO EARLIER ENCODINGS FAILED, both on this real atlas rather than in theory:
 *  1. A binary coverage mask with `mix()`. At a filtered boundary between a painted texel `P` and a
 *     black one, `sampled = 0.5P` and `coverage = 0.5`, so the mix returns `0.25P + 0.25C` — a
 *     quarter of the AUTHORED paint survives however perfect the mask is. On this finely chopped
 *     unwrap that drew a gold line along every triangle edge of a charcoal car.
 *  2. A SCALAR premultiplied contribution, `luma(texel)/luma(reference)`. That fixes the boundary
 *     algebra but approximates every painted texel by ONE reference hue times a brightness, so each
 *     texel's own chroma survives the subtraction and is added back over the new paint. Measured:
 *     mean per-texel max-channel residual 0.0234 linear, max 0.2617, 89,692 texels over 0.03 —
 *     which rendered as red/green mottling across the panels.
 *
 * Two properties matter, and both are testable:
 *  - **A zero contribution is a no-op.** `remainder + 0` is `sampled`, exactly, so a texel the map
 *    calls unpainted is written out as it was sampled. Stated precisely, because it is easy to overstate: this is a
 *    per-texel guarantee about the SHADER, and the mask is a colour classification of the atlas,
 *    not a semantic labelling of parts. It says the recolor cannot reach a texel outside the
 *    painted-panel cluster; it does not by itself prove every window, lamp, tyre and piece of trim
 *    is outside that cluster, and it says nothing about what bilinear filtering and mipmaps do at
 *    the boundary between a masked and an unmasked texel. Those are settled by rendered evidence,
 *    not by this comment — see docs/VEHICLE_PAINT_SEGMENTATION.md.
 *  - **The baked shading survives.** `brightness` IS the authored brightness, so a crease that was
 *    dark yellow becomes dark paint. A flat fill would erase the detail that makes the model worth
 *    shipping.
 *
 * WHY A SHADER AND NOT A TEXTURE REWRITE. Recoloring the atlas on the CPU would mean decoding,
 * rewriting and re-uploading a 1024² texture per instance per paint change, and would multiply the
 * texture budget by the palette. This costs one extra sampler and no per-frame work: the uniforms
 * are two colours, written when the paint changes and never in `useFrame`.
 *
 * WHAT THIS IS NOT. It is not a global atlas tint (the mask forbids it), not a second body, not a
 * duplicate wheel set, and not a substitution of the procedural box. The Meshy body is the thing on
 * screen in every branch this touches.
 */
import * as THREE from 'three'

/** Rec. 709 luma — the same weights `segmentation.mjs` uses when it measures the atlas. */
const LUMA = new THREE.Vector3(0.2126, 0.7152, 0.0722)

export interface MaskedPaintUniforms {
  /** The contribution map: the authored paint's own colour where painted, zero elsewhere. */
  uPaintMask: { value: THREE.Texture | null }
  uPaintColor: { value: THREE.Color }
  /** Linear luma of the UNSHADED authored paint — the denominator that turns contribution into brightness. */
  uPaintRefLuma: { value: number }
  /**
   * 0 disables the recolor entirely — `mix(x, y, mask * 0)` is `x`, so the body renders exactly as
   * authored. This is the honest "no paint selected" state; scaling the colour toward white
   * instead would desaturate the panels, which is a change, not an absence of one.
   */
  uPaintStrength: { value: number }
}

/** A material carrying the masked-paint program, plus the uniforms to drive it. */
export interface MaskedPaintMaterial {
  material: THREE.MeshStandardMaterial
  uniforms: MaskedPaintUniforms
}

/**
 * Linear-space luma of the reference paint colour.
 *
 * The shader works on `diffuseColor`, which three has already converted from the sRGB texture into
 * the linear working space, so the reference has to be converted the same way — which `THREE.Color`
 * does itself while colour management is on — or every number is out by a gamma. The intake step
 * computes the SAME quantity when it encodes the mask, so this is also the contract between them.
 */
export function referencePaintLuma(referenceColor: string): number {
  const c = new THREE.Color(referenceColor)
  return c.r * LUMA.x + c.g * LUMA.y + c.b * LUMA.z
}

const PAINT_CHUNK = /* glsl */ `
  #ifdef USE_MAP
    // issue #50 — vehicle paint by contribution replacement. uPaintMask holds the authored paint's
    // OWN colour where the texel is painted panel and zero elsewhere, sampled in the same colour
    // space and with the same filtering as the atlas, so both terms below are premultiplied by
    // coverage and a filtered boundary lands where a recolored texture would have.
    vec3 bl_contribution = texture2D( uPaintMask, vMapUv ).rgb;
    vec3 bl_remainder = max( diffuseColor.rgb - bl_contribution, vec3( 0.0 ) );
    float bl_brightness = dot( bl_contribution, vec3( 0.2126, 0.7152, 0.0722 ) ) / max( uPaintRefLuma, 1e-4 );
    // Strength 0 puts the authored contribution straight back, i.e. the identity.
    diffuseColor.rgb = bl_remainder + mix( bl_contribution, bl_brightness * uPaintColor, uPaintStrength );
  #endif
`

/**
 * Install the masked-paint program on a CLONE of `source`.
 *
 * The clone is what makes two vehicles of the same class able to wear different paint from one
 * file — exactly the guarantee `createVariantInstances` gives the declared-slot path, reached the
 * same way. The caller owns the returned material and must dispose it.
 */
export function createMaskedPaintMaterial(
  source: THREE.Material,
  mask: THREE.Texture,
  referenceColor: string,
): MaskedPaintMaterial {
  const material = source.clone() as THREE.MeshStandardMaterial
  const uniforms: MaskedPaintUniforms = {
    uPaintMask: { value: mask },
    uPaintColor: { value: new THREE.Color(1, 1, 1) },
    uPaintRefLuma: { value: referencePaintLuma(referenceColor) },
    uPaintStrength: { value: 0 },
  }
  material.onBeforeCompile = (shader) => {
    shader.uniforms.uPaintMask = uniforms.uPaintMask
    shader.uniforms.uPaintColor = uniforms.uPaintColor
    shader.uniforms.uPaintRefLuma = uniforms.uPaintRefLuma
    shader.uniforms.uPaintStrength = uniforms.uPaintStrength
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <map_pars_fragment>',
        '#include <map_pars_fragment>\nuniform sampler2D uPaintMask;\nuniform vec3 uPaintColor;\nuniform float uPaintRefLuma;\nuniform float uPaintStrength;',
      )
      .replace('#include <map_fragment>', `#include <map_fragment>${PAINT_CHUNK}`)
  }
  // A CONSTANT key on purpose. three keys its program cache on the material's parameters, which
  // do not change when `onBeforeCompile` rewrites the source — so without this a masked material
  // and a stock MeshStandardMaterial with the same parameters would share one cached program and
  // whichever compiled first would win. Every masked-paint material compiles the SAME source, so
  // they should and do share one program between themselves; what is per-material is the uniform
  // objects bound above, which is what lets two vehicles wear different colours.
  material.customProgramCacheKey = () => 'bl-masked-paint'
  material.needsUpdate = true
  return { material, uniforms }
}

/**
 * Point the program at a colour. Cheap: one uniform write, no recompile, no texture work.
 *
 * `null`/empty means "leave the authored paint alone", which is what the shell wears when no owned
 * vehicle is active — the same rule the procedural body follows.
 */
export function setMaskedPaintColor(target: MaskedPaintMaterial, color: string | undefined): void {
  if (!color) {
    target.uniforms.uPaintStrength.value = 0
    return
  }
  target.uniforms.uPaintColor.value.set(color)
  target.uniforms.uPaintStrength.value = 1
}

/**
 * The contribution map's sampler, matched to the atlas it is subtracted from.
 *
 * Every one of these matters, because the map is compared to the atlas PER SAMPLE:
 *  - `flipY = false` and `wrap = Repeat` are what GLTFLoader gives the atlas, so the two address
 *    the same texel for the same UV.
 *  - `SRGBColorSpace` is what the atlas carries as a base-colour texture, so both are decoded to
 *    linear the same way. Treating this one as raw data would leave the subtraction gamma-mismatched
 *    and the remainder would be wrong everywhere.
 *  - Linear + mipmapped filtering, again matching, so the two are interpolated identically. If the
 *    filters differed, `sampled - contribution` would not cancel and the old speckle would return.
 */
export function configurePaintMask(texture: THREE.Texture): THREE.Texture {
  texture.flipY = false
  texture.colorSpace = THREE.SRGBColorSpace
  texture.wrapS = THREE.RepeatWrapping
  texture.wrapT = THREE.RepeatWrapping
  texture.magFilter = THREE.LinearFilter
  texture.minFilter = THREE.LinearMipmapLinearFilter
  texture.generateMipmaps = true
  texture.needsUpdate = true
  return texture
}

/**
 * Wheel node transform for a wheel style (issue #50).
 *
 * `radiusScale` scales the wheel in its own RADIAL plane only (local X/Y — the segmentation step
 * asserts the axle is Z), so a bigger wheel does not also get wider. The lift is what keeps it on
 * the road: the wheel's node sits at its centre and the wheel touches the ground, so its centre
 * height IS its radius, and growing it by `s` about that centre would sink it by `radius*(s-1)`.
 * Adding exactly that back keeps the contact patch at y = 0.
 *
 * `maxScale` is the honest part. A wheel style's radius is a gameplay value shared by every class,
 * and this body's authored arches were not drawn to hold it: measured by triangle intersection
 * against the body's own geometry, the four wheels clear at 1.04 and collide at 1.05, while the
 * off-road style asks for 1.18 (806 intersecting triangle pairs — the tyre through the wing).
 * Ground contact does NOT imply arch clearance, and the two must be checked separately.
 *
 * So the scale is CLAMPED to what the body can actually hold. That is a reduction, and it is
 * reported as one: on this body an off-road wheel reads as a slightly larger wheel rather than a
 * markedly larger one. The alternative — rendering the advertised size — puts visible tyre
 * geometry through the bodywork, which is not a customization, it is a defect.
 */
export function wheelNodeTransform(radius: number, radiusScale: number, maxScale = Infinity): {
  scale: [number, number, number]
  liftY: number
  /** True when the style asked for more than this body's arches can hold. */
  clamped: boolean
} {
  const asked = radiusScale > 0 ? radiusScale : 1
  const s = Math.min(asked, maxScale)
  return { scale: [s, s, 1], liftY: radius * (s - 1), clamped: s < asked }
}
