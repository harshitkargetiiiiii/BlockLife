import { expect, test, type Page } from '@playwright/test'
import { mkdirSync, writeFileSync } from 'node:fs'
import sharp from 'sharp'
import { settleAndPause, waitForSceneSettled } from './visualHelpers'

/**
 * Issue #50 — rendered evidence for masked paint and wheel styles on the REAL Meshy sports body.
 *
 * Deliberately NOT a `toHaveScreenshot` suite. It owns no baselines and updates none. It captures
 * the frames a reviewer has to look at, and it measures — on the real rendered pixels, after
 * filtering and mipmaps, at real distances — the claims a screenshot alone cannot settle.
 *
 * The measurement design matters, because the obvious version of it is wrong. Comparing "pixels
 * that are dark in BOTH frames" silently excludes the exact failure it claims to exclude: a window
 * that goes from dark to a bright paint tint drops out of the denominator. So the check here is
 * ONE-DIRECTIONAL — pixels that are dark in the reference frame must STILL be dark after the
 * repaint, which is a leak detector rather than a tautology.
 *
 * Every comparison is made on ONE instance in ONE pose with only the customization changed, so the
 * geometry cannot shift between frames and a pixel difference can only be the recolor.
 *
 * What this file does NOT claim: that the mask corresponds to a semantic list of parts. It is a
 * hue classification of the atlas. The close-ups it writes are what a reviewer looks at to judge
 * glass, lamps, tyres and trim; the numbers below bound the leakage, they do not identify parts.
 */

const OUT = 'docs/review/issue-50/evidence'
type Api = Record<string, (...a: unknown[]) => unknown>

function api(page: Page, method: string, ...args: unknown[]) {
  return page.evaluate(([m, a]) => (window.GAME_TEST_API as unknown as Api)[m as string](...(a as unknown[])), [method, args] as const)
}

/** The open central plaza — the framing Wave 1's own vehicle shots settled on. */
const STAGE: [number, number] = [0, 0]
const VIEWER: [number, number] = [0, 4]

async function boot(page: Page): Promise<void> {
  await page.goto('/')
  await page.waitForFunction(() => window.GAME_TEST_API?.ready() === true, undefined, { timeout: 45_000 })
  await waitForSceneSettled(page)
}

async function arrange(page: Page, at: [number, number], zoom: number, azimuth = 0): Promise<void> {
  await page.evaluate(
    ([pos, z, az]) => {
      const a = window.GAME_TEST_API!
      a.resetGame()
      a.setTime(13)
      a.setWeather('clear')
      // Freeze the CLOCK, not the frame loop. Two shots that differ only by a paint must not also
      // differ by the sun having moved between them, and stopping time at the source is honest
      // where widening the pixel tolerance to absorb it would not be. Rendering still advances, so
      // the camera and the asset graph settle normally.
      a.setTimeScale(0)
      a.teleportPlayer([(pos as number[])[0], 1.2, (pos as number[])[1]])
      a.setCameraZoomMul(z as number)
      a.setCameraAzimuth(az as number)
    },
    [at, zoom, azimuth] as const,
  )
  await api(page, 'setMoney', 100000)
}

/** Pin the shell to the staging pose. Re-issued after settle: it is seated above the ground. */
async function place(page: Page, yaw: number): Promise<void> {
  await page.evaluate(
    ([pos, y]) => window.GAME_TEST_API!.setDrivenCarPosition(pos as [number, number], y as number),
    [STAGE, yaw] as const,
  )
}

/** Own a sports car, project it onto the shell and pin it to a fixed pose in the plaza. */
async function stageSports(page: Page, zoom: number, yaw = Math.PI / 4, azimuth = 0): Promise<string> {
  await arrange(page, VIEWER, zoom, azimuth)
  const id = (await api(page, 'vehicleGrant', 'veh_sports', { location: 'active' })) as string
  await page.waitForTimeout(200)
  await place(page, yaw)
  await page.waitForTimeout(900)
  await place(page, yaw)
  await waitForSceneSettled(page, { requireGlb: ['vehicle_sports_car_01'], timeout: 25_000 })
  await settleAndPause(page)
  return id
}

/**
 * Change a customization on the STAGED car and re-freeze the same pose.
 *
 * Paint and wheel changes are gated on standing in the authored service bay (issue #19 section 7/9),
 * which is the whole point — this drives the SHIPPED customization path, not a debug write. So the
 * player walks there, the change is applied and asserted to have taken, and the player returns to
 * the staging viewpoint; the car is re-pinned to the identical pose, so the only thing that differs
 * between two frames is the customization.
 */
async function recustomize(
  page: Page,
  id: string,
  apply: () => Promise<unknown>,
  expected: { paint?: string; wheels?: string },
  yaw: number,
): Promise<void> {
  await page.evaluate(() => window.GAME_TEST_API!.pauseWorld(false))
  expect(await api(page, 'vehicleStandAtAnchor', 'park_service'), 'reached the service bay').toBe(true)
  await apply()
  const state = (await api(page, 'getVehicleState')) as {
    assets: Record<string, { customization: { paint: string; wheels: string } }>
  }
  const saved = state.assets[id].customization
  if (expected.paint) expect(saved.paint, 'the paint was SAVED, not just requested').toBe(expected.paint)
  if (expected.wheels) expect(saved.wheels, 'the wheel style was SAVED, not just requested').toBe(expected.wheels)
  await api(page, 'teleportPlayer', [VIEWER[0], 1.2, VIEWER[1]])
  await place(page, yaw)
  await page.waitForTimeout(400)
  await place(page, yaw)
  await waitForSceneSettled(page, { requireGlb: ['vehicle_sports_car_01'], timeout: 25_000 })
  await settleAndPause(page)
}

interface Rect { x: number; y: number; width: number; height: number }
/**
 * The staged car's own pixels at `STAGE_ZOOM`, measured from the first captures: the body spans
 * x 775-890, y 118-345. The clip starts below y = 130 so the top-right HUD panel is never in it,
 * and stops before the citizens standing to its right.
 */
const CAR: Rect = { x: 752, y: 132, width: 190, height: 215 }
const STAGE_ZOOM = 2.0
/**
 * The FRONT near wheel and the tarmac under it, in the three-quarter staging below — not both
 * wheels, and it proves nothing about the far side. Read off the committed
 * `08-wheels-standard-full.png` rather than guessed: an earlier crop ended at x = 890 while the car
 * started at x = 915, so it measured the empty plaza and would have "passed" on anything. Whole-car
 * fit across all four wheels is settled by `src/game/assets/wheelClearance.test.ts`, on geometry.
 */
const WHEELS: Rect = { x: 820, y: 232, width: 190, height: 100 }

async function shoot(page: Page, name: string, clip?: Rect) {
  mkdirSync(OUT, { recursive: true })
  const buffer = await page.screenshot(clip ? { clip } : undefined)
  writeFileSync(`${OUT}/${name}.png`, buffer)
  return buffer
}

interface Frame { width: number; height: number; data: Buffer; channels: number }
async function decode(png: Buffer): Promise<Frame> {
  const { data, info } = await sharp(png).raw().toBuffer({ resolveWithObject: true })
  return { width: info.width, height: info.height, data: Buffer.from(data), channels: info.channels }
}
const pixel = (f: Frame, i: number) => [f.data[i * f.channels], f.data[i * f.channels + 1], f.data[i * f.channels + 2]]

/** Mean colour of the chromatic pixels — the body panels, ignoring road, shadow and neutral grey. */
function dominantColour(f: Frame): { r: number; g: number; b: number; n: number } {
  let r = 0
  let g = 0
  let b = 0
  let n = 0
  for (let i = 0; i < f.width * f.height; i++) {
    const [R, G, B] = pixel(f, i)
    const max = Math.max(R, G, B)
    if (max < 60 || max - Math.min(R, G, B) < 30) continue
    r += R
    g += G
    b += B
    n++
  }
  return n === 0 ? { r: 0, g: 0, b: 0, n: 0 } : { r: r / n, g: g / n, b: b / n, n }
}

/** Which candidate colour a measured colour is nearest, by normalized chromaticity. */
function nearest(m: { r: number; g: number; b: number }, candidates: Record<string, string>): string {
  const norm = (r: number, g: number, b: number) => {
    const s = r + g + b || 1
    return [r / s, g / s, b / s]
  }
  const [mr, mg, mb] = norm(m.r, m.g, m.b)
  let best = ''
  let bestD = Infinity
  for (const [name, hex] of Object.entries(candidates)) {
    const [cr, cg, cb] = norm(parseInt(hex.slice(1, 3), 16), parseInt(hex.slice(3, 5), 16), parseInt(hex.slice(5, 7), 16))
    const d = (mr - cr) ** 2 + (mg - cg) ** 2 + (mb - cb) ** 2
    if (d < bestD) {
      bestD = d
      best = name
    }
  }
  return best
}

/** A sub-rectangle of an already-decoded frame, in that frame's own coordinates. */
function sub(f: Frame, r: Rect): Frame {
  const out = Buffer.alloc(r.width * r.height * f.channels)
  for (let y = 0; y < r.height; y++) {
    const from = ((r.y + y) * f.width + r.x) * f.channels
    f.data.copy(out, y * r.width * f.channels, from, from + r.width * f.channels)
  }
  return { width: r.width, height: r.height, data: out, channels: f.channels }
}

/**
 * Regions a human has LOOKED at in the committed close-ups and identified as surfaces the paint
 * must not reach, in `CAR`-clip coordinates. Named rather than derived, because "which pixels are
 * the windscreen" is a judgement about an image, and pretending a colour threshold makes that
 * judgement is how an overclaim gets built.
 *
 * The earlier version of this check compared "pixels dark in BOTH frames", which is worse than
 * useless: a window lifted into a bright paint drops straight out of that denominator, and on a
 * CHARCOAL car the body panels are dark too and are SUPPOSED to change. Fixed regions on a frozen,
 * identical pose have neither problem.
 */
const GLASS: Rect = { x: 52, y: 82, width: 48, height: 24 }
const REAR_WINDOW: Rect = { x: 52, y: 16, width: 40, height: 12 }

/** How many pixels moved at all — the panels, which SHOULD move. */
function changed(before: Frame, after: Frame, tolerance = 12) {
  let n = 0
  for (let i = 0; i < before.width * before.height; i++) {
    const [ar, ag, ab] = pixel(before, i)
    const [br, bg, bb] = pixel(after, i)
    if (Math.max(Math.abs(ar - br), Math.abs(ag - bg), Math.abs(ab - bb)) > tolerance) n++
  }
  return { changed: n, pixels: before.width * before.height }
}

const PALETTE = { paper: '#d7e6ee', terracotta: '#c25b52', blue: '#5b7fc2', green: '#4c956c', amber: '#e2b04a', charcoal: '#2c2c33' }

test.describe('issue #50 — saved paint and wheels are visible on the approved sports body', () => {
  /**
   * Split per paint, one service-bay round trip each. Each visit is a cross-sector teleport plus a
   * full settle (~20 s measured), so three of them in one case ran past the 90 s deadline — two
   * cases of one visit is a better answer than inflating the timeout.
   */
  for (const [slug, colour] of [['charcoal', PALETTE.charcoal], ['blue', PALETTE.blue]] as const) {
    test(`a saved ${slug} paint renders on the body, and the glass does not follow it`, async ({ page }) => {
      await boot(page)
      const yaw = Math.PI / 4
      const id = await stageSports(page, STAGE_ZOOM, yaw)
      // The class default paint, as the "before" a reviewer compares against.
      const index = slug === 'charcoal' ? '02' : '03'
      await shoot(page, '01-default-paint-full')
      const before = await decode(await shoot(page, '01-default-paint', CAR))

      await recustomize(page, id, () => api(page, 'vehiclePaint', id, colour), { paint: colour }, yaw)
      await shoot(page, `${index}-${slug}-full`)
      const after = await decode(await shoot(page, `${index}-${slug}`, CAR))

      // 1. The body wears the colour that was SAVED, not the authored yellow.
      const measured = dominantColour(after)
      if (slug === 'blue') {
        expect(measured.n, 'the car occupies a usable part of the clip').toBeGreaterThan(1500)
        expect(
          nearest(measured, PALETTE),
          `${slug} frame rgb(${measured.r.toFixed(0)},${measured.g.toFixed(0)},${measured.b.toFixed(0)})`,
        ).toBe('blue')
      }
      // Charcoal is a near-neutral, which the chromatic measure above is deliberately blind to, so
      // it is judged by the committed frame instead of by a metric invented to pass it.

      // 2. The panels really moved...
      expect(changed(before, after).changed, 'the panels changed').toBeGreaterThan(1500)

      // 3. ...and the glass did not. These two rectangles are the windscreen and the rear window in
      //    the committed close-ups; the pose is frozen and identical, so a pixel that moved inside
      //    them is the recolor reaching a surface it must not reach.
      for (const [name, roi] of [['windscreen', GLASS], ['rear window', REAR_WINDOW]] as const) {
        const moved = changed(sub(before, roi), sub(after, roi))
        expect(moved.changed, `${name} unchanged across a repaint (${moved.changed}/${moved.pixels} px)`)
          .toBeLessThan(moved.pixels * 0.02)
      }
    })
  }

  test('close up: glass, lamps, tyres and trim at inspection distance', async ({ page }) => {
    // The numbers above BOUND the leakage; these are the frames a reviewer looks at to judge the
    // surfaces that must not change, and to check the panel seams and creases for missed texels.
    // Charcoal and the near-white paper are the two hardest cases against an authored yellow.
    await boot(page)
    const yaw = Math.PI / 4
    const id = await stageSports(page, 3.0, yaw)
    await shoot(page, '04-closeup-default-paint')
    await recustomize(page, id, () => api(page, 'vehiclePaint', id, PALETTE.charcoal), { paint: PALETTE.charcoal }, yaw)
    await shoot(page, '05-closeup-charcoal')
    await recustomize(page, id, () => api(page, 'vehiclePaint', id, PALETTE.paper), { paint: PALETTE.paper }, yaw)
    await shoot(page, '06-closeup-paper')
    // No colour assertion on `paper`: it is a near-neutral, and the chromatic measure above is
    // deliberately blind to neutrals. Its value is as a REVIEWED frame, and saying so is more
    // honest than inventing a metric that would pass for the wrong reason.
  })

  test('two contrasting sports cars in ONE frame stay independent', async ({ page }) => {
    // The material-identity unit test proves the clone; this proves the rendered consequence, with
    // both bodies loaded from the SAME file, sharing one compiled program, in a single frame.
    await boot(page)
    await arrange(page, [27, 16], 1.55)
    const a = (await api(page, 'vehicleGrant', 'veh_sports', { location: 'parked', anchorId: 'park_dealer_a' })) as string
    const b = (await api(page, 'vehicleGrant', 'veh_sports', { location: 'parked', anchorId: 'park_dealer_b' })) as string
    expect(await api(page, 'vehicleStandAtAnchor', 'park_service'), 'reached the service bay').toBe(true)
    await api(page, 'vehiclePaint', a, PALETTE.terracotta)
    await api(page, 'vehiclePaint', b, PALETTE.green)
    const state = (await api(page, 'getVehicleState')) as {
      assets: Record<string, { customization: { paint: string } }>
    }
    expect(state.assets[a].customization.paint).toBe(PALETTE.terracotta)
    expect(state.assets[b].customization.paint).toBe(PALETTE.green)
    await api(page, 'teleportPlayer', [27, 1.2, 16])
    await waitForSceneSettled(page, { requireGlb: ['vehicle_sports_car_01'], timeout: 25_000 })
    await settleAndPause(page)
    await shoot(page, '07-two-instances-full')

    // Measured from the first capture: `park_dealer_a` frames above the player, `park_dealer_b`
    // to their right. Both clips are body-only — no HUD, no other vehicle.
    const first = dominantColour(await decode(await shoot(page, '07-two-instances-dealer-a', { x: 660, y: 45, width: 200, height: 150 })))
    const second = dominantColour(await decode(await shoot(page, '07-two-instances-dealer-b', { x: 885, y: 215, width: 195, height: 145 })))
    expect(first.n, 'dealer_a car in frame').toBeGreaterThan(1000)
    expect(second.n, 'dealer_b car in frame').toBeGreaterThan(1000)
    expect(nearest(first, PALETTE), `dealer_a rgb(${first.r.toFixed(0)},${first.g.toFixed(0)},${first.b.toFixed(0)})`).toBe('terracotta')
    expect(nearest(second, PALETTE), `dealer_b rgb(${second.r.toFixed(0)},${second.g.toFixed(0)},${second.b.toFixed(0)})`).toBe('green')
  })

  /**
   * Split into two cases on purpose. Each service-bay visit is a cross-sector round trip plus a
   * full settle, measured at roughly 20 s; four of them in one case ran past the 90 s deadline.
   * Two cases of two visits each fit comfortably, which is a better answer than inflating the
   * timeout to hide the cost.
   */
  test('an off-road wheel style is visibly larger on the same body', async ({ page }) => {
    await boot(page)
    // The shipped camera already looks along a pi/4 diagonal, so ROTATING it to pi/4 as well while
    // turning the car to pi/2 put the two headings back in line and produced another head-on shot.
    // Camera at its default with the car at yaw 0 is the three-quarter view that actually shows the
    // near flank, both wheels and their contact patches.
    const yaw = 0
    const id = await stageSports(page, 2.4, yaw)
    await shoot(page, '08-wheels-standard-full')
    const standard = await decode(await shoot(page, '08-wheels-standard', WHEELS))

    await recustomize(page, id, () => api(page, 'vehicleSetWheels', id, 'wheels_offroad'), { wheels: 'wheels_offroad' }, yaw)
    await shoot(page, '09-wheels-offroad-full')
    const offroad = await decode(await shoot(page, '09-wheels-offroad', WHEELS))

    // The ROI is the two wheels and the tarmac under them, read off `08-wheels-standard-full.png`.
    // A 1.18x radius on a wheel this size is tens of pixels, so the change must be real but small.
    // MEASURED at the clamp, not at the advertised size. This body's arches clear 1.04 and collide
    // at 1.05 (`wheelClearance.test.ts`), so the off-road style renders at 1.04 and moves 112 px in
    // this ROI — a real, visible change, and a small one. Asserting a number that only 1.18 could
    // reach would be asserting a defect.
    const moved = changed(standard, offroad)
    expect(moved.changed, 'the clamped off-road wheel is measurably larger').toBeGreaterThan(40)
    expect(moved.changed / moved.pixels, 'and it is a WHEEL change, not a whole-body one').toBeLessThan(0.35)
  })

  test('a wheel style round trip returns the body exactly to where it started', async ({ page }) => {
    await boot(page)
    const yaw = 0
    const id = await stageSports(page, 2.4, yaw)
    const before = await decode(await shoot(page, '10-roundtrip-standard-before', WHEELS))
    await recustomize(page, id, () => api(page, 'vehicleSetWheels', id, 'wheels_offroad'), { wheels: 'wheels_offroad' }, yaw)
    await recustomize(page, id, () => api(page, 'vehicleSetWheels', id, 'wheels_standard'), { wheels: 'wheels_standard' }, yaw)
    const after = await decode(await shoot(page, '10-roundtrip-standard-after', WHEELS))
    // The wheel transform is SET, never multiplied, so two style changes must leave the same pose
    // as none. A cumulative bug would show as a wheel that has grown 1.18x and stayed.
    expect(changed(before, after).changed, 'a style round trip is not cumulative').toBeLessThan(120)
  })

  /**
   * The body must reach readiness ON ITS OWN, in EITHER completion order.
   *
   * This body loads two resources — the model and its contribution map — and they are requested in
   * parallel, so which one finishes first is a race. Moving the map to a state update could
   * accidentally wake a boundary whose model was ALREADY loaded when the map arrived, while leaving
   * the opposite order (map first, model later) still stuck. That is a race to test, not a
   * diagnosis to assume, so each order is forced with a bounded route delay.
   *
   * No nudge, no store mutation, no extra sleep, no raised deadline: the only thing waited on is
   * the scene-ready predicate every other visual spec uses.
   */
  for (const [name, slow, delayMs] of [
    ['the contribution map arrives FIRST', '**/sports_car_01.glb', 4000],
    ['the model arrives FIRST', '**/sports_car_01_paint_contribution.png', 4000],
  ] as const) {
    test(`the sports body reaches readiness unaided when ${name}`, async ({ page }) => {
      const seen: string[] = []
      page.on('requestfinished', (r) => {
        if (r.url().includes('sports_car_01')) seen.push(r.url().split('/').pop()!)
      })
      // Installed before navigation so it applies to the very first request of either resource.
      await page.route(slow, async (route) => {
        await new Promise((resolve) => setTimeout(resolve, delayMs))
        await route.continue()
      })
      await boot(page)
      await arrange(page, VIEWER, STAGE_ZOOM)
      await api(page, 'vehicleGrant', 'veh_sports', { location: 'active' })
      // The assertion IS this wait: nothing else touches the page between the grant and it.
      await waitForSceneSettled(page, { requireGlb: ['vehicle_sports_car_01'], timeout: 30_000 })
      const readiness = (await api(page, 'getAssetReadiness')) as { glbActive: string[]; glbPending: unknown[] }
      expect(readiness.glbActive, 'the body is the thing on screen').toContain('vehicle_sports_car_01')
      expect(readiness.glbPending, 'and nothing is left in flight').toEqual([])
      // Both resources really were fetched, and in the order this case forced.
      expect(seen.filter((n) => n.endsWith('.glb'))).toHaveLength(1)
      expect(seen.filter((n) => n.endsWith('.png'))).toHaveLength(1)
      expect(seen[0], `${name}: observed order ${JSON.stringify(seen)}`).toBe(
        slow.endsWith('.glb') ? 'sports_car_01_paint_contribution.png' : 'sports_car_01.glb',
      )
    })
  }

  test('the player and their wardrobe are untouched by any of this', async ({ page }) => {
    await boot(page)
    const before = { appearance: await api(page, 'getAppearance'), unlocks: await api(page, 'getWardrobeUnlocks') }
    const yaw = Math.PI / 4
    const id = await stageSports(page, STAGE_ZOOM, yaw)
    await recustomize(page, id, () => api(page, 'vehiclePaint', id, PALETTE.amber), { paint: PALETTE.amber }, yaw)
    const after = { appearance: await api(page, 'getAppearance'), unlocks: await api(page, 'getWardrobeUnlocks') }
    expect(after, 'player appearance and wardrobe unlocks unchanged').toEqual(before)
    await shoot(page, '11-player-beside-painted-sports')
  })
})
