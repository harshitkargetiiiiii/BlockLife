import { expect, test, type Page } from '@playwright/test'
import { acquireDrivableCar, pressE, waitForActiveInteractable } from '../e2e/helpers'

/**
 * Issue #38 Integration Wave 0 — required visual acceptance evidence.
 *
 * The Wave 0 statics (sedan / office / park bench) project onto EXISTING gameplay: the one
 * drivable shell, the authored `building_office_01` footprint and the authored `bench` prop
 * type. Nothing here proves gameplay — colliders, anchors and occlusion still come from
 * cityLayout. These baselines prove what a code diff cannot: which way a model faces, whether
 * the shell fits, whether a seated citizen lands on the bench, and whether the re-authored
 * night overlays actually sit on the replacement facades.
 *
 * The two Wave 0 CHARACTERS are candidates, not runtime assets (owner decision 2026-08-31 —
 * they carry one baked material and cannot expose the wardrobe / identity axes). They are
 * captured through the EXISTING, non-persistent DEV override (`setPlayerCharacterAsset`),
 * which renders a manifest def down the production AnimatedCharacter path. No runtime slot
 * changes: `npc_ravi_01` and the player both stay on `blocklife_person`, and every override is
 * cleared by the next test's `resetGame()`. The Ravi shots are a VISUAL PROXY for reviewing
 * that GLB only — they assert nothing about npc_ravi_01, his dialogue, quest or social wiring.
 *
 * The world is PAUSED before each shot, which snaps actors to canonical poses for
 * pixel-determinism; gait shots additionally pin the clip with `setProofFreezeTime` so
 * idle/walk/run are visibly distinct rather than collapsing to the idle first frame.
 * 3D-world shots allow a small pixel-diff ratio (low-poly AA on device pixels).
 */

const OFFICE: [number, number] = [16.5, -1] // cityLayout building_office_01, 7 x 9.5 x 7, door west
const BENCH: [number, number] = [-11.8, 5.6] // prop_bench_02, where cit_c_bench_napper sits
const PLAZA: [number, number] = [0, 0] // central_plaza — open ground, clear of trucks and labels
const SHOT = { maxDiffPixelRatio: 0.02 }

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

async function arrange(page: Page, at: [number, number], hour = 13, zoom = 1, azimuth = 0) {
  await page.evaluate(
    ([pos, h, z, az]) => {
      const a = window.GAME_TEST_API!
      a.resetGame()
      a.setTime(h as number)
      a.setWeather('clear')
      a.teleportPlayer([(pos as number[])[0], 1.2, (pos as number[])[1]])
      a.setCameraZoomMul(z as number)
      a.setCameraAzimuth(az as number) // DEV orbit delta; 0 = the shipped default view
    },
    [at, hour, zoom, azimuth] as const,
  )
}

/** Enter the one drivable shell through the SHIPPED path: walk to CAR_SPAWN, press E. */
async function driveTheShell(page: Page) {
  await acquireDrivableCar(page)
  // CAR_SPAWN is [10.5, 0.8, 14] — stand beside it, not where the player happens to be.
  await page.evaluate(() => window.GAME_TEST_API!.teleportPlayer([13, 1.2, 14]))
  await waitForActiveInteractable(page, 'vehicle_compact_car_01')
  await pressE(page)
  await page.waitForFunction(() => window.GAME_TEST_API!.getStats().mode === 'driving', undefined, {
    timeout: 10_000,
  })
}

/** Park the one shell at a fixed spot + heading beside the player, then freeze. */
async function stageSedan(page: Page, yaw: number, hour = 13) {
  await arrange(page, [0, -6], hour)
  await acquireDrivableCar(page)
  // setDrivenCarPosition seats the shell above the ground, so it needs settle time on a READY
  // sector floor; re-issue after the settle so the frozen pose is the grounded one.
  await page.evaluate((y) => window.GAME_TEST_API!.setDrivenCarPosition([0, -2], y), yaw)
  await page.waitForTimeout(900)
  await page.evaluate((y) => window.GAME_TEST_API!.setDrivenCarPosition([0, -2], y), yaw)
  await settleAndPause(page)
}

/** Render a CANDIDATE character in the player slot through the DEV override (non-persistent). */
async function stageCandidate(page: Page, id: string, hour = 13, zoom = 3.2) {
  // Orbit 180 deg: the rig's default heading faces away from the shipped camera, so the front
  // (face, wardrobe, hands) is only readable from the opposite side.
  await arrange(page, PLAZA, hour, zoom, Math.PI)
  await page.evaluate(() => window.GAME_TEST_API!.setCameraLookY(0.9))
  await page.evaluate((cid) => window.GAME_TEST_API!.setPlayerCharacterAsset(cid), id)
  await page.waitForFunction(
    () => window.GAME_TEST_API!.getCharacterState('player')?.modelLoaded === true,
    undefined,
    { timeout: 20_000 },
  )
}

const KABIR_GLB = 'assets/models/characters/blocklife_kabir_01.glb'

/**
 * Pin one EMBEDDED clip at a fixed time so idle/walk/run are visibly distinct.
 *
 * `forceCharacterAnimation` alone cannot do this: CharacterAnimationController.freezeAt(t)
 * calls resetToIdle() and then pins only the `idle` action, so a forced walk/run collapses back
 * to Idle before the frame is captured. The DEV proof def aliases EVERY semantic role to the one
 * requested clip, so the action freezeAt pins IS Walk or Run. This is a visual-only review path —
 * it renders through the real AnimatedCharacter controller and touches no runtime slot.
 */
async function freezeClip(page: Page, clip: 'Idle' | 'Walk' | 'Run', t: number) {
  await page.evaluate(() => window.GAME_TEST_API!.pauseWorld(false))
  await page.evaluate(() => window.GAME_TEST_API!.setProofFreezeTime(null))
  await page.evaluate(
    ([g, c]) => window.GAME_TEST_API!.setPlayerProofDef(g as string, c as string),
    [KABIR_GLB, clip] as const,
  )
  await page.evaluate(() => window.GAME_TEST_API!.forceCharacterAnimation('walk')) // all roles alias `clip`
  await page.waitForFunction(
    () => window.GAME_TEST_API!.getCharacterState('player')?.modelLoaded === true,
    undefined,
    { timeout: 20_000 },
  )
  await page.waitForTimeout(700)
  await page.evaluate(() => window.GAME_TEST_API!.pauseWorld(true))
  await page.evaluate((tt) => window.GAME_TEST_API!.setProofFreezeTime(tt), t)
  await page.waitForTimeout(700)
}

// ---------------------------------------------------------------- sedan ----
// The GLB is yawed 90 deg, so local X becomes world LENGTH and local Z world WIDTH. If those
// scale axes are swapped the shell reads too narrow head-on and too long side-on — these four
// indexed views are exactly where that shows.
test.describe('Wave 0 — sedan shell', () => {
  const VIEWS: [string, number, string][] = [
    ['front', 0, 'nose toward -Z: reads world WIDTH (2.00 m)'],
    ['side-right', Math.PI / 2, 'broadside: reads world LENGTH (3.81 m)'],
    ['rear', Math.PI, 'tail toward -Z: width again, rear end'],
    ['side-left', -Math.PI / 2, 'opposite broadside: symmetry + wheel contact'],
  ]
  for (const [name, yaw, why] of VIEWS) {
    test(`cardinal ${name} — ${why}`, async ({ page }) => {
      await boot(page)
      await stageSedan(page, yaw)
      await expect(page).toHaveScreenshot(`wave0-sedan-cardinal-${name}.png`, SHOT)
    })
  }

  test('night lighting — paint and emissive under the night rig', async ({ page }) => {
    await boot(page)
    await stageSedan(page, Math.PI / 4, 22)
    await expect(page).toHaveScreenshot('wave0-sedan-night.png', SHOT)
  })

  test('player drives the sedan — seat and body alignment', async ({ page }) => {
    await boot(page)
    await page.evaluate(() => {
      const a = window.GAME_TEST_API!
      a.resetGame()
      a.setTime(13)
      a.setWeather('clear')
    })
    await driveTheShell(page)
    await page.evaluate(() => window.GAME_TEST_API!.setDrivenCarPosition([0, -2], 0.35))
    await page.waitForTimeout(900)
    await settleAndPause(page)
    await expect(page).toHaveScreenshot('wave0-sedan-driving-seat.png', SHOT)
  })
})

// --------------------------------------------------------------- office ----
test.describe('Wave 0 — office massing', () => {
  // Four cardinal views: the replacement model must read as a coherent building from every
  // side and stay inside the authored 7x7 footprint. Occlusion is disabled for these so the
  // massing is opaque and judgeable — the fade is proved separately below.
  const AROUND: [string, [number, number]][] = [
    ['north', [OFFICE[0], OFFICE[1] - 9]],
    ['east', [OFFICE[0] + 9, OFFICE[1]]],
    ['south', [OFFICE[0], OFFICE[1] + 9]],
    ['west', [OFFICE[0] - 9, OFFICE[1]]],
  ]
  for (const [name, at] of AROUND) {
    test(`cardinal ${name} facade (opaque)`, async ({ page }) => {
      await boot(page)
      await arrange(page, at)
      await page.evaluate(() => window.GAME_TEST_API!.setOcclusionEnabled(false))
      await settleAndPause(page)
      await expect(page).toHaveScreenshot(`wave0-office-cardinal-${name}.png`, SHOT)
      await page.evaluate(() => window.GAME_TEST_API!.setOcclusionEnabled(true))
    })
  }

  // cityLayout authors door: 'west', so the entrance must read as facing west (job kiosk side).
  // This is the OPAQUE control: occlusion off, so the facade is actually inspectable.
  test('entrance reads opaque on the authored west door side', async ({ page }) => {
    await boot(page)
    await arrange(page, [OFFICE[0] - 6.5, OFFICE[1] + 1])
    await page.evaluate(() => window.GAME_TEST_API!.setOcclusionEnabled(false))
    await settleAndPause(page)
    await expect(page).toHaveScreenshot('wave0-office-entrance-west.png', SHOT)
    await page.evaluate(() => window.GAME_TEST_API!.setOcclusionEnabled(true))
  })

  // The opposite state: the model changed, the occlusion contract did not. The player stands
  // behind the massing on the camera ray and the building must actually fade.
  test('occludes the player and fades', async ({ page }) => {
    await boot(page)
    await arrange(page, [11.5, -6.5])
    await page.waitForFunction(
      () =>
        window
          .GAME_TEST_API!.getVisibilityState()
          .faded.some((f) => f.id === 'building_office_01' && f.opacity < 0.5),
      undefined,
      { timeout: 15_000 },
    )
    await settleAndPause(page)
    await expect(page).toHaveScreenshot('wave0-office-occlusion.png', SHOT)
  })

  // The old Building_Large_2 distances left these emissive planes ~0.40 m (east) and ~1.03 m
  // (south) off the new walls — at night that reads as windows hanging beside the building.
  test('night windows sit on the replacement facades', async ({ page }) => {
    await boot(page)
    await arrange(page, [OFFICE[0] - 8, OFFICE[1] + 5], 22)
    await page.evaluate(() => window.GAME_TEST_API!.setOcclusionEnabled(false))
    await settleAndPause(page)
    await expect(page).toHaveScreenshot('wave0-office-night-windows.png', SHOT)
    await page.evaluate(() => window.GAME_TEST_API!.setOcclusionEnabled(true))
  })
})

// ---------------------------------------------------------------- bench ----
// Close and unobstructed: at play distance the bench is a few dozen pixels and cannot be
// judged. These two are framed tight enough to read ground contact, seat height and texture.
test.describe('Wave 0 — park bench', () => {
  // prop_park_tree_01 [-9.0, 8.0] sits at (+2.8, +2.4) from the bench, which in the DEFAULT view
  // is directly between the camera and the bench — it covered the seat and the sitter's legs,
  // i.e. exactly the alignment these shots exist to prove. So both bench shots orbit the DEV
  // camera 180 degrees, which puts the tree BEHIND the bench, and stand the player just behind
  // the bench so its own body never crosses the seat. The camera centres on the player, so the
  // framing comes from a small offset plus a modest zoom, not from a long lens.
  test('empty bench — ground contact, seat height, proportions', async ({ page }) => {
    await boot(page)
    await arrange(page, [-10.4, 6.9], 8, 2.1, Math.PI) // hour 8: before the napper's 10-18 window
    await settleAndPause(page)
    await expect(page).toHaveScreenshot('wave0-bench-empty.png', SHOT)
  })

  // cit_c_bench_napper sits at exactly the bench's authored position, so this proves the GLB's
  // seat matches the sit pose the citizen system already uses.
  test('occupied bench — citizen sit pose alignment', async ({ page }) => {
    await boot(page)
    await arrange(page, [-10.4, 6.9], 13, 2.1, Math.PI)
    await settleAndPause(page)
    await expect(page).toHaveScreenshot('wave0-bench-occupied.png', SHOT)
  })

  // Only the context shot stays wide — the bench read among the other central-district props,
  // where a wrong scale or palette would stand out.
  test('district context — bench among central props', async ({ page }) => {
    await boot(page)
    await arrange(page, [BENCH[0] + 9, BENCH[1] + 7], 13)
    await settleAndPause(page)
    await expect(page).toHaveScreenshot('wave0-bench-district-context.png', SHOT)
  })
})

// ------------------------------------------------- candidate characters ----
// NOT runtime assets. Captured through the non-persistent DEV override only; no NPC def and no
// player default is touched, and each test's resetGame() clears the previous override. Staged
// on the open plaza and zoomed so face, baked wardrobe, hands, feet and silhouette are all
// judgeable.
test.describe('Wave 0 — candidate characters (DEV override only)', () => {
  // Times chosen inside each clip's own duration (Idle 0.300s / Walk 1.067s / Run 0.667s) at
  // poses that differ obviously — mid-stride for Walk, airborne push for Run.
  for (const [clip, t] of [['Idle', 0.15], ['Walk', 0.55], ['Run', 0.17]] as const) {
    test(`Kabir candidate — ${clip} clip on the production rig`, async ({ page }) => {
      await boot(page)
      // Orbit 180 deg so the camera reads his FRONT (the rig's default heading faces away),
      // and raise the look-at target so the frame reads face and torso rather than the waist.
      await arrange(page, PLAZA, 13, 4.6, Math.PI)
      await page.evaluate(() => window.GAME_TEST_API!.setCameraLookY(0.9))
      await freezeClip(page, clip, t)
      await expect(page).toHaveScreenshot(`wave0-candidate-kabir-${clip.toLowerCase()}.png`, SHOT)
    })
  }

  test('Kabir candidate — night lighting', async ({ page }) => {
    await boot(page)
    await stageCandidate(page, 'blocklife_kabir_01', 22, 4.2)
    await settleAndPause(page)
    await expect(page).toHaveScreenshot('wave0-candidate-kabir-night.png', SHOT)
  })

  // Entering the car must hide/seat the candidate exactly as the default rig does — the
  // override must not leak a second visible body while driving.
  test('Kabir candidate — driving transition', async ({ page }) => {
    await boot(page)
    await page.evaluate(() => {
      const a = window.GAME_TEST_API!
      a.resetGame()
      a.setTime(13)
      a.setWeather('clear')
      a.setPlayerCharacterAsset('blocklife_kabir_01')
    })
    await driveTheShell(page)
    await page.evaluate(() => window.GAME_TEST_API!.setDrivenCarPosition([0, -2], 0.35))
    await page.waitForTimeout(900)
    await settleAndPause(page)
    await expect(page).toHaveScreenshot('wave0-candidate-kabir-driving-transition.png', SHOT)
  })

  // Ravi is reviewed as a VISUAL PROXY through the same non-persistent override. npc_ravi_01
  // keeps blocklife_person and every identity/accessory/dialogue mapping — nothing here
  // asserts otherwise.
  test('Ravi candidate — close read (visual proxy only)', async ({ page }) => {
    await boot(page)
    await stageCandidate(page, 'blocklife_ravi_01', 13, 4.6)
    await settleAndPause(page)
    await expect(page).toHaveScreenshot('wave0-candidate-ravi-close.png', SHOT)
  })

  test('Ravi candidate — wide read (visual proxy only)', async ({ page }) => {
    await boot(page)
    await stageCandidate(page, 'blocklife_ravi_01', 13, 2.2)
    await settleAndPause(page)
    await expect(page).toHaveScreenshot('wave0-candidate-ravi-wide.png', SHOT)
  })
})
