import { CAMERA_EYE_HEIGHT, CAMERA_HORIZONTAL_REACH } from '../../src/game/camera/cameraGeometry'
import { ASSET_MANIFEST_BY_ID, type AssetManifestEntry } from '../../src/game/assets/assetManifest'

/**
 * Derived visual-test framing (issue #46 §5) — PURE geometry, no Playwright, no browser.
 *
 * A building is 4–24 m tall and `FollowCamera` centres on the PLAYER, not on the subject, so a
 * zoom picked by eye crops one subject and loses the next in the middle distance — the
 * "unjudgeable capture" a visual gate is supposed to reject. Wave 3 (#44) stopped guessing and
 * solved the camera geometry in closed form; doing so immediately caught two framing bugs that
 * eyeballing had hidden, one of which aimed tens of metres above the roofline and photographed
 * the sky. That solver was private to a single spec. It lives here now, so no new spec can
 * hand-tune a frame, and it is unit-tested in `framing.test.ts` rather than only exercised by a
 * 25-second browser capture.
 *
 * The camera numbers are IMPORTED from `src/game/camera/cameraGeometry`, never retyped: change
 * the diorama offset and every derived frame in every spec moves with it.
 */

/** FollowCamera's horizontal reach and height above the look target. */
export const CAM_R = CAMERA_HORIZONTAL_REACH // 16.9706
export const CAM_H = CAMERA_EYE_HEIGHT // 18
/** drei's OrthographicCamera uses a canvas-sized frustum, so 1 world unit = `zoom` px. */
export const BASE_ZOOM = 34 // FollowCamera ZOOM_WALKING
export const VIEWPORT_H = 720 // playwright.config.ts viewport height
/** The player transform's own height above the ground plane, which the camera aims at. */
export const PLAYER_Y = 0.8

/** Compass → DEV orbit azimuth that puts the CAMERA on that side of the subject. */
export const AZIMUTH = {
  south: -Math.PI / 4,
  east: Math.PI / 4,
  north: (3 * Math.PI) / 4,
  west: (-3 * Math.PI) / 4,
  /** The shipped view: the camera on the south-east corner, i.e. the three-quarter. */
  corner: 0,
} as const
export type ViewName = keyof typeof AZIMUTH

/** Stand-off direction from the subject centre, along the outward normal of the viewed face. */
export const STANDOFF: Record<ViewName, [number, number]> = {
  south: [0, 1],
  east: [1, 0],
  north: [0, -1],
  west: [-1, 0],
  corner: [Math.SQRT1_2, Math.SQRT1_2],
}

export interface BodyDims {
  height: number
  width: number
  depth: number
}

export interface Framing {
  lookY: number
  zoom: number
}

/**
 * World-space SCREEN-RIGHT unit vector for a given DEV orbit azimuth.
 *
 * `FollowCamera` sits at `player + CAMERA_OFFSET` and looks at the player, so at azimuth 0 the
 * camera's right axis is `normalize(cross(forward, up))` = `(+√½, 0, −√½)` — world `+x, −z`.
 * `setCameraAzimuth` rotates the offset about Y, so the right axis rotates with it.
 *
 * Deriving this matters: the obvious "stand a bit off the subject" offset (`+x, +z`) is almost
 * exactly the screen-VERTICAL axis here, which puts the subject directly behind the player's
 * body — which is how a hydrant and a bin got buried in a first capture pass.
 */
export function screenRight(azimuth: number): [number, number] {
  const x = Math.SQRT1_2
  const z = -Math.SQRT1_2
  return [x * Math.cos(azimuth) + z * Math.sin(azimuth), -x * Math.sin(azimuth) + z * Math.cos(azimuth)]
}

/** Stand the player `gap` units to the screen-RIGHT of a subject, so it reads clear beside them. */
export function standBeside(
  subject: readonly [number, number],
  gap: number,
  azimuth: number,
): [number, number] {
  const [rx, rz] = screenRight(azimuth)
  return [subject[0] + rx * gap, subject[1] + rz * gap]
}

/**
 * Extent of a box ALONG the camera axis for a given view — a box's depth also projects
 * vertically, and ignoring it is what made a 4.8 m shop overflow a frame solved for 4.8 m.
 */
export function alongAxis(body: BodyDims, view: ViewName): number {
  if (view === 'corner') return (body.width + body.depth) / Math.SQRT2
  return view === 'south' || view === 'north' ? body.depth : body.width
}

/**
 * Solve `setCameraLookY` + `setCameraZoomMul` so a body of `height`, standing `gap` units from
 * the player along the camera axis, lands VERTICALLY CENTRED and fills `fill` of the frame.
 *
 * `FollowCamera` keeps its position at `player + R(azimuth)·CAMERA_OFFSET` and only re-aims at
 * the LOOK TARGET `player + (0, lookY, 0)`, so lookY tilts the view rather than moving it.
 * Writing `R = CAM_R = 16.97` and `Λ = CAM_H − lookY` (the camera's height above that target),
 * the view distance is `D = √(R² + Λ²)`, the camera's screen-up axis is `(0, R, −Λ)/D` about
 * the horizontal direction `ĥ` from the player toward the camera, and a world point `Q` lands at
 *
 *   screenUp(Q) = (Q.y − PLAYER_Y − lookY)·(R / D) − (Λ / D)·((Q − player) · ĥ)
 *
 * The height term is measured from the LOOK TARGET, not from the ground — getting that wrong
 * aims tens of metres high and photographs the sky, which is exactly what one capture pass did.
 * A subject standing behind the player has `(Q − player) · ĥ = −gap`; `side: 'near'` puts the
 * player behind IT, giving `+gap`.
 *
 * Centring the body means `screenUp(base) + screenUp(top) = 0`, which solves in closed form:
 *
 *   lookY = (height/2 − PLAYER_Y ∓ CAM_H·gap/R) / (1 ∓ gap/R)      (∓ = far / near)
 *
 * and its on-screen span is then `(R/D)·height + (Λ/D)·along`. drei's OrthographicCamera uses a
 * canvas-sized frustum, so 1 world unit = `zoom` px and `zoomMul = fill·VIEWPORT_H/(BASE_ZOOM·span)`.
 *
 * Nothing is hand-tuned, so a body that changed size reframes itself instead of cropping.
 */
export function frameFor(
  body: BodyDims,
  view: ViewName,
  gap: number,
  fill: number,
  side: 'far' | 'near' = 'far',
): Framing {
  if (!(fill > 0 && fill <= 1)) throw new Error(`frameFor: fill ${fill} must be in (0, 1] or the subject is cropped`)
  if (!(body.height > 0)) throw new Error(`frameFor: body height ${body.height} must be positive`)
  const sign = side === 'far' ? 1 : -1
  const lookY = (body.height / 2 - PLAYER_Y + sign * (CAM_H * gap) / CAM_R) / (1 + (sign * gap) / CAM_R)
  // A look target at or ABOVE the camera flips the view and photographs roof undersides.
  if (!(lookY < CAM_H)) throw new Error(`frameFor: solved lookY ${lookY.toFixed(2)} is at or above the camera (${CAM_H})`)
  const d = Math.hypot(CAM_R, CAM_H - lookY)
  const span = (CAM_R / d) * body.height + ((CAM_H - lookY) / d) * alongAxis(body, view)
  return {
    lookY: +lookY.toFixed(4),
    zoom: +((fill * VIEWPORT_H) / (BASE_ZOOM * span)).toFixed(4),
  }
}

/** Standing height of the on-foot subject, for "is the player still in frame" arithmetic. */
export const SUBJECT_HEIGHT = 1.8

export interface FramingCheck {
  /** Fraction of the frame height the subject occupies. */
  spanFraction: number
  /** Screen offset of the body's centre, in frame heights (0 = centred, + = above). */
  centreOffset: number
  /** Screen offset of the PLAYER's head, in frame heights — > 0.5 means it is off frame. */
  subjectOffset: number
  ok: boolean
  reason: string
}

/**
 * Verify a frame a spec still states by hand: does the subject actually fit, and is it
 * anywhere near the middle of the picture?
 *
 * The same geometry as `frameFor`, run forwards instead of solved backwards. A spec whose
 * numbers already pass keeps its baseline untouched and gains a check that fails if the world
 * moves under it; a spec that fails is framing a subject it cannot fully see.
 */
export function checkFraming(
  body: BodyDims,
  view: ViewName,
  gap: number,
  zoom: number,
  lookY: number,
  side: 'far' | 'near' = 'far',
): FramingCheck {
  const sign = side === 'far' ? 1 : -1
  const d = Math.hypot(CAM_R, CAM_H - lookY)
  const k = CAM_R / d
  const m = (CAM_H - lookY) / d
  const span = k * body.height + m * alongAxis(body, view)
  const pixelsPerUnit = BASE_ZOOM * zoom
  const spanFraction = (span * pixelsPerUnit) / VIEWPORT_H
  // Screen-up of the body's vertical centre, measured from the look target.
  const centreUp = k * (body.height / 2 - PLAYER_Y - lookY) - m * -sign * gap
  const centreOffset = (centreUp * pixelsPerUnit) / VIEWPORT_H
  // Where the PLAYER's head lands. The camera aims at player + lookY and the player sits ON the
  // look axis, so its screen height is just the height term: k·(head − PLAYER_Y − lookY).
  const subjectOffset = (Math.abs(k * (SUBJECT_HEIGHT / 2 - lookY)) * pixelsPerUnit) / VIEWPORT_H
  const cropped = spanFraction > 1
  const offFrame = Math.abs(centreOffset) + spanFraction / 2 > 0.5
  return {
    spanFraction: +spanFraction.toFixed(4),
    centreOffset: +centreOffset.toFixed(4),
    subjectOffset: +subjectOffset.toFixed(4),
    // The SUBJECT being off-picture is not a failure in general: a far-side massing shot centres
    // the body on purpose and lets the player sit low in the frame. It IS a failure for a fade
    // shot, and `fitFill` is where that is enforced — see its comment.
    ok: !cropped && !offFrame,
    reason: cropped
      ? `body spans ${(spanFraction * 100).toFixed(1)}% of the frame height — cropped`
      : offFrame
        ? `body centre sits ${(centreOffset * 100).toFixed(1)}% of a frame off centre — partly out of frame`
        : 'framed',
  }
}

/** Ground clearance between the player and the body's authored footprint edge. */
export const FOOTPRINT_CLEARANCE = 0.6

/**
 * Fraction of the player's standing height that must lie inside the body's silhouette before a
 * fade shot can honestly claim it "reveals an otherwise occluded player". A third of the figure
 * is unmistakable at 720 px; anything less and the reader is being asked to take the caption's
 * word for it.
 */
export const MIN_REVEAL_COVERAGE = 0.35

export interface FadeGeometry {
  /** Player stand-off from the body centre along the camera axis, beyond the footprint. */
  gap: number
  /** Solved DEV zoom multiplier — body and player both in frame. */
  zoom: number
  /** The SHIPPED aim. A fade shot is about the shipped view, so it does not tilt. */
  lookY: 0
  /** Fraction of the player's standing height covered by the body's silhouette (≥1 = all of it). */
  coverage: number
  /** True when a meaningful, visible part of the player lies inside the silhouette. */
  reveals: boolean
}

/**
 * Solve an occlusion-fade shot: the body between the camera and the player, at the shipped aim,
 * with both in frame — and say honestly whether the player is actually BEHIND the body's
 * rendered silhouette (issue #46 §3).
 *
 * This exists because "the occluder faded" and "the fade revealed the player" are different
 * claims, and the first does not imply the second. The occluder is an AABB over the AUTHORED
 * footprint; the body inside it is the rendered mesh, which for several Wave-3 placements
 * under-fills its lot. Detection therefore fires for bodies whose mesh does not cover the
 * subject at all — a conservative over-fade — and a frame captioned "fades off the player" that
 * shows the player floating above the roofline proves nothing.
 *
 * The geometry, at the shipped aim, in screen-up world units measured from the player's feet:
 *
 *   D = √(CAM_R² + CAM_H²),  k = CAM_R/D,  m = CAM_H/D,  m/k = CAM_H/CAM_R ≈ 1.0607
 *   the body sits `gap` NEARER the camera, so its base drops to  −m·gap
 *   its roofline reaches                                          k·H − m·gap
 *   the player's head reaches                                     k·SUBJECT_HEIGHT
 *
 * so the player is covered iff `H ≥ SUBJECT_HEIGHT + (m/k)·gap`, and `gap` cannot be smaller
 * than the footprint half-extent along the camera axis. A body shorter than its own lot is wide
 * can therefore never cover the subject — which is exactly the case for three of the six Wave 3
 * bodies, and why this returns `reveals` rather than assuming it.
 */
export function fadeGeometry(
  body: BodyDims,
  footprint: { width: number; depth: number },
  fill = 0.72,
): FadeGeometry {
  const d = Math.hypot(CAM_R, CAM_H)
  const k = CAM_R / d
  const m = CAM_H / d
  // Half-extent of the authored footprint along the corner (camera) axis.
  const support = (footprint.width / 2 + footprint.depth / 2) * Math.SQRT1_2
  const gap = +(support + FOOTPRINT_CLEARANCE).toFixed(4)
  const along = alongAxis(body, 'corner')

  const bodyTop = k * body.height - m * gap
  const headTop = k * SUBJECT_HEIGHT
  const coverage = Math.max(0, bodyTop / headTop)

  // Frame everything: the body's nearest ground corner is the lowest point, the higher of the
  // roofline and the player's head is the highest, and the camera centres on the player.
  const bottom = -m * (gap + along / 2)
  const top = Math.max(k * body.height - m * (gap - along / 2), headTop)
  const span = 2 * Math.max(Math.abs(bottom), top)
  return {
    gap,
    zoom: +((fill * VIEWPORT_H) / (BASE_ZOOM * span)).toFixed(4),
    lookY: 0,
    coverage: +coverage.toFixed(4),
    reveals: coverage >= MIN_REVEAL_COVERAGE,
  }
}

/** The shipped manifest row for an asset — so a spec reads the game's numbers, not a copy. */
export function manifestEntry(assetId: string): AssetManifestEntry {
  const entry = ASSET_MANIFEST_BY_ID.get(assetId)
  if (!entry) throw new Error(`manifestEntry: no manifest entry for ${assetId}`)
  return entry
}

/**
 * A body's RENDERED WORLD dimensions, straight from the manifest the game ships — never
 * re-typed into a spec, so a body that changes size reframes itself instead of cropping.
 *
 * `entry.bounds` is stated in MODEL space, before the manifest's own yaw. A ±90° yaw swaps
 * which model axis faces which world axis, and framing solved before the yaw over- or
 * under-fills by exactly that ratio — so the default `yaw` is the entry's OWN rotation rather
 * than 0. Pass `yaw` only for a body whose placement rotates it further.
 */
export function manifestBody(assetId: string, yaw?: number): BodyDims {
  const entry = ASSET_MANIFEST_BY_ID.get(assetId)
  if (!entry?.bounds) throw new Error(`manifestBody: ${assetId} declares no rendered bounds`)
  const { width, height, depth } = entry.bounds
  const swapped = Math.abs(Math.sin(yaw ?? entry.rotation[1])) > 0.5
  return { height, width: swapped ? depth : width, depth: swapped ? width : depth }
}
