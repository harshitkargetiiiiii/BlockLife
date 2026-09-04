import { describe, expect, it } from 'vitest'
import {
  AZIMUTH,
  BASE_ZOOM,
  CAM_H,
  CAM_R,
  PLAYER_Y,
  STANDOFF,
  VIEWPORT_H,
  FOOTPRINT_CLEARANCE,
  MIN_REVEAL_COVERAGE,
  SUBJECT_HEIGHT,
  alongAxis,
  checkFraming,
  fadeGeometry,
  frameFor,
  manifestBody,
  screenRight,
  standBeside,
} from './framing'
import { CAMERA_EYE_HEIGHT, CAMERA_HORIZONTAL_REACH } from '../../src/game/camera/cameraGeometry'
import { ASSET_MANIFEST_BY_ID } from '../../src/game/assets/assetManifest'

/**
 * Issue #46 §5 — the shared framing solver, tested as arithmetic instead of only as a
 * 25-second browser capture.
 *
 * The solver's whole value is that a frame is DERIVED, so the checks that matter are:
 * it really centres what it claims to centre, it really fills what it claims to fill, it
 * refuses the two framings that produce an unjudgeable baseline (a cropped subject, a look
 * target above the camera), and — because it was extracted from a shipped spec — it still
 * returns the exact numbers those committed baselines were captured at.
 */

/** The Wave 3 bodies, as the spec sees them (manifest bounds, world-space after yaw). */
const APARTMENT = manifestBody('building_apartment_01')
const SHOP = manifestBody('building_shop_01')
const GARAGE = manifestBody('building_garage_01')
const HOTEL = manifestBody('building_gate_hotel_01')

describe('visual framing solver', () => {
  it('takes its camera geometry from the game, not from a retyped constant', () => {
    expect(CAM_R).toBe(CAMERA_HORIZONTAL_REACH)
    expect(CAM_H).toBe(CAMERA_EYE_HEIGHT)
    expect(BASE_ZOOM, 'FollowCamera ZOOM_WALKING').toBe(34)
    expect(VIEWPORT_H, 'playwright.config.ts viewport height').toBe(720)
  })

  it('centres the body it is solved for, at the fill it was asked for', () => {
    for (const [label, body, view, gap, fill] of [
      ['apartment corner', APARTMENT, 'corner', 6, 0.8],
      ['shop south', SHOP, 'south', 4.5, 0.7],
      ['hotel corner', HOTEL, 'corner', 7, 0.85],
      ['garage west', GARAGE, 'west', 8, 0.6],
    ] as const) {
      const f = frameFor(body, view, gap, fill)
      const c = checkFraming(body, view, gap, f.zoom, f.lookY)
      expect(c.centreOffset, `${label} centred`).toBeCloseTo(0, 3)
      expect(c.spanFraction, `${label} fill`).toBeCloseTo(fill, 3)
      expect(c.ok, `${label}: ${c.reason}`).toBe(true)
    }
  })

  it('solves the near side too (subject between camera and player)', () => {
    const f = frameFor(GARAGE, 'west', 8, 0.6, 'near')
    const c = checkFraming(GARAGE, 'west', 8, f.zoom, f.lookY, 'near')
    expect(c.centreOffset).toBeCloseTo(0, 3)
    expect(c.spanFraction).toBeCloseTo(0.6, 3)
  })

  it('returns the exact numbers the shipped Wave 3 baselines were captured at', () => {
    // Extraction regression pin: these are what the private solver in
    // tests/visual/wave3-asset-visuals.spec.ts produced before it moved here. A change to any
    // of them reframes a committed baseline, so it has to be a deliberate edit, not a refactor.
    expect(frameFor(APARTMENT, 'corner', 6, 0.8)).toEqual({ lookY: 9.6515, zoom: 1.0093 })
    expect(frameFor(APARTMENT, 'south', 6, 0.8)).toEqual({ lookY: 9.6515, zoom: 1.0778 })
    expect(frameFor(SHOP, 'south', 4.5, 0.7)).toEqual({ lookY: 5.0467, zoom: 2.1807 })
    expect(frameFor(GARAGE, 'west', 8, 0.6, 'near')).toEqual({ lookY: -13.9882, zoom: 2.1026 })
    expect(frameFor(HOTEL, 'corner', 7, 0.85)).toEqual({ lookY: 9.9997, zoom: 0.9777 })
  })

  it('refuses the framings that produce an unjudgeable baseline', () => {
    expect(() => frameFor(APARTMENT, 'corner', 6, 1.4)).toThrow(/cropped/)
    expect(() => frameFor(APARTMENT, 'corner', 6, 0)).toThrow(/fill/)
    expect(() => frameFor({ height: 0, width: 2, depth: 2 }, 'south', 4, 0.6)).toThrow(/height/)
    // A near-side gap past the camera's own reach drives the look target ABOVE the camera,
    // which photographs roof undersides — the failure a hand-tuned lookY hides.
    expect(() => frameFor(APARTMENT, 'corner', CAM_R * 4, 0.8, 'near')).toThrow(/above the camera/)
    expect(frameFor(APARTMENT, 'corner', 6, 0.8).lookY).toBeLessThan(CAM_H)
  })

  it('reports a hand-tuned frame that crops or drifts off centre', () => {
    // A 15 m apartment at the shipped walking zoom: 720 px / 34 px-per-unit ≈ 21 world units
    // of frame, and the body is projected taller than it stands — a 1.0 zoom cannot hold it
    // centred at lookY 0, which is precisely the "looks fine, is cropped" case.
    const bad = checkFraming(APARTMENT, 'corner', 6, 1.0, 0)
    expect(bad.ok).toBe(false)
    expect(bad.reason).toMatch(/off centre|cropped/)
    const good = checkFraming(SHOP, 'south', 4.5, 2.1807, 5.0467)
    expect(good.ok, good.reason).toBe(true)
  })

  it('projects depth as well as height along the camera axis', () => {
    // Solving for height alone under-zooms a deep body: the box's depth also projects
    // vertically in an isometric view.
    const deep = { height: 4, width: 4, depth: 12 }
    expect(alongAxis(deep, 'south')).toBe(12)
    expect(alongAxis(deep, 'east')).toBe(4)
    expect(alongAxis(deep, 'corner')).toBeCloseTo((4 + 12) / Math.SQRT2, 6)
    expect(frameFor(deep, 'south', 5, 0.8).zoom).toBeLessThan(frameFor(deep, 'east', 5, 0.8).zoom)
  })

  it('fadeGeometry says WHETHER a body can hide the player, and does not assume it', () => {
    // The point of the helper: "an occluder faded" and "the fade revealed the player" are
    // different claims. The occluder is an AABB over the AUTHORED footprint; the body inside it
    // is a mesh that may under-fill its lot. A body shorter than its own lot is wide can never
    // get in front of a subject standing outside that lot, at any legal stand-off.
    const cases: [string, BodyDims, { width: number; depth: number }, boolean][] = [
      ['apartment', APARTMENT, { width: 9, depth: 9 }, true],
      ['hotel', HOTEL, { width: 9, depth: 8 }, true],
      ['shop', SHOP, { width: 6, depth: 6 }, false],
      ['garage', GARAGE, { width: 8, depth: 7 }, false],
    ]
    for (const [label, body, footprint, reveals] of cases) {
      const g = fadeGeometry(body, footprint)
      expect(g.lookY, `${label} uses the shipped aim`).toBe(0)
      const support = (footprint.width / 2 + footprint.depth / 2) * Math.SQRT1_2
      expect(g.gap, `${label} clears its footprint`).toBeCloseTo(support + FOOTPRINT_CLEARANCE, 4)
      expect(g.reveals, `${label} reveal classification`).toBe(reveals)
      expect(g.zoom, `${label} zoom is positive`).toBeGreaterThan(0)
      if (reveals) expect(g.coverage).toBeGreaterThanOrEqual(MIN_REVEAL_COVERAGE)
      else expect(g.coverage, `${label} cannot cover the subject at all`).toBe(0)
    }
  })

  it('coverage is the closed-form (H − (CAM_H/CAM_R)·gap) / SUBJECT_HEIGHT, clamped at zero', () => {
    // At the shipped aim the body sits `gap` nearer the camera, which drops its roofline by
    // (CAM_H/CAM_R)·gap of the player's own screen height. Everything about the reveal question
    // follows from that one line, so pin it rather than the three thresholds separately.
    const footprint = { width: 6, depth: 6 }
    const support = (footprint.width / 2 + footprint.depth / 2) * Math.SQRT1_2
    const gap = support + FOOTPRINT_CLEARANCE
    const drop = (CAM_H / CAM_R) * gap
    const coverageOf = (height: number) => fadeGeometry({ height, width: 6, depth: 6 }, footprint).coverage

    // Three regimes: nothing, partial, all of the figure.
    expect(coverageOf(drop - 0.5), 'roofline below the player s feet').toBe(0)
    expect(coverageOf(drop + 0.9)).toBeCloseTo(0.9 / SUBJECT_HEIGHT, 3)
    expect(coverageOf(drop + SUBJECT_HEIGHT + 2)).toBeCloseTo((SUBJECT_HEIGHT + 2) / SUBJECT_HEIGHT, 3)

    // …and `reveals` is that coverage against the declared minimum, nothing else.
    expect(fadeGeometry({ height: drop + MIN_REVEAL_COVERAGE * SUBJECT_HEIGHT + 0.01, width: 6, depth: 6 }, footprint).reveals).toBe(true)
    expect(fadeGeometry({ height: drop + MIN_REVEAL_COVERAGE * SUBJECT_HEIGHT - 0.01, width: 6, depth: 6 }, footprint).reveals).toBe(false)
  })

  it('screenRight is a unit vector that rotates with the DEV orbit', () => {
    for (const az of [0, Math.PI / 2, Math.PI, -Math.PI / 4]) {
      const [x, z] = screenRight(az)
      expect(Math.hypot(x, z), `azimuth ${az}`).toBeCloseTo(1, 9)
    }
    // At the shipped view the camera sits up-right-back, so screen right is world (+x, −z).
    const [x0, z0] = screenRight(0)
    expect(x0).toBeCloseTo(Math.SQRT1_2, 9)
    expect(z0).toBeCloseTo(-Math.SQRT1_2, 9)
    // Standing beside a subject moves along that axis and nowhere else.
    const at = standBeside([10, -4], 3, 0)
    expect(at[0]).toBeCloseTo(10 + 3 * Math.SQRT1_2, 6)
    expect(at[1]).toBeCloseTo(-4 - 3 * Math.SQRT1_2, 6)
  })

  it('reads body dimensions from the shipped manifest, and yaws them', () => {
    // An unrotated entry reads straight through.
    const shop = ASSET_MANIFEST_BY_ID.get('building_shop_01')!
    expect(shop.rotation[1]).toBe(0)
    expect(SHOP).toEqual({ height: shop.bounds!.height, width: shop.bounds!.width, depth: shop.bounds!.depth })
    // A ±90° entry rotation swaps which model axis faces which world axis, by DEFAULT — the
    // yaw is read from the manifest rather than retyped beside the call.
    const hotel = ASSET_MANIFEST_BY_ID.get('building_gate_hotel_01')!
    expect(Math.abs(hotel.rotation[1])).toBeCloseTo(Math.PI / 2, 9)
    expect(HOTEL.width).toBe(hotel.bounds!.depth)
    expect(HOTEL.depth).toBe(hotel.bounds!.width)
    expect(HOTEL.height).toBe(hotel.bounds!.height)
    // …and an explicit yaw overrides it.
    expect(manifestBody('building_gate_hotel_01', 0).width).toBe(hotel.bounds!.width)
    expect(() => manifestBody('no_such_asset_id')).toThrow(/rendered bounds/)
  })

  it('every compass view has a matching azimuth and stand-off normal', () => {
    for (const view of Object.keys(AZIMUTH) as (keyof typeof AZIMUTH)[]) {
      const [nx, nz] = STANDOFF[view]
      expect(Math.hypot(nx, nz), `${view} stand-off is a unit normal`).toBeCloseTo(1, 9)
    }
    expect(PLAYER_Y, 'the camera aims at the player transform, not the ground').toBeGreaterThan(0)
  })
})
