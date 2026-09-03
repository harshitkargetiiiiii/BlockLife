import { expect, test, type Page } from '@playwright/test'
import { boot, settleAndPause } from './visualHelpers'

/**
 * Issue #42 Integration Wave 2 — required visual acceptance evidence.
 *
 * The three Wave-2 props (vintage lantern streetlight / fire hydrant / trash bin) project onto
 * EXISTING authored prop types. Nothing here proves gameplay — every placement id, collider,
 * `PROP_SOLIDITY` entry and `PROP_PLACEMENT` envelope is unchanged and is gated at the unit
 * level in `wave2Contract.test.ts` and `wave2Props.test.tsx`. These baselines prove what a code
 * diff cannot: that each body sits ON the ground, reads as the object it replaces, carries no
 * pseudo-text, is not doubled by the primitive it replaced, still lights the street at night
 * without self-glowing by day, and falls back completely when its file is missing.
 *
 * The world is PAUSED before each shot, which snaps actors to canonical poses for
 * pixel-determinism. 3D-world shots allow a small pixel-diff ratio (low-poly AA on device pixels).
 */

const SHOT = { maxDiffPixelRatio: 0.02 }

/** Authored placements, straight out of cityLayout.ts. */
const LAMP_CENTRAL: [number, number] = [0, 22] // prop_street_lamp_06, central ring south sidewalk
const LAMP_EAST: [number, number] = [43, -2] // prop_street_lamp_i1, east industrial approach
const HYDRANT_WATERFRONT: [number, number] = [-42.8, -17.6] // prop_hydrant_w1, West Commons kerb
const HYDRANT_CENTRAL: [number, number] = [-21.5, -6] // prop_hydrant_01, Corner Café sidewalk
const BIN_SOUTH: [number, number] = [19.9, 41.8] // prop_trash_can_s1, open south sidewalk
const BIN_EAST: [number, number] = [43.6, 21.6] // prop_trash_can_i1
const BIN_PARK: [number, number] = [-8, 6.8] // prop_trash_can_03, central park edge

/**
 * World-space SCREEN-RIGHT unit vector for a given DEV orbit azimuth.
 *
 * `FollowCamera` sits at `player + (12, 18, 12)` and looks at the player, so at azimuth 0 the
 * camera's right axis is `normalize(cross(forward, up))` = `(+√½, 0, −√½)` — i.e. world `+x, −z`.
 * `setCameraAzimuth` rotates that camera offset about Y, so the right axis rotates with it.
 *
 * Deriving this matters: the obvious "stand a bit off the prop" offset (`+x, +z`) is almost
 * exactly the screen-VERTICAL axis here, which puts the subject directly behind the player's
 * body. The first capture pass did precisely that and buried a hydrant and a bin.
 */
function screenRight(azimuth: number): [number, number] {
  const x = Math.SQRT1_2
  const z = -Math.SQRT1_2
  return [x * Math.cos(azimuth) + z * Math.sin(azimuth), -x * Math.sin(azimuth) + z * Math.cos(azimuth)]
}

/** Stand the player `gap` world units to the screen-RIGHT of the prop, so the prop reads clear
 *  to the LEFT of the player's body at the same screen height — never behind it. */
function standBeside(prop: [number, number], gap: number, azimuth: number): [number, number] {
  const [rx, rz] = screenRight(azimuth)
  return [prop[0] + rx * gap, prop[1] + rz * gap]
}

interface Framing {
  gap: number
  zoom: number
  azimuth?: number
  hour?: number
  lookY?: number
}

async function frameProp(page: Page, prop: [number, number], f: Framing) {
  const azimuth = f.azimuth ?? 0
  const at = standBeside(prop, f.gap, azimuth)
  await page.evaluate(
    ([pos, h, z, az, ly]) => {
      const a = window.GAME_TEST_API!
      a.resetGame()
      a.setTime(h as number)
      a.setWeather('clear')
      a.teleportPlayer([(pos as number[])[0], 1.2, (pos as number[])[1]])
      a.setCameraZoomMul(z as number)
      a.setCameraAzimuth(az as number) // DEV orbit delta; 0 = the shipped default view
      a.setCameraLookY(ly as number)
    },
    [at, f.hour ?? 13, f.zoom, azimuth, f.lookY ?? 0] as const,
  )
  await settleAndPause(page)
}

/** Three well-separated orbits; the prop stays beside the player at every one. */
const ANGLES: [string, number, string][] = [
  ['front', 0, 'shipped default view'],
  ['quarter', Math.PI / 2, 'orbited 90°'],
  ['rear', Math.PI, 'orbited 180° — the opposite side'],
]

// --------------------------------------------------------- streetlight ----
// The approved body is a vintage shepherd's-crook lantern: the pole runs up the placement origin
// and the lantern hangs forward off the crook. These angles are where a wrong scale, a floating
// base or a duplicated procedural pole would show.
test.describe('Wave 2 — streetlight', () => {
  for (const [name, azimuth, why] of ANGLES) {
    test(`isolated ${name} — ${why}: full height, base on the pavement`, async ({ page }) => {
      await boot(page)
      await frameProp(page, LAMP_CENTRAL, { gap: 3.4, zoom: 2.8, azimuth, lookY: 1.1 })
      await expect(page).toHaveScreenshot(`wave2-streetlight-${name}.png`, SHOT)
    })
  }

  // Day: the baked atlas must NOT self-glow — there is no emissive material in the file, and the
  // repo's bulb sits at 0.05 intensity until dusk.
  test('day close read — the lantern is lit by the sun, not by itself', async ({ page }) => {
    await boot(page)
    await frameProp(page, LAMP_CENTRAL, { gap: 2.4, zoom: 4.2, hour: 12, lookY: 1.35 })
    await expect(page).toHaveScreenshot('wave2-streetlight-day-head.png', SHOT)
  })

  // Night: the SAME body with the repo's functional illumination — the emissive bulb inside the
  // model's own lantern plus the warm pool it casts on the pavement.
  test('night close read — the retained bulb lights the model’s own lantern', async ({ page }) => {
    await boot(page)
    await frameProp(page, LAMP_CENTRAL, { gap: 2.4, zoom: 4.2, hour: 22, lookY: 1.35 })
    await expect(page).toHaveScreenshot('wave2-streetlight-night-head.png', SHOT)
  })

  test('night wide — the ground pool still lights the street', async ({ page }) => {
    await boot(page)
    await frameProp(page, LAMP_CENTRAL, { gap: 3.4, zoom: 2.8, hour: 22, lookY: 1.1 })
    await expect(page).toHaveScreenshot('wave2-streetlight-night.png', SHOT)
  })

  test('city context — central ring, among the other street furniture', async ({ page }) => {
    await boot(page)
    await frameProp(page, LAMP_CENTRAL, { gap: 8, zoom: 1 })
    await expect(page).toHaveScreenshot('wave2-streetlight-context-central.png', SHOT)
  })

  test('city context — east industrial approach (second district)', async ({ page }) => {
    await boot(page)
    await frameProp(page, LAMP_EAST, { gap: 8, zoom: 1 })
    await expect(page).toHaveScreenshot('wave2-streetlight-context-east.png', SHOT)
  })
})

// ------------------------------------------------------------- hydrant ----
// The approved body is the CORRECTED retry: the first attempt cast pseudo-text ("FAWIS CAINER")
// in relief into the barrel. The close-up below is the framing that has to prove it is gone.
test.describe('Wave 2 — fire hydrant', () => {
  for (const [name, azimuth, why] of ANGLES) {
    test(`isolated ${name} — ${why}: cap, barrel, outlets and kerb contact`, async ({ page }) => {
      await boot(page)
      await frameProp(page, HYDRANT_WATERFRONT, { gap: 2.2, zoom: 6, azimuth, lookY: 0.3 })
      await expect(page).toHaveScreenshot(`wave2-hydrant-${name}.png`, SHOT)
    })
  }

  test('close-up — the barrel is smooth and BLANK (no pseudo-text, no cast lettering)', async ({ page }) => {
    await boot(page)
    await frameProp(page, HYDRANT_WATERFRONT, { gap: 1.4, zoom: 9, lookY: -0.55 })
    await expect(page).toHaveScreenshot('wave2-hydrant-closeup-blank-barrel.png', SHOT)
  })

  test('close-up, opposite side — the other half of the barrel is blank too', async ({ page }) => {
    await boot(page)
    await frameProp(page, HYDRANT_WATERFRONT, { gap: 1.4, zoom: 9, azimuth: Math.PI, lookY: -0.55 })
    await expect(page).toHaveScreenshot('wave2-hydrant-closeup-blank-barrel-rear.png', SHOT)
  })

  test('city context — West Commons waterfront kerb', async ({ page }) => {
    await boot(page)
    // Orbited 180° and kept close: from the shipped angle the West Commons block stands between
    // the camera and this kerb, and the subject vanishes behind its roof.
    await frameProp(page, HYDRANT_WATERFRONT, { gap: 3.2, zoom: 2.4, azimuth: Math.PI, lookY: -0.5 })
    await expect(page).toHaveScreenshot('wave2-hydrant-context-waterfront.png', SHOT)
  })

  test('city context — central Corner Café sidewalk (second district)', async ({ page }) => {
    await boot(page)
    // Orbited 180° and kept close: this hydrant is boxed in by the Corner Café (shipped angle)
    // and Sunrise Apartments (90° orbit), either of which swallows the subject at a wide stand-off.
    await frameProp(page, HYDRANT_CENTRAL, { gap: 3.2, zoom: 2.4, azimuth: Math.PI, lookY: -0.5 })
    await expect(page).toHaveScreenshot('wave2-hydrant-context-central.png', SHOT)
  })
})

// ------------------------------------------------------------ trash bin ----
test.describe('Wave 2 — trash bin', () => {
  for (const [name, azimuth, why] of ANGLES) {
    test(`isolated ${name} — ${why}: lid, body and ground contact`, async ({ page }) => {
      await boot(page)
      await frameProp(page, BIN_SOUTH, { gap: 2.2, zoom: 5.5, azimuth, lookY: 0.45 })
      await expect(page).toHaveScreenshot(`wave2-trashbin-${name}.png`, SHOT)
    })
  }

  test('city context — south district sidewalk', async ({ page }) => {
    await boot(page)
    await frameProp(page, BIN_SOUTH, { gap: 6, zoom: 1.6 })
    await expect(page).toHaveScreenshot('wave2-trashbin-context-south.png', SHOT)
  })

  test('city context — east industrial (second district)', async ({ page }) => {
    await boot(page)
    await frameProp(page, BIN_EAST, { gap: 6, zoom: 1.6 })
    await expect(page).toHaveScreenshot('wave2-trashbin-context-east.png', SHOT)
  })

  test('city context — central park edge (third district)', async ({ page }) => {
    await boot(page)
    await frameProp(page, BIN_PARK, { gap: 6, zoom: 1.6 })
    await expect(page).toHaveScreenshot('wave2-trashbin-context-central-park.png', SHOT)
  })
})

// -------------------------------------------------------------- fallback ----
/**
 * The missing/corrupt-model path, photographed for real. The GLB request is aborted at the
 * network layer BEFORE the page loads, so `useGLTF` throws, `AssetErrorBoundary` catches, and the
 * complete original procedural prop renders in its place. Nothing in the app is stubbed or
 * disabled: this is exactly what a deleted or truncated file would do in production.
 */
test.describe('Wave 2 — fallback when a model is missing', () => {
  test('an unreachable hydrant GLB renders the complete procedural hydrant', async ({ page }) => {
    await page.route('**/prop_fire_hydrant_01.glb', (route) => route.abort())
    await boot(page)
    await frameProp(page, HYDRANT_WATERFRONT, { gap: 2.2, zoom: 6, lookY: 0.3 })
    await expect(page).toHaveScreenshot('wave2-hydrant-fallback-missing-model.png', SHOT)
  })

  test('an unreachable streetlight GLB restores the pole AND its functional night light', async ({ page }) => {
    await page.route('**/prop_streetlight_01.glb', (route) => route.abort())
    await boot(page)
    await frameProp(page, LAMP_CENTRAL, { gap: 3.4, zoom: 2.8, hour: 22, lookY: 1.1 })
    await expect(page).toHaveScreenshot('wave2-streetlight-fallback-night.png', SHOT)
  })

  test('an unreachable trash-bin GLB renders the complete procedural can', async ({ page }) => {
    await page.route('**/prop_trash_bin_01.glb', (route) => route.abort())
    await boot(page)
    await frameProp(page, BIN_SOUTH, { gap: 2.2, zoom: 5.5, lookY: 0.45 })
    await expect(page).toHaveScreenshot('wave2-trashbin-fallback-missing-model.png', SHOT)
  })
})
