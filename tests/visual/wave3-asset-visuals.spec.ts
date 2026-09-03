import { expect, test, type Page } from '@playwright/test'

/**
 * Issue #44 Integration Wave 3 — required visual acceptance evidence.
 *
 * Six approved sprint BUILDING bodies project onto nine EXISTING authored placements. Nothing
 * here proves gameplay — every placement id, position, `def.size` footprint, collider, door
 * anchor, label, district and occluder descriptor is unchanged and is gated at the unit level in
 * `src/game/assets/wave3Contract.test.ts` and `src/game/world/wave3Buildings.test.tsx`. These
 * baselines prove what a code diff cannot: which way each body actually faces, whether it sits
 * ON the ground inside its authored lot, whether the city still reads as a city around it,
 * whether a tall body still fades off the player, whether anything self-glows by day or leaves a
 * ghost window grid by night, and whether a missing file restores the complete procedural
 * building.
 *
 * FRAMING IS DERIVED, NOT TUNED BY HAND. A building is 4–24 m tall and the camera centres on the
 * PLAYER, so a hand-picked zoom crops one subject and loses another in the middle distance —
 * which is exactly the "unjudgeable capture" issue #44 says to reject. `frameFor()` below solves
 * the camera geometry instead; see its comment for the derivation.
 *
 * OCCLUSION. The cardinal framing deliberately puts the building BEHIND the player on the camera
 * ray, so the shipped occlusion fade would make every facade shot half-transparent and
 * unjudgeable. Facade, context, entrance, day/night and fallback shots therefore disable
 * occlusion and restore it afterwards, exactly as the Wave 0 office evidence does; the fade
 * itself is proved separately, with occlusion ON, in its own describe block.
 *
 * The world is PAUSED before each shot, which snaps actors to canonical poses for
 * pixel-determinism. 3D-world shots allow a small pixel-diff ratio (low-poly AA on device pixels).
 */

const SHOT = { maxDiffPixelRatio: 0.02 }

/** Authored placements, straight out of cityLayout.ts. */
const APARTMENT: [number, number] = [-14.5, -14.5] // 9 x 7.5 x 9, door south, central
const SHOP: [number, number] = [-5, -17.5] // 6 x 5 x 6, door south, central
const HOUSE_C: [number, number] = [0.5, 15] // 5.5 x 4.5 x 5.5, door north, central
const HOUSE_N: [number, number] = [-6, -54.5] // door south, north residential
const HOUSE_W: [number, number] = [-57, -5] // door east, west residential
const HOUSE_S: [number, number] = [-4, 41] // door south, south residential
const TOWNHOMES: [number, number] = [20, -54] // 7 x 6 x 7, door south, north residential
const GARAGE: [number, number] = [59.5, 8] // 8 x 5.5 x 7, door west, east industrial
const HOTEL: [number, number] = [63, -110] // 9 x 13 x 8, door west, downtown gateway

/**
 * Rendered body dimensions in WORLD units (after each placement's canonical-facing yaw) —
 * `entry.bounds` from the manifest, which `wave3Contract.test.ts` recomputes from the committed
 * bytes. Framing is derived from these, so a body that changed size reframes itself rather than
 * silently cropping. The garage and hotel are yawed −π⁄2, so their world width is the model's Z.
 */
const BODY = {
  apartment: { height: 14.9996, width: 5.5376, depth: 5.1183 },
  shop: { height: 4.824, width: 5.9925, depth: 4.8836 },
  house: { height: 4.757, width: 5.4935, depth: 5.0635 },
  rowhouse: { height: 7.9515, width: 6.9612, depth: 5.2868 },
  garage: { height: 3.7824, width: 4.834, depth: 6.9915 },
  hotel: { height: 14.9994, width: 8.4457, depth: 7.6179 },
} as const
type BodyKey = keyof typeof BODY

/** Shipped uniform scale per body, straight out of the manifest — see wave3Contract.test.ts. */
const SCALE: Record<BodyKey, number> = {
  apartment: 0.6, shop: 1.206, house: 0.9515, rowhouse: 0.8835, garage: 0.6304, hotel: 0.8333,
}

/**
 * The authored `def.size` height of each body's placement, plus BuildingMesh's 0.5 roof slab —
 * i.e. how tall the PROCEDURAL fallback stands. The entrance/fallback A/B pair is framed for
 * whichever of the two bodies is taller, so the two frames stay identical to each other AND
 * neither is cropped: the repair garage's 3.78 m GLB is 2.2 m SHORTER than the 6.0 m box that
 * replaces it, and a frame solved for the model alone cut the fallback's roof off.
 */
const FALLBACK_HEIGHT: Record<BodyKey, number> = {
  apartment: 8, shop: 5.5, house: 5, rowhouse: 6.5, garage: 6, hotel: 13.5,
}

/** The body dimensions an entrance/fallback pair is framed for. */
const pairBody = (key: BodyKey) => ({
  ...BODY[key],
  height: Math.max(BODY[key].height, FALLBACK_HEIGHT[key]),
})

/** Shipped file per body, relative to public/ — used by the DEV review hook and the fallback routes. */
const GLB: Record<BodyKey, string> = {
  apartment: 'assets/models/city/arch_apartment_01.glb',
  shop: 'assets/models/city/arch_shop_01.glb',
  house: 'assets/models/city/arch_house_01.glb',
  rowhouse: 'assets/models/city/arch_row_house_01.glb',
  garage: 'assets/models/city/arch_repair_garage_01.glb',
  hotel: 'assets/models/city/arch_hotel_01.glb',
}

/** Compass → DEV orbit azimuth that puts the CAMERA on that side of the player. */
const AZIMUTH = {
  south: -Math.PI / 4,
  east: Math.PI / 4,
  north: (3 * Math.PI) / 4,
  west: (-3 * Math.PI) / 4,
  /** The shipped view: the camera on the south-east corner, i.e. the three-quarter. */
  corner: 0,
} as const
type ViewName = keyof typeof AZIMUTH

/** Player stand-off from the building centre, along the outward normal of the viewed face. */
const STANDOFF: Record<ViewName, [number, number]> = {
  south: [0, 1],
  east: [1, 0],
  north: [0, -1],
  west: [-1, 0],
  corner: [Math.SQRT1_2, Math.SQRT1_2],
}

/** FollowCamera's fixed offset: horizontal reach and height above the look target. */
const CAM_R = Math.hypot(12, 12) // 16.9706
const CAM_H = 18
/** drei's OrthographicCamera uses a canvas-sized frustum, so 1 world unit = `zoom` px. */
const BASE_ZOOM = 34 // FollowCamera ZOOM_WALKING
const VIEWPORT_H = 720

/** The player transform's own height above the ground plane, which the camera aims at. */
const PLAYER_Y = 0.8

/**
 * Solve `setCameraLookY` + `setCameraZoomMul` so a body of `height`, standing `gap` units from
 * the player along the camera axis, lands VERTICALLY CENTRED and fills `fill` of the frame.
 *
 * `FollowCamera` keeps its position at `player + R(azimuth)·(12, 18, 12)` and only re-aims at the
 * LOOK TARGET `player + (0, lookY, 0)`, so lookY tilts the view rather than moving it. Writing
 * `R = |(12, 12)| = 16.97` and `Λ = CAM_H − lookY` (the camera's height above that target), the
 * view distance is `D = √(R² + Λ²)`, the camera's screen-up axis is `(0, R, −Λ)/D` about the
 * horizontal direction `ĥ` from the player toward the camera, and a world point `Q` lands at
 *
 *   screenUp(Q) = (Q.y − PLAYER_Y − lookY)·(R / D) − (Λ / D)·((Q − player) · ĥ)
 *
 * The height term is measured from the LOOK TARGET, not from the ground — getting that wrong
 * aims tens of metres high and photographs the sky, which is exactly what the first capture pass
 * did. A subject standing behind the player has `(Q − player) · ĥ = −gap`; `side: 'near'` puts
 * the player behind IT, giving `+gap`.
 *
 * Centring the body means `screenUp(base) + screenUp(top) = 0`, which solves in closed form:
 *
 *   lookY = (height/2 − PLAYER_Y ∓ CAM_H·gap/R) / (1 ∓ gap/R)      (∓ = far / near)
 *
 * and its on-screen span is then `(R / D)·height`. drei's OrthographicCamera uses a canvas-sized
 * frustum, so 1 world unit = `zoom` px and `zoomMul = fill · 720 / (BASE_ZOOM · span)`.
 *
 * Every framing number in this spec comes out of those lines; nothing is hand-tuned, so a body
 * that changed size reframes itself instead of cropping. `lookY` stays well below `CAM_H` for
 * every body here, so the camera keeps looking DOWN — a look target above the camera would
 * photograph roof undersides.
 */
function frameFor(
  body: { height: number; width: number; depth: number },
  view: ViewName,
  gap: number,
  fill: number,
  side: 'far' | 'near' = 'far',
) {
  const sign = side === 'far' ? 1 : -1
  const lookY = (body.height / 2 - PLAYER_Y + sign * (CAM_H * gap) / CAM_R) / (1 + sign * gap / CAM_R)
  const d = Math.hypot(CAM_R, CAM_H - lookY)
  const k = CAM_R / d
  const m = (CAM_H - lookY) / d
  // Extent of the body ALONG the camera axis: a box's depth also projects vertically, and
  // ignoring it is what made a 4.8 m shop overflow a frame solved for 4.8 m of height.
  const along =
    view === 'corner'
      ? (body.width + body.depth) / Math.SQRT2
      : view === 'south' || view === 'north'
        ? body.depth
        : body.width
  const span = k * body.height + m * along
  return {
    lookY: +lookY.toFixed(4),
    zoom: +((fill * VIEWPORT_H) / (BASE_ZOOM * span)).toFixed(4),
  }
}

async function boot(page: Page) {
  await page.goto('/')
  await page.waitForFunction(() => window.GAME_TEST_API?.ready() === true, undefined, { timeout: 45_000 })
  // Wait for the GLBs to actually mount, or a shot races the fallback->model swap.
  await page.waitForFunction(() => window.GAME_TEST_API?.assetsSettled() === true, undefined, {
    timeout: 45_000,
  })
}

async function settleAndPause(page: Page) {
  await page.waitForTimeout(2600)
  await page.evaluate(() => window.GAME_TEST_API!.pauseWorld(true))
  await page.waitForTimeout(700)
}

interface Shot {
  /** Distance from the building centre to the player, along the camera axis. */
  gap: number
  /** Fraction of the frame height the body should occupy. */
  fill: number
  hour?: number
  /** 'near' puts the player on the far side, so the body sits between camera and player. */
  side?: 'far' | 'near'
  /** Frame for these dimensions instead of the body's own (entrance/fallback A/B pairs). */
  body?: { height: number; width: number; depth: number }
  /** Override the solved zoom (context shots frame a fixed world height, not a fixed fill). */
  zoom?: number
}

/** Stand the player off the building on `view`'s side and orbit the camera onto the same axis. */
async function viewFrom(page: Page, at: [number, number], view: ViewName, key: BodyKey, s: Shot) {
  const [nx, nz] = STANDOFF[view]
  const sign = s.side === 'near' ? -1 : 1
  const pos: [number, number] = [at[0] + nx * s.gap * sign, at[1] + nz * s.gap * sign]
  const f = frameFor(s.body ?? BODY[key], view, s.gap, s.fill, s.side ?? 'far')
  const zoom = s.zoom ?? f.zoom
  await page.evaluate(
    ([p, h, z, az, ly]) => {
      const a = window.GAME_TEST_API!
      a.resetGame()
      a.setTime(h as number)
      a.setWeather('clear')
      a.teleportPlayer([(p as number[])[0], 1.2, (p as number[])[1]])
      a.setCameraZoomMul(z as number)
      a.setCameraAzimuth(az as number)
      a.setCameraLookY(ly as number)
    },
    [pos, s.hour ?? 13, zoom, AZIMUTH[view], f.lookY] as const,
  )
}

/** An opaque, judgeable shot: the fade is proved in its own block, not smeared over every frame. */
async function opaque(page: Page, body: () => Promise<void>) {
  await page.evaluate(() => window.GAME_TEST_API!.setOcclusionEnabled(false))
  await settleAndPause(page)
  await body()
  await page.evaluate(() => window.GAME_TEST_API!.setOcclusionEnabled(true))
}

/**
 * The six approved bodies, each shot from its own placement. Only ONE placement per body is
 * needed for the massing evidence — the house archetype is a single file, and its four
 * placements are covered by the city-context and district blocks below.
 *
 * `gap` is chosen per body so the player lands on open ground on ALL FOUR sides: the central
 * block is dense, and a stand-off that falls inside a neighbour's collider gets pushed by the
 * spawn-clearing logic and silently reframes the shot.
 */
const BODIES: {
  key: BodyKey
  at: [number, number]
  gap: number
  /** The elevation the authored door faces — where the entrance must actually be. */
  door: ViewName
}[] = [
  { key: 'apartment', at: APARTMENT, gap: 6, door: 'south' },
  { key: 'shop', at: SHOP, gap: 4.5, door: 'south' },
  { key: 'house', at: HOUSE_C, gap: 6, door: 'north' },
  { key: 'rowhouse', at: TOWNHOMES, gap: 8, door: 'south' },
  { key: 'garage', at: GARAGE, gap: 8, door: 'west' },
  { key: 'hotel', at: HOTEL, gap: 7, door: 'west' },
]

// -------------------------------------- the six approved bodies, isolated + unobstructed ----
/**
 * Requirement 1 — each approved body in full-body cardinal views with ground contact.
 *
 * These CANNOT be shot in situ. The city is dense by design: the Mini Mart's west elevation
 * stands 9.5 m from a 24 m apartment tower and its east elevation 2 m from the 6 m Book Nook, so
 * no camera the shipped rig can produce sees either — the first capture pass proved it, and
 * issue #44 says to reject an occluded capture rather than ship it.
 *
 * So the ASSET evidence uses the existing DEV review hook `setPlayerStaticGlb` (issue #27 H0
 * Calibration, the same path `tests/human-proof/candidateReview.spec.ts` uses for candidate
 * rigs): it mounts an un-rigged GLB statically in the player slot, grounded with its lowest
 * vertex at y = 0, in open plaza ground with nothing between it and the camera. It renders
 * through the real renderer at the body's SHIPPED uniform scale, so these frames also prove the
 * projected size. The override is DEV-only, non-persistent, and cleared after every shot; no
 * runtime slot, manifest row or placement is touched. The same bodies in their real placements
 * are the next block down.
 *
 * The camera stays at the shipped azimuth and the MODEL turns, so each yaw presents one
 * elevation square-on: +45° puts the model's own +z front toward the camera, then every 90°.
 */
/**
 * Open grass between the central ring and the west residential street: nothing stands between
 * this point and the camera (which sits 12 units to its south-east), which is the whole point of
 * an isolated review. The central plaza is NOT usable — the food truck and the corner house sit
 * inside the camera ray there and clip the base of a tall body.
 */
const REVIEW_GROUND: [number, number] = [-38, 22]

/**
 * The player rig the review hook borrows carries a spawn heading, so a model yawed by `y`
 * presents the elevation at `y + 180`, and the lateral pair comes out mirrored — which is why
 * `ELEVATIONS` lists west before east rather than in compass order.
 *
 * BOTH facts are MEASURED, not assumed. At yaw 45 the repair garage — whose two roller shutters
 * are unmistakably on its +z face — showed its blank −z elevation, which fixes the 180. And the
 * frame the naive mapping called "east" held the row house's dish-and-windows gable, which the
 * offscreen reference render of the same committed bytes labels WEST; its "west" frame held the
 * plain downpipe gable, which that reference labels east. Two independently identifiable gables
 * on one body is what makes the check conclusive.
 */
const REVIEW_YAW_OFFSET = 180

const ELEVATIONS: [string, number][] = [
  ['front', 45], // the model's +z elevation — its measured front
  ['west', 135],
  ['rear', 225],
  ['east', 315],
].map(([n, y]) => [n as string, ((y as number) + REVIEW_YAW_OFFSET) % 360]) as [string, number][]

async function reviewBody(page: Page, key: BodyKey, yawDeg: number) {
  const b = BODY[key]
  // gap 0: the body sits ON the look target, so the framing solve reduces to lookY = H/2 - PLAYER_Y.
  const f = frameFor(b, 'corner', 0, 0.62)
  await page.evaluate(
    ([pos, z, ly]) => {
      const a = window.GAME_TEST_API!
      a.resetGame()
      a.setTime(13)
      a.setWeather('clear')
      a.teleportPlayer([(pos as number[])[0], 1.2, (pos as number[])[1]])
      a.setCameraZoomMul(z as number)
      a.setCameraAzimuth(0)
      a.setCameraLookY(ly as number)
    },
    [REVIEW_GROUND, f.zoom, f.lookY] as const,
  )
  await page.evaluate(
    ([path, yaw, scale]) =>
      window.GAME_TEST_API!.setPlayerStaticGlb(path as string, yaw as number, scale as number, 0),
    [GLB[key], yawDeg, SCALE[key]] as const,
  )
}

for (const key of Object.keys(BODY) as BodyKey[]) {
  test.describe(`Wave 3 — ${key} body, isolated`, () => {
    for (const [name, yaw] of ELEVATIONS) {
      test(`${name} elevation at the shipped scale, grounded, nothing in front of it`, async ({ page }) => {
        await boot(page)
        await reviewBody(page, key, yaw)
        await opaque(page, async () => {
          await expect(page).toHaveScreenshot(`wave3-asset-${key}-${name}.png`, SHOT)
        })
        await page.evaluate(() => window.GAME_TEST_API!.setPlayerStaticGlb(null))
      })
    }
  })
}

// ------------------------------------------ the same bodies at the shipped camera angle ----
for (const { key, at, gap } of BODIES) {
  test(`Wave 3 — ${key}: three-quarter massing at its own placement`, async ({ page }) => {
    await boot(page)
    await viewFrom(page, at, 'corner', key, { gap, fill: 0.6 })
    await opaque(page, async () => {
      await expect(page).toHaveScreenshot(`wave3-${key}-three-quarter.png`, SHOT)
    })
  })
}

// ------------------------------------------------- entrances on the authored doors ----
/**
 * The authored `def.door` is the entrance anchor every interaction, marker and pedestrian
 * approach uses. A body whose front ended up on the wrong elevation would put a blank wall here
 * — which is exactly what a filename-derived orientation produces.
 */
test.describe('Wave 3 — entrances land on the authored door side', () => {
  for (const { key, at, gap, door } of BODIES) {
    test(`${key}: the entrance elevation faces ${door}`, async ({ page }) => {
      await boot(page)
      await viewFrom(page, at, door, key, { gap, fill: 0.72, body: pairBody(key) })
      await opaque(page, async () => {
        await expect(page).toHaveScreenshot(`wave3-${key}-entrance-${door}.png`, SHOT)
      })
    })
  }

  // The only Wave 3 placement with a real interactable: the player's home. Its marker sits at
  // [-12.5, 0, -9], one metre off the authored south face, and must still be reachable in front
  // of the new body rather than buried inside it.
  test('apartment: the home interactable is still reachable in front of the south facade', async ({ page }) => {
    await boot(page)
    await viewFrom(page, APARTMENT, 'south', 'apartment', { gap: 6, fill: 0.6 })
    await page.evaluate(() => window.GAME_TEST_API!.teleportPlayer([-12.5, 1.2, -9]))
    await opaque(page, async () => {
      await expect(page).toHaveScreenshot('wave3-apartment-home-interactable.png', SHOT)
    })
  })

  // The yawed house: `building_house_w2` authors door 'east', so the SAME archetype file must
  // present its porch to the east here while it presents it north/south elsewhere.
  test('house archetype: the west-district placement turns its porch east', async ({ page }) => {
    await boot(page)
    await viewFrom(page, HOUSE_W, 'east', 'house', { gap: 6, fill: 0.72 })
    await opaque(page, async () => {
      await expect(page).toHaveScreenshot('wave3-house-w2-entrance-east.png', SHOT)
    })
  })
})

// ------------------------------------------------------ nine placements in context ----
/**
 * The massing shots above are deliberately close. These are the same nine placements at play
 * distance, among their real neighbours, roads, props and citizens — where a body that is too
 * big, too small, floating or facing the wrong way stops being a detail and becomes obvious.
 */
/**
 * Context shots frame a FIXED world height rather than a fixed fraction of each body, so all
 * nine placements are photographed at the same play distance and read against each other. A
 * per-body fill cannot do that: at fill 0.3 the 24 m apartment pulled the frame out to 79 world
 * units and put the edge of the diorama in shot, while the 4.8 m house sat in a 14-unit frame.
 */
const CONTEXT_FRAME_UNITS = 40
const CONTEXT_ZOOM = +(VIEWPORT_H / (BASE_ZOOM * CONTEXT_FRAME_UNITS)).toFixed(4)

const CONTEXT: [string, [number, number], BodyKey][] = [
  ['apartment-01', APARTMENT, 'apartment'],
  ['shop-01', SHOP, 'shop'],
  ['house-01-central', HOUSE_C, 'house'],
  ['house-r2-north', HOUSE_N, 'house'],
  ['house-w2-west', HOUSE_W, 'house'],
  ['house-s2-south', HOUSE_S, 'house'],
  ['townhomes-01', TOWNHOMES, 'rowhouse'],
  ['garage-01', GARAGE, 'garage'],
  ['gate-hotel-01', HOTEL, 'hotel'],
]

test.describe('Wave 3 — all nine placements in city context', () => {
  for (const [name, at, key] of CONTEXT) {
    test(`${name} reads as part of the city at play distance`, async ({ page }) => {
      await boot(page)
      await viewFrom(page, at, 'corner', key, { gap: 14, fill: 0.3, zoom: CONTEXT_ZOOM })
      await opaque(page, async () => {
        await expect(page).toHaveScreenshot(`wave3-context-${name}.png`, SHOT)
      })
    })
  }
})

// ------------------------------------------------------------ occlusion, fade ON ----
/**
 * Issue #44 requires occlusion IDENTITY to be unchanged: the occluder box still derives from the
 * authored `def.size`, never from the model. These three are the tall bodies — the ones where a
 * broken contract would leave the player hidden behind an opaque wall. `side: 'near'` stands the
 * player on the FAR side, so the body sits squarely between the camera and the player.
 */
test.describe('Wave 3 — tall bodies still fade off the player', () => {
  const FADES: [string, [number, number], BodyKey, string, number][] = [
    ['apartment', APARTMENT, 'apartment', 'building_apartment_01', 9],
    ['hotel', HOTEL, 'hotel', 'building_gate_hotel_01', 9],
    ['townhomes', TOWNHOMES, 'rowhouse', 'building_townhomes_01', 8],
  ]
  for (const [key, at, h, id, gap] of FADES) {
    test(`${key} fades when it stands between the camera and the player`, async ({ page }) => {
      await boot(page)
      await viewFrom(page, at, 'corner', h, { gap, fill: 0.6, side: 'near' })
      await page.waitForFunction(
        (bid) => window.GAME_TEST_API!.getVisibilityState().faded.some((x) => x.id === bid && x.opacity < 0.6),
        id,
        { timeout: 20_000 },
      )
      await settleAndPause(page)
      await expect(page).toHaveScreenshot(`wave3-${key}-occlusion-fade.png`, SHOT)
    })
  }
})

// --------------------------------------------------------------- day and night ----
/**
 * The baked atlases carry NO emissive material, texture or light (the intake refuses all three),
 * so these bodies must be lit by the sun and by nothing else. At night they must go dark like
 * their neighbours — with no leftover glow grid floating on or beside a facade, which is what
 * issue #44 Wave 3 suppressed on `building_apartment_01`.
 */
test.describe('Wave 3 — day and night treatment', () => {
  test('apartment close read at noon — lit by the sun, not by itself', async ({ page }) => {
    await boot(page)
    await viewFrom(page, APARTMENT, 'south', 'apartment', { gap: 6, fill: 0.8, hour: 12 })
    await opaque(page, async () => {
      await expect(page).toHaveScreenshot('wave3-apartment-day-facade.png', SHOT)
    })
  })

  test('apartment at night — dark facade, and NO ghost window grid where the old one was', async ({ page }) => {
    await boot(page)
    await viewFrom(page, APARTMENT, 'south', 'apartment', { gap: 6, fill: 0.6, hour: 22 })
    await opaque(page, async () => {
      await expect(page).toHaveScreenshot('wave3-apartment-night.png', SHOT)
    })
  })

  test('apartment at night, east elevation — the other suppressed grid is gone too', async ({ page }) => {
    await boot(page)
    await viewFrom(page, APARTMENT, 'east', 'apartment', { gap: 6, fill: 0.6, hour: 22 })
    await opaque(page, async () => {
      await expect(page).toHaveScreenshot('wave3-apartment-night-east.png', SHOT)
    })
  })

  test('shop at night — the street lights it; the shopfront does not light itself', async ({ page }) => {
    await boot(page)
    await viewFrom(page, SHOP, 'south', 'shop', { gap: 4.5, fill: 0.6, hour: 22 })
    await opaque(page, async () => {
      await expect(page).toHaveScreenshot('wave3-shop-night.png', SHOT)
    })
  })

  test('hotel at night — a 15.0 m body with no self-glow', async ({ page }) => {
    await boot(page)
    await viewFrom(page, HOTEL, 'west', 'hotel', { gap: 7, fill: 0.6, hour: 22 })
    await opaque(page, async () => {
      await expect(page).toHaveScreenshot('wave3-hotel-night.png', SHOT)
    })
  })
})

// -------------------------------------------------------------------- fallback ----
/**
 * The missing/corrupt-model path, photographed for real, ONE per approved body and at the SAME
 * framing as its healthy south cardinal above. The GLB request is aborted at the network layer
 * BEFORE the page loads, so `useGLTF` throws, `AssetErrorBoundary` catches, and the complete
 * original procedural building renders in its place. Nothing in the app is stubbed or disabled:
 * this is exactly what a deleted or truncated file would do in production.
 */
const FILES: Record<BodyKey, string> = {
  apartment: 'arch_apartment_01.glb',
  shop: 'arch_shop_01.glb',
  house: 'arch_house_01.glb',
  rowhouse: 'arch_row_house_01.glb',
  garage: 'arch_repair_garage_01.glb',
  hotel: 'arch_hotel_01.glb',
}

test.describe('Wave 3 — fallback when a model is missing', () => {
  for (const { key, at, gap, door } of BODIES) {
    test(`an unreachable ${key} GLB renders the complete procedural building`, async ({ page }) => {
      await page.route(`**/${FILES[key]}`, (route) => route.abort())
      await boot(page)
      // The SAME framing as this body's entrance shot, so the two read as an A/B pair.
      await viewFrom(page, at, door, key, { gap, fill: 0.72, body: pairBody(key) })
      await opaque(page, async () => {
        await expect(page).toHaveScreenshot(`wave3-${key}-fallback-missing-model.png`, SHOT)
      })
    })
  }

})

/**
 * `Districts.tsx` used to paint a rolling-door decal on the garage's SOUTH wall — set dressing
 * for a windowless procedural box. The approved body carries its own roller shutters, and the
 * −π⁄2 yaw that points them at the authored west door maps the model's third (single) shutter
 * onto that same south wall, so leaving the decal would paint a second door directly over a real
 * one. This is that wall, with the GLB healthy: one shutter, no painted stand-in on top of it.
 */
test('Wave 3 — the garage south wall carries one shutter, not a painted decal over it', async ({ page }) => {
  await boot(page)
  await viewFrom(page, GARAGE, 'south', 'garage', { gap: 8, fill: 0.72, body: pairBody('garage') })
  await opaque(page, async () => {
    await expect(page).toHaveScreenshot('wave3-garage-south-no-decal.png', SHOT)
  })
})

/**
 * The other half of that pair, and the frame issue #44's second Codex review asked for.
 *
 * The decal is gated on the ACTUAL render branch, so aborting the garage GLB at the network
 * layer — a real missing/corrupt file, nothing stubbed — must bring the painted rolling door
 * back on this exact wall. Same stand point, same framing and same body dimensions as the
 * healthy shot above, so the two read as a true A/B: one shutter baked into the model, versus
 * the painted stand-in the procedural box needs.
 *
 * An earlier revision gated this on `hasRealModel()`, which is a manifest fact decided before
 * the file is fetched; under it this capture showed the procedural garage with NO door at all.
 */
test('Wave 3 — an unreachable garage GLB restores the painted door on that same wall', async ({ page }) => {
  await page.route('**/arch_repair_garage_01.glb', (route) => route.abort())
  await boot(page)
  await viewFrom(page, GARAGE, 'south', 'garage', { gap: 8, fill: 0.72, body: pairBody('garage') })
  await opaque(page, async () => {
    await expect(page).toHaveScreenshot('wave3-garage-south-fallback-decal.png', SHOT)
  })
})

// ------------------------------------------------------------ district overviews ----
/**
 * The six districts issue #44 names, at overview distance: the point of this wave is that the
 * city stops presenting mostly procedural building shapes, and that is only judgeable at the
 * scale where a whole street is in frame. The aim is the shipped one and only the zoom is widened; occlusion stays ON — this is the
 * shipped view: the shipped aim and a wide zoom, so a whole street is in frame.
 */
const DISTRICTS: [string, [number, number]][] = [
  ['central', [-9, -13]],
  ['north-residential', [7, -50]],
  ['west-residential', [-52, -5]],
  ['south-residential', [-4, 45]],
  // Stand EAST of the garage, not west of it: the camera sits 12 units south-east of the
  // player, so a subject south-east of the stand point lands on the camera ray and the shipped
  // occlusion fades it — which is correct behaviour but makes the overview unjudgeable.
  ['east-industrial', [64, 14]],
  ['downtown-gateway', [58, -105]],
]

test.describe('Wave 3 — district overviews', () => {
  for (const [name, at] of DISTRICTS) {
    test(`${name} district reads as a built city`, async ({ page }) => {
      await boot(page)
      await page.evaluate(
        ([p]) => {
          const a = window.GAME_TEST_API!
          a.resetGame()
          a.setTime(13)
          a.setWeather('clear')
          a.teleportPlayer([(p as number[])[0], 1.2, (p as number[])[1]])
          a.setCameraZoomMul(0.35) // ~60 x 107 world units in frame
          a.setCameraAzimuth(0) // the shipped view
          a.setCameraLookY(0) // the shipped aim
        },
        [at] as const,
      )
      await settleAndPause(page)
      await expect(page).toHaveScreenshot(`wave3-district-${name}.png`, SHOT)
    })
  }
})
