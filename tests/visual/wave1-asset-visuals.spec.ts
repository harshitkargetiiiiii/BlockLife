import { expect, test, type Page } from '@playwright/test'
import { pressE, waitForActiveInteractable } from '../e2e/helpers'

/**
 * Issue #40 Integration Wave 1 — required visual acceptance evidence.
 *
 * The three Wave 1 bodies (scooter / utility van / sports coupe) project onto the SAME one
 * physical driving shell the compact sedan already uses. Nothing here proves gameplay —
 * colliders, tuning, occupants, ownership and save all come from `getActiveVehicleProjection()`,
 * never from a model. These baselines prove what a code diff cannot:
 *
 *  - which way each body faces (the local-X/local-Z axis swap issue #38's review caught),
 *  - that the whole vehicle is present with every wheel touching the ground,
 *  - that the four classes read as four visibly DIFFERENT vehicles, and
 *  - that nothing self-glows at night now that a baked-texture body replaced an untextured one.
 *
 * Each body's rendered size is the product of TWO factors — the manifest scale and the shell's
 * per-class `shellMeshScale` — so a shot that looks right is the only end-to-end proof that both
 * were accounted for. `wave1Contract.test.ts` gates the arithmetic; these gate the pixels.
 *
 * The world is PAUSED before each shot, which snaps actors to canonical poses for
 * pixel-determinism. 3D-world shots allow a small pixel-diff ratio (low-poly AA on device pixels).
 */

const SHOT = { maxDiffPixelRatio: 0.02 }
/** Open ground south of the plaza — clear of trucks, labels and parked traffic. */
const STAGE: [number, number] = [0, -2]

type ClassId = 'veh_scooter' | 'veh_van' | 'veh_sports' | 'veh_compact'

const CLASSES: { id: ClassId; slug: string; label: string }[] = [
  { id: 'veh_scooter', slug: 'scooter', label: 'City Scooter' },
  { id: 'veh_van', slug: 'van', label: 'Utility Van' },
  { id: 'veh_sports', slug: 'sports', label: 'Premium Sports Car' },
]

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

/**
 * Project one owned CLASS onto the one shell and park it at a fixed pose beside the player.
 * `vehicleGrant(..., 'active')` is the existing ARRANGE hook — it mints an owned asset through
 * the real ownership runtime, so the shell wears that class's projection exactly as it would
 * after a dealership purchase.
 */
async function stageActive(page: Page, defId: ClassId, yaw: number, hour = 13, zoom = 1) {
  await arrange(page, STAGE, hour, zoom)
  await page.evaluate((id) => window.GAME_TEST_API!.vehicleGrant(id, { location: 'active' }), defId)
  await page.waitForTimeout(200)
  // setDrivenCarPosition seats the shell above the ground, so it needs settle time on a READY
  // sector floor; re-issue after the settle so the frozen pose is the grounded one.
  await page.evaluate((y) => window.GAME_TEST_API!.setDrivenCarPosition(STAGE, y), yaw)
  await page.waitForTimeout(900)
  await page.evaluate((y) => window.GAME_TEST_API!.setDrivenCarPosition(STAGE, y), yaw)
  await settleAndPause(page)
}

// ------------------------------------------------------- per-class evidence ----
for (const { id, slug, label } of CLASSES) {
  test.describe(`Wave 1 — ${label}`, () => {
    // Broadside reads world LENGTH; head-on reads world WIDTH. If the manifest's local X/Z were
    // swapped — or the shell's per-class mesh scale were ignored — exactly these two disagree.
    test(`${slug}: active side view — full length, every wheel on the ground`, async ({ page }) => {
      await boot(page)
      await stageActive(page, id, Math.PI / 2, 13, 1.8)
      await expect(page).toHaveScreenshot(`wave1-${slug}-active-side.png`, SHOT)
    })

    test(`${slug}: active front view — width and ride height`, async ({ page }) => {
      await boot(page)
      await stageActive(page, id, 0, 13, 1.8)
      await expect(page).toHaveScreenshot(`wave1-${slug}-active-front.png`, SHOT)
    })

    // Parked at the authored dealership bay through the real parking anchor, which is where a
    // player first sees a class they do not own yet.
    test(`${slug}: parked at the dealership bay`, async ({ page }) => {
      await boot(page)
      await arrange(page, [24, 13.5], 13, 1.6)
      await page.evaluate(
        (defId) => window.GAME_TEST_API!.vehicleGrant(defId, { location: 'parked', anchorId: 'park_dealer_a' }),
        id,
      )
      await settleAndPause(page)
      await expect(page).toHaveScreenshot(`wave1-${slug}-parked-dealership.png`, SHOT)
    })

    // The player actually seated in it: seat alignment + ground contact under load. The occupant
    // indicator is a CarFittings mesh, so this also proves the GLB body did not displace it.
    test(`${slug}: occupied — driver seat alignment and ground contact`, async ({ page }) => {
      await boot(page)
      await arrange(page, STAGE, 13, 1.8)
      await page.evaluate((defId) => window.GAME_TEST_API!.vehicleGrant(defId, { location: 'active' }), id)
      await page.waitForTimeout(200)
      // Enter through the SHIPPED path: stand beside the shell, press E.
      await page.evaluate(() => window.GAME_TEST_API!.setDrivenCarPosition([0, -2], Math.PI / 2))
      await page.waitForTimeout(600)
      await page.evaluate(() => window.GAME_TEST_API!.teleportPlayer([2.6, 1.2, -2]))
      await waitForActiveInteractable(page, 'vehicle_compact_car_01')
      await pressE(page)
      await page.waitForFunction(() => window.GAME_TEST_API!.getStats().mode === 'driving', undefined, {
        timeout: 10_000,
      })
      await page.evaluate(() => window.GAME_TEST_API!.setDrivenCarPosition([0, -2], Math.PI / 2))
      await page.waitForTimeout(900)
      await settleAndPause(page)
      await expect(page).toHaveScreenshot(`wave1-${slug}-occupied.png`, SHOT)
    })

    // Night: the Wave 1 bodies are the first vehicles to carry a baked base-colour TEXTURE
    // (the retired ones were untextured, metallic 0.15). A texture that reads as self-lit —
    // or an emissive factor that slipped through intake — shows here and nowhere else.
    test(`${slug}: night — no self-glow under the night rig`, async ({ page }) => {
      await boot(page)
      await stageActive(page, id, Math.PI / 4, 22, 1.8)
      await expect(page).toHaveScreenshot(`wave1-${slug}-night.png`, SHOT)
    })
  })
}

// ------------------------------------------------------------------ lineup ----
/**
 * The single most important shot in this wave: all four owned classes side by side. Before
 * Wave 1 every class projected the compact car's scale constants, so a "scooter" rendered
 * 3.89 m long — longer than its own 2.2 m footprint — and the garage read as four repaints of
 * one car. Three of the four are parked at real anchors and one is the active shell, so this is
 * also the parked-vs-active comparison in one frame.
 */
test('Wave 1 — four-class lineup: compact, scooter, van and sports are visibly distinct', async ({
  page,
}) => {
  await boot(page)
  await arrange(page, [27, 16.5], 13, 2.6)
  await page.evaluate(() => {
    const a = window.GAME_TEST_API!
    a.vehicleGrant('veh_scooter', { location: 'parked', anchorId: 'park_dealer_a' })
    a.vehicleGrant('veh_van', { location: 'parked', anchorId: 'park_dealer_b' })
    a.vehicleGrant('veh_sports', { location: 'parked', anchorId: 'park_service' })
    a.vehicleGrant('veh_compact', { location: 'parked', anchorId: 'park_recovery' })
  })
  await settleAndPause(page)
  await expect(page).toHaveScreenshot('wave1-four-class-lineup.png', SHOT)
})

// The missing-file / disabled-model fallback contract is proved PER CLASS at the unit level in
// `src/game/assets/VehicleAsset.test.tsx` ("every owned vehicle class falls back to CarMesh when
// its GLB is missing"), which drives the real manifest entries through the real adapter. There is
// no runtime hook to disable a vehicle GLB in a browser session, and issue #40 forbids adding a
// new projection/test path just to photograph it — so that contract is gated there, not here.
