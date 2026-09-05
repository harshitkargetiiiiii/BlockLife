import { expect, test, type Page } from '@playwright/test'
import {
  AZIMUTH,
  BASE_ZOOM,
  SHOT,
  STANDOFF,
  VIEWPORT_H,
  type BodyDims,
  type ViewName,
  boot,
  frameFor,
  manifestBody,
  manifestEntry,
  opaque,
  settleAndPause,
  waitForSceneSettled,
} from './visualHelpers'

/**
 * Issue #47 Integration Wave 4 — required visual acceptance evidence.
 *
 * Ten approved bodies reach a runtime home across 35 EXISTING authored placements: five named
 * residents, four parked-vehicle bodies over all 29 `parked_car` / `parked_truck` props, and one
 * building body. Nothing here proves gameplay — every id, position, footprint, collider, anchor,
 * route, label and save field is unchanged and is gated at the unit level in
 * `src/game/assets/wave4Contract.test.ts`, with the render/lifecycle behaviour in
 * `tests/e2e/asset-integration-wave-4.spec.ts`.
 *
 * These baselines prove what a code diff cannot: which way each body faces, whether it sits ON the
 * ground at a believable size beside a 1.8 m person, whether a named resident still reads as that
 * character next to the unchanged player, whether the street stops looking cloned, whether
 * anything self-glows at night or under rain, and whether a missing file restores the complete
 * pre-wave visual.
 *
 * FRAMING IS DERIVED, NOT TUNED. `frameFor()` (tests/visual/framing.ts, unit-tested) solves the
 * camera geometry, so no shot here can crop its subject or aim at the sky.
 *
 * OCCLUSION. Cardinal framings deliberately put the subject BEHIND the player on the camera ray,
 * where the shipped fade would make it half-transparent and unjudgeable — so those shots disable
 * occlusion and restore it afterwards, exactly as Waves 0 and 3 do.
 *
 * THE DEV REVIEW OVERRIDES used for the isolated proofs (`setPlayerCharacterAsset` for rigs,
 * `setPlayerStaticGlb` for static bodies) are the same paths Wave 0 and Wave 3 used. They are
 * DEV-only, non-persistent, cleared after every shot, and touch no runtime slot, manifest row or
 * placement. The SHIPPED player is proved separately, and never changes.
 */

// ------------------------------------------------------------------ the shipped inventory ----

/** Named residents: NPC id → its 1:1 body, and where it stands at the hour we photograph it. */
const RESIDENTS: { npc: string; assetId: string; label: string; at: [number, number]; hour: number }[] = [
  { npc: 'npc_ravi_01', assetId: 'blocklife_ravi_01', label: 'ravi', at: [-8.5, -5], hour: 9 },
  { npc: 'npc_maya_01', assetId: 'blocklife_maya_01', label: 'maya', at: [4.4, -4.4], hour: 13 },
  { npc: 'npc_bruno_01', assetId: 'blocklife_bruno_01', label: 'bruno', at: [11.5, -9], hour: 13 },
  { npc: 'npc_kim_01', assetId: 'blocklife_kim_01', label: 'kim', at: [-30, -30], hour: 13 },
  { npc: 'npc_nisha_01', assetId: 'blocklife_nisha_01', label: 'nisha', at: [-14, -8.5], hour: 9 },
]

/** The four NEW character files (Ravi's body shipped in Wave 0 and has its own baselines). */
const NEW_CHARACTERS = RESIDENTS.filter((r) => r.assetId !== 'blocklife_ravi_01')

/** The four parked bodies + the one building body — the static half of the new sources. */
const STATIC_BODIES: { key: string; assetId: string }[] = [
  { key: 'hatchback', assetId: 'vehicle_parked_hatchback_01' },
  { key: 'pickup', assetId: 'vehicle_parked_pickup_01' },
  { key: 'delivery-van', assetId: 'vehicle_parked_delivery_van_01' },
  { key: 'box-truck', assetId: 'vehicle_parked_box_truck_01' },
  { key: 'gate-tower', assetId: 'building_gate_tower_02' },
]

const TOWER: [number, number] = [34, -94] // building_gate_tower_02, 8 x 14 x 8, door east

/**
 * Rendered body dimensions in WORLD units, READ FROM THE MANIFEST rather than transcribed, so a
 * body that changed size reframes itself here instead of silently cropping (issue #46 §5).
 */
const BODY: Record<string, BodyDims> = Object.fromEntries(
  STATIC_BODIES.map(({ key, assetId }) => [key, manifestBody(assetId)]),
)

const SCALE: Record<string, number> = Object.fromEntries(
  STATIC_BODIES.map(({ key, assetId }) => [key, manifestEntry(assetId).scale[0]]),
)

const GLB: Record<string, string> = Object.fromEntries(
  STATIC_BODIES.map(({ key, assetId }) => [key, manifestEntry(assetId).glbPath!]),
)

/**
 * Open grass between the central ring and the west residential street — nothing stands between
 * this point and the camera, which is the whole point of an isolated review. (The central plaza
 * is NOT usable: the food truck and the corner house sit inside the camera ray there.)
 */
const REVIEW_GROUND: [number, number] = [-38, 22]

/**
 * The player rig the static review hook borrows carries a spawn heading, so a model yawed by `y`
 * presents the elevation at `y + 180` — the same measured offset Wave 3 recorded, on the same
 * hook. Its lateral pair therefore reads west-before-east.
 */
const REVIEW_YAW_OFFSET = 180
const ELEVATIONS: [string, number][] = ([
  ['front', 45],
  ['west', 135],
  ['rear', 225],
  ['east', 315],
] as [string, number][]).map(([n, y]) => [n, (y + REVIEW_YAW_OFFSET) % 360])

// ---------------------------------------------------------------------------- shot helpers ----

interface Shot {
  gap: number
  fill: number
  hour?: number
  weather?: 'clear' | 'rain'
  zoom?: number
  body?: BodyDims
  /** This shot deliberately photographs the fallback, so readiness must not require the GLB. */
  fallback?: boolean
  requireGlb?: readonly string[]
}

/** Stand the player off `at` on `view`'s side and orbit the camera onto the same axis. */
async function viewFrom(page: Page, at: [number, number], view: ViewName, body: BodyDims, s: Shot) {
  const [nx, nz] = STANDOFF[view]
  const pos: [number, number] = [at[0] + nx * s.gap, at[1] + nz * s.gap]
  const f = frameFor(s.body ?? body, view, s.gap, s.fill)
  await page.evaluate(
    ([p, h, w, z, az, ly]) => {
      const a = window.GAME_TEST_API!
      a.resetGame()
      a.setTime(h as number)
      a.setWeather(w as 'clear' | 'rain')
      a.teleportPlayer([(p as number[])[0], 1.2, (p as number[])[1]])
      a.setCameraZoomMul(z as number)
      a.setCameraAzimuth(az as number)
      a.setCameraLookY(ly as number)
    },
    [pos, s.hour ?? 13, s.weather ?? 'clear', s.zoom ?? f.zoom, AZIMUTH[view], f.lookY] as const,
  )
  await waitForSceneSettled(page, s.fallback ? {} : { requireGlb: s.requireGlb ?? [] })
}

/** Mount a STATIC body in the review slot at its shipped scale, grounded, on open ground. */
async function reviewStatic(page: Page, key: string, yawDeg: number, fill = 0.62) {
  const f = frameFor(BODY[key], 'corner', 0, fill)
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

/**
 * Mount a RIGGED body in the review slot through the production `AnimatedCharacter` path, and
 * orbit the camera to `view` so each elevation is presented square-on. The rig keeps its own
 * heading, so the CAMERA turns rather than the model.
 */
async function reviewRig(page: Page, assetId: string, view: ViewName) {
  // A person is ~1.8 m; gap 0 puts the body on the look target, so the solve reduces to H/2.
  const f = frameFor({ height: 1.9, width: 0.9, depth: 0.6 }, view, 0, 0.55)
  await page.evaluate(
    ([pos, z, az, ly, id]) => {
      const a = window.GAME_TEST_API!
      a.resetGame()
      a.setTime(13)
      a.setWeather('clear')
      a.teleportPlayer([(pos as number[])[0], 1.2, (pos as number[])[1]])
      a.setCameraZoomMul(z as number)
      a.setCameraAzimuth(az as number)
      a.setCameraLookY(ly as number)
      a.setPlayerCharacterAsset(id as string)
    },
    [REVIEW_GROUND, f.zoom, AZIMUTH[view], f.lookY, assetId] as const,
  )
  await waitForSceneSettled(page)
}

// ================================================== 1. isolated cardinals per NEW source ====
/**
 * Requirement: a four-cardinal plus three-quarter proof of every new source, isolated and
 * unobstructed. The city is dense by design, so these CANNOT be shot in situ — the same reason
 * Wave 3 gave. Each body renders through the real renderer at its SHIPPED scale, so these frames
 * also prove the projected size and the ground contact.
 */
for (const { key } of STATIC_BODIES) {
  test.describe(`Wave 4 — ${key} body, isolated`, () => {
    for (const [name, yaw] of ELEVATIONS) {
      test(`${name} elevation at the shipped scale, grounded`, async ({ page }) => {
        await boot(page)
        await reviewStatic(page, key, yaw)
        await opaque(page, async () => {
          await expect(page).toHaveScreenshot(`wave4-body-${key}-${name}.png`, SHOT)
        })
        await page.evaluate(() => window.GAME_TEST_API!.setPlayerStaticGlb(null))
      })
    }
    test('three-quarter at the shipped scale, grounded', async ({ page }) => {
      await boot(page)
      // 45° between two cardinals, i.e. the corner the shipped camera actually looks from.
      await reviewStatic(page, key, (90 + REVIEW_YAW_OFFSET) % 360)
      await opaque(page, async () => {
        await expect(page).toHaveScreenshot(`wave4-body-${key}-three-quarter.png`, SHOT)
      })
      await page.evaluate(() => window.GAME_TEST_API!.setPlayerStaticGlb(null))
    })
  })
}

for (const { label, assetId } of NEW_CHARACTERS) {
  test.describe(`Wave 4 — ${label} body, isolated`, () => {
    for (const view of ['south', 'east', 'north', 'west'] as ViewName[]) {
      test(`${view} elevation through the production character path`, async ({ page }) => {
        await boot(page)
        await reviewRig(page, assetId, view)
        await opaque(page, async () => {
          await expect(page).toHaveScreenshot(`wave4-body-${label}-${view}.png`, SHOT)
        })
        await page.evaluate(() => window.GAME_TEST_API!.setPlayerCharacterAsset(null))
      })
    }
    test('three-quarter through the production character path', async ({ page }) => {
      await boot(page)
      await reviewRig(page, assetId, 'corner')
      await opaque(page, async () => {
        await expect(page).toHaveScreenshot(`wave4-body-${label}-three-quarter.png`, SHOT)
      })
      await page.evaluate(() => window.GAME_TEST_API!.setPlayerCharacterAsset(null))
    })
  })
}

// ============================================ 2. the player beside each named resident ======
/**
 * The identity evidence the issue asks for by name: the player standing beside each named NPC,
 * proving the resident reads as that character AND that the player is unchanged.
 *
 * The player here is the SHIPPED player — `blocklife_person` with its save-backed wardrobe — and
 * no override of any kind is in play. The NPC is wherever its own routine puts it at the hour
 * given, so the frame is the real one a player walks into.
 */
test.describe('Wave 4 — the player beside each named resident', () => {
  for (const { npc, assetId, label, at, hour } of RESIDENTS) {
    test(`${label}: identity and wardrobe read at conversation distance, player unchanged`, async ({ page }) => {
      await boot(page)
      await page.evaluate(
        ([p, h]) => {
          const a = window.GAME_TEST_API!
          a.resetGame()
          a.setTime(h as number)
          a.setWeather('clear')
          // Stand 1.6 m to the NPC's screen-right, at the shipped camera aim and a close zoom.
          a.teleportPlayer([(p as number[])[0] + 1.6, 1.2, (p as number[])[1] - 1.0])
          a.setCameraZoomMul(2.6)
          a.setCameraAzimuth(0)
          a.setCameraLookY(0.9)
        },
        [at, hour] as const,
      )
      await waitForSceneSettled(page)
      await settleAndPause(page)
      // The picture is only evidence if the two bodies in it are the ones we claim.
      const npcState = await page.evaluate((id) => window.GAME_TEST_API!.getCharacterState(id), npc)
      expect(npcState?.assetId, `${npc} renders its own body`).toBe(assetId)
      expect(npcState?.activeVisual, `${npc} is the model, not the fallback`).toBe('model')
      const player = await page.evaluate(() => window.GAME_TEST_API!.getCharacterState('player'))
      expect(player?.assetId, 'the player is untouched').toBe('blocklife_person')
      await expect(page).toHaveScreenshot(`wave4-player-beside-${label}.png`, SHOT)
    })
  }
})

// ================================================== 3. in-city, at gameplay distance ========
/**
 * The isolated shots above are deliberately close. These are the streets at play distance, where
 * a body that is too big, too small, floating, cloned or facing the wrong way stops being a
 * detail and becomes obvious. Each frames a FIXED world height so the districts read against each
 * other rather than each being scaled to its own subject.
 */
const CONTEXT_FRAME_UNITS = 40
const CONTEXT_ZOOM = +(VIEWPORT_H / (BASE_ZOOM * CONTEXT_FRAME_UNITS)).toFixed(4)
const CONTEXT_BODY: BodyDims = { height: 6, width: 6, depth: 6 }

/** Every district that holds parked placements, plus the tower's own. */
const DISTRICTS: { name: string; at: [number, number]; requireGlb: string[] }[] = [
  { name: 'central-lot', at: [14, 14], requireGlb: ['vehicle_parked_hatchback_01'] },
  { name: 'residential-north', at: [-12, -41.5], requireGlb: ['vehicle_parked_hatchback_01'] },
  { name: 'residential-west', at: [-56, -1], requireGlb: ['vehicle_parked_hatchback_01'] },
  { name: 'residential-south', at: [0, 52], requireGlb: ['vehicle_parked_pickup_01'] },
  { name: 'industrial-yard', at: [54, -14], requireGlb: ['vehicle_parked_delivery_van_01'] },
  { name: 'freight-yard', at: [-122, -259], requireGlb: ['vehicle_parked_box_truck_01'] },
  { name: 'gateway', at: TOWER, requireGlb: ['building_gate_tower_02'] },
]

test.describe('Wave 4 — the districts at gameplay distance', () => {
  for (const { name, at, requireGlb } of DISTRICTS) {
    test(`${name} reads as one coherent street`, async ({ page }) => {
      await boot(page)
      await viewFrom(page, at, 'corner', CONTEXT_BODY, {
        gap: 14,
        fill: 0.3,
        zoom: CONTEXT_ZOOM,
        requireGlb,
      })
      await opaque(page, async () => {
        await expect(page).toHaveScreenshot(`wave4-district-${name}.png`, SHOT)
      })
    })
  }
})

/**
 * The central lot holds THREE parked placements inside a 9 m triangle — the densest parked
 * cluster in the city, and the one place where the two-body pool is forced into one repeat. This
 * is that cluster, close enough to judge whether the repeat reads as variety or as a copy-paste.
 */
test('Wave 4 — the central lot: three placements, two bodies, no copy-paste read', async ({ page }) => {
  await boot(page)
  await viewFrom(page, [14, 15.5], 'corner', { height: 3, width: 12, depth: 12 }, {
    gap: 10,
    fill: 0.5,
    requireGlb: ['vehicle_parked_hatchback_01', 'vehicle_parked_pickup_01'],
  })
  await opaque(page, async () => {
    await expect(page).toHaveScreenshot('wave4-central-lot-variety.png', SHOT)
  })
})

/**
 * Ground contact and the entrance, close. A parked body that floated or sank would show here
 * before anywhere else, and the tower's authored EAST door must present the model's real
 * entrance elevation rather than a blank wall.
 */
test('Wave 4 — parked car contact shadow and ground contact, close', async ({ page }) => {
  await boot(page)
  await viewFrom(page, [16, 11.5], 'south', BODY.hatchback, {
    gap: 4,
    fill: 0.55,
    requireGlb: ['vehicle_parked_hatchback_01'],
  })
  await opaque(page, async () => {
    await expect(page).toHaveScreenshot('wave4-parked-car-contact.png', SHOT)
  })
})

test('Wave 4 — parked truck contact shadow and ground contact, close', async ({ page }) => {
  await boot(page)
  await viewFrom(page, [53.6, -7.6], 'south', BODY['delivery-van'], {
    gap: 5,
    fill: 0.55,
    requireGlb: ['vehicle_parked_delivery_van_01'],
  })
  await opaque(page, async () => {
    await expect(page).toHaveScreenshot('wave4-parked-truck-contact.png', SHOT)
  })
})

test('Wave 4 — the tower entrance faces the authored east door', async ({ page }) => {
  await boot(page)
  await viewFrom(page, TOWER, 'east', BODY['gate-tower'], {
    gap: 8,
    fill: 0.75,
    requireGlb: ['building_gate_tower_02'],
  })
  await opaque(page, async () => {
    await expect(page).toHaveScreenshot('wave4-tower-entrance-east.png', SHOT)
  })
})

// ================================================== 4. day, night and rain ===================
/**
 * None of these bodies carries an emissive material, an emissive texture or a light — the intake
 * refuses all three and `wave4Contract.test.ts` re-reads the shipped bytes to confirm it. So each
 * must be lit by the sun and by nothing else: dark at night like its neighbours, and wet-looking
 * rather than self-lit under rain.
 */
const WEATHERS: { name: string; hour: number; weather: 'clear' | 'rain' }[] = [
  { name: 'day', hour: 12, weather: 'clear' },
  { name: 'night', hour: 22, weather: 'clear' },
  { name: 'rain', hour: 15, weather: 'rain' },
]

test.describe('Wave 4 — day / night / rain, nothing self-lit', () => {
  for (const { name, hour, weather } of WEATHERS) {
    test(`a named resident at ${name}`, async ({ page }) => {
      await boot(page)
      await page.evaluate(
        ([h, w]) => {
          const a = window.GAME_TEST_API!
          a.resetGame()
          a.setTime(h as number)
          a.setWeather(w as 'clear' | 'rain')
          a.teleportPlayer([6.0, 1.2, -5.4])
          a.setCameraZoomMul(2.6)
          a.setCameraAzimuth(0)
          a.setCameraLookY(0.9)
        },
        [hour, weather] as const,
      )
      await waitForSceneSettled(page)
      await settleAndPause(page)
      // Name what the photograph is about: this frame is only evidence if Maya's own body is the
      // thing on screen, not the identity rig underneath it.
      const st = await page.evaluate(() => window.GAME_TEST_API!.getCharacterState('npc_maya_01'))
      expect(st?.activeVisual, 'the named body is on screen').toBe('model')
      await expect(page).toHaveScreenshot(`wave4-resident-${name}.png`, SHOT)
    })

    test(`a parked vehicle at ${name}`, async ({ page }) => {
      await boot(page)
      await viewFrom(page, [16, 11.5], 'corner', BODY.hatchback, {
        gap: 5,
        fill: 0.5,
        hour,
        weather,
        requireGlb: ['vehicle_parked_hatchback_01'],
      })
      await opaque(page, async () => {
        await expect(page).toHaveScreenshot(`wave4-parked-car-${name}.png`, SHOT)
      })
    })

    test(`the tower at ${name}`, async ({ page }) => {
      await boot(page)
      await viewFrom(page, TOWER, 'east', BODY['gate-tower'], {
        gap: 8,
        fill: 0.6,
        hour,
        weather,
        requireGlb: ['building_gate_tower_02'],
      })
      await opaque(page, async () => {
        await expect(page).toHaveScreenshot(`wave4-tower-${name}.png`, SHOT)
      })
    })
  }
})

// ================================================== 5. healthy / fallback A/B per class =====
/**
 * The missing-model path, photographed for real, ONE per source class and at the SAME framing as
 * its healthy shot above, so each pair reads as a true A/B. The GLB request is aborted at the
 * NETWORK layer before the page loads, so `useGLTF` throws, the boundary catches, and the complete
 * pre-wave visual renders — the procedural character with its full registry appearance, the
 * procedural car/truck with its authored colour, the procedural building with its overlays.
 * Nothing in the app is stubbed or disabled.
 */
test.describe('Wave 4 — a missing model restores the complete pre-wave visual', () => {
  test('character: an unreachable named GLB restores the PRE-WAVE rig + registry identity', async ({ page }) => {
    // The A/B partner of `wave4-resident-day`, at the identical framing. What must be on screen
    // is NOT a coloured capsule: it is `blocklife_person` wearing Maya's curated identity —
    // exactly what this NPC rendered before the wave. The state assertions below name which of
    // the three chain steps produced the picture, so the baseline cannot be misread.
    await page.route('**/blocklife_maya_01.glb', (route) => route.abort())
    await boot(page)
    await page.evaluate(() => {
      const a = window.GAME_TEST_API!
      a.resetGame()
      a.setTime(12)
      a.setWeather('clear')
      a.teleportPlayer([6.0, 1.2, -5.4])
      a.setCameraZoomMul(2.6)
      a.setCameraAzimuth(0)
      a.setCameraLookY(0.9)
    })
    await settleAndPause(page)
    const st = await page.evaluate(() => window.GAME_TEST_API!.getCharacterState('npc_maya_01'))
    expect(st?.activeVisual, 'the named body is not what rendered').toBe('primitive')
    const rig = await page.evaluate(() => window.GAME_TEST_API!.getCharacterState('npc_maya_01#identity'))
    expect(rig?.assetId, 'the identity rig is what rendered').toBe('blocklife_person')
    expect(rig?.activeVisual, 'and it rendered its model, not a capsule').toBe('model')
    expect(rig?.appearance?.shirtColor, 'wearing her signature pink').toBe('#e0576f')
    await expect(page).toHaveScreenshot('wave4-fallback-resident.png', SHOT)
  })

  test('character: with BOTH rigs unreachable the chain ends at the authored capsule', async ({ page }) => {
    // The last step of the chain, so the whole thing is evidenced rather than asserted: with the
    // named body AND the identity rig both aborted, what is left is `NPCMesh` in the NPC's
    // authored `def.bodyColor` — the same last resort the base commit had beneath its own rig.
    await page.route('**/blocklife_maya_01.glb', (route) => route.abort())
    await page.route('**/blocklife_person.glb', (route) => route.abort())
    await boot(page)
    await page.evaluate(() => {
      const a = window.GAME_TEST_API!
      a.resetGame()
      a.setTime(12)
      a.setWeather('clear')
      a.teleportPlayer([6.0, 1.2, -5.4])
      a.setCameraZoomMul(2.6)
      a.setCameraAzimuth(0)
      a.setCameraLookY(0.9)
    })
    await settleAndPause(page)
    const rig = await page.evaluate(() => window.GAME_TEST_API!.getCharacterState('npc_maya_01#identity'))
    expect(rig?.activeVisual, 'the identity rig also fell back').toBe('primitive')
    await expect(page).toHaveScreenshot('wave4-fallback-resident-capsule.png', SHOT)
  })

  test('vehicle: an unreachable parked GLB restores the procedural car', async ({ page }) => {
    await page.route('**/parked_hatchback_01.glb', (route) => route.abort())
    await boot(page)
    await viewFrom(page, [16, 11.5], 'corner', BODY.hatchback, { gap: 5, fill: 0.5, fallback: true })
    await opaque(page, async () => {
      await expect(page).toHaveScreenshot('wave4-fallback-parked-car.png', SHOT)
    })
  })

  test('vehicle: an unreachable parked truck GLB restores the procedural truck', async ({ page }) => {
    await page.route('**/parked_delivery_van_01.glb', (route) => route.abort())
    await boot(page)
    await viewFrom(page, [53.6, -7.6], 'south', BODY['delivery-van'], { gap: 5, fill: 0.55, fallback: true })
    await opaque(page, async () => {
      await expect(page).toHaveScreenshot('wave4-fallback-parked-truck.png', SHOT)
    })
  })

  test('building: an unreachable tower GLB restores the procedural building', async ({ page }) => {
    await page.route('**/arch_apartment_02.glb', (route) => route.abort())
    await boot(page)
    await viewFrom(page, TOWER, 'east', { height: 14.5, width: 8, depth: 8 }, {
      gap: 8,
      fill: 0.75,
      fallback: true,
    })
    await opaque(page, async () => {
      await expect(page).toHaveScreenshot('wave4-fallback-tower.png', SHOT)
    })
  })
})
