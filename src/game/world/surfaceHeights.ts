/**
 * Issue #58 — render heights for the LEGACY (central + district) sidewalk layer.
 *
 * Physical support is flat at Y = 0 everywhere people and cars walk or drive (`CityColliders`, the
 * Gateway corridor floor, compiled sector floors), and no actor samples a sidewalk height. The Gateway
 * and compiled sectors already render sidewalks as planes at Y = 0.03; the legacy slabs rendered their
 * top at 0.12, hiding the lower part of a shoe standing on them. These values put the legacy slabs on
 * the same 0.03 layer while keeping their 0.12 m thickness (so the centre is -0.03, NOT +0.03), and
 * move the decals painted on or beside them onto existing tiers.
 *
 * PURELY VISUAL: no collider, route, anchor, actor transform or asset reads these values. A 3 cm
 * visual layer remains above the Y = 0 support by design.
 */

/** Visible top of every legacy sidewalk slab — the Gateway / compiled sidewalk plane height. */
export const SIDEWALK_TOP_Y = 0.03
/** Legacy slab box thickness, unchanged. */
export const SIDEWALK_SLAB_THICKNESS = 0.12
/** Box centre that puts the slab's top at SIDEWALK_TOP_Y. */
export const SIDEWALK_SLAB_CENTER_Y = SIDEWALK_TOP_Y - SIDEWALK_SLAB_THICKNESS / 2
/** Legacy curb-ramp pads: the compiled crossing curb-ramp tier (`CrossingArtLayer`). */
export const LEGACY_CURB_RAMP_Y = 0.045
/** Market curb-space stripes: the residential curb-space stripe tier (`Districts`). */
export const LEGACY_MARKET_CURB_STRIPE_Y = 0.032
