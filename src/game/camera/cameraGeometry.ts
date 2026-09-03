/**
 * Camera geometry — the ONE place the diorama camera's fixed offset lives, plus the
 * world-height invariants DERIVED from it (issue #46 §2).
 *
 * `FollowCamera` places an orthographic camera at `target + CAMERA_OFFSET` with `near: -200`,
 * so the camera EYE is a real point in the world at `y = CAMERA_OFFSET[1]`. Geometry that
 * reaches that height can contain the eye: the frame then fills with the inside of a roof and
 * the subject disappears. Wave 3 (#44) shipped a body that would have rendered 24.3 m tall —
 * 6.3 m ABOVE the eye — and `tsc`, lint, the unit suite, the asset report, the placement
 * validators, district certification and the whole E2E suite were all green on it. Only a
 * visual baseline caught it.
 *
 * That ceiling was then written as a literal in the Wave-3 intake config and enforced for
 * Wave-3 bodies alone. It is not a property of Wave 3; it is a property of the camera. This
 * module owns it, so the number follows from the offset instead of being retyped, and it is
 * the single authority for:
 *   - `FollowCamera`'s own offset (it imports CAMERA_OFFSET rather than re-declaring it),
 *   - the asset-intake render-height ceiling (`scripts/asset-intake/*.config.mjs`, which each
 *     gate their literal against `MAX_WORLD_RENDER_HEIGHT` in their contract test),
 *   - the manifest camera-clearance contract (`src/game/assets/cameraClearance.test.ts`),
 *   - the authored-box authoring rule (`placementValidation.validateCameraClearance`).
 *
 * Pure data + pure functions: no three.js import, so unit tests, node-environment contract
 * tests and the intake tooling can all read it.
 */

/**
 * FollowCamera's fixed diorama offset from the look target — up, right and back. Never
 * rotated in normal play (the DEV review orbit spins it about Y, which preserves both the
 * height and the horizontal reach, so every invariant below is orbit-invariant).
 */
export const CAMERA_OFFSET: readonly [number, number, number] = [12, 18, 12]

/** Height of the camera eye above the followed subject's ground plane. */
export const CAMERA_EYE_HEIGHT = CAMERA_OFFSET[1]

/** Ground distance from the subject to the camera — |(x, z)| of the offset. */
export const CAMERA_HORIZONTAL_REACH = Math.hypot(CAMERA_OFFSET[0], CAMERA_OFFSET[2])

/**
 * Vertical air every world-rendered VISUAL body must leave beneath the eye.
 *
 * Not an aesthetic buffer, and not a round number picked to make the current city pass. Two
 * concrete effects put geometry above its nominal top:
 *   1. `BuildingMesh` caps every authored box with a 0.5 m roof slab, so the thing on screen
 *      already stands taller than `def.size[1]`;
 *   2. `FollowCamera` damps toward a LOOK-AHEAD point (up to `LOOKAHEAD_MAX` = 6 m ahead of
 *      the subject) rather than the subject itself, so on a fast approach the eye transiently
 *      sits over ground the subject has not reached — a body that merely clears the eye at
 *      rest can still swallow it mid-approach.
 * 3 m covers both with margin and costs a body one sixth of the available height.
 *
 * It also reproduces the pre-existing envelope exactly: 18 − 3 = 15 m is what the Quaternius
 * `Building_Medium_2` the Wave-3 apartment replaced already rendered at, so promoting the rule
 * here changes no pixel that was correct before.
 */
export const CAMERA_CLEARANCE = 3

/**
 * The ceiling any world-rendered visual body may reach, in world units above the ground plane
 * it stands on. DERIVED — change `CAMERA_OFFSET` and every gate moves with it.
 */
export const MAX_WORLD_RENDER_HEIGHT = CAMERA_EYE_HEIGHT - CAMERA_CLEARANCE

/** Clearance (world units) left beneath the camera eye by a body whose top is at `topY`. */
export function cameraClearanceOf(topY: number): number {
  return CAMERA_EYE_HEIGHT - topY
}

/**
 * True when a body whose top is at `topY` can contain the camera eye.
 *
 * This is the HARD invariant — the one an authored `def.size` is gated against. The softer
 * `MAX_WORLD_RENDER_HEIGHT` ceiling above it is what a rendered VISUAL body is held to.
 */
export function containsCameraEye(topY: number): boolean {
  return topY >= CAMERA_EYE_HEIGHT
}
