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
/**
 * The open central plaza. Chosen by probing four candidates: it is the only one that frames the
 * whole vehicle on flat, uncluttered pavement with all wheels and their ground contact readable.
 * (`[0, -2]` sits beside Maya's Snack Truck at `[1.5, -6.5]`, which obstructed the subject.)
 */
const STAGE: [number, number] = [0, 0]
/**
 * The camera centres on the PLAYER, so the subject is framed by standing just off the vehicle
 * rather than by a long lens. Close enough that a 2.4x zoom fills the frame with the whole
 * vehicle — issue #40 rejects evidence that crops the model or hides a wheel's ground contact.
 */
const VIEWER: [number, number] = [0, 4]
const CLOSE = 2.0

type ClassId = 'veh_scooter' | 'veh_van' | 'veh_sports' | 'veh_compact'

/**
 * `parkedView` is deliberately PER CLASS, not shared. The camera centres on the player, so one
 * viewer position cannot frame three vehicles of very different size at the dealership bay: the
 * framing that keeps the 4.74 m van and the 3.88 m coupe clear of the player's body pushes the
 * 2.13 m scooter too far away to judge, and the framing that reads the scooter puts the player's
 * body over the van's front corner and near wheel — the ground contact these shots must prove.
 */
const CLASSES: {
  id: ClassId
  slug: string
  label: string
  parkedView: { at: [number, number]; zoom: number }
}[] = [
  { id: 'veh_scooter', slug: 'scooter', label: 'City Scooter', parkedView: { at: [24, 12.6], zoom: CLOSE } },
  { id: 'veh_van', slug: 'van', label: 'Utility Van', parkedView: { at: [27.4, 14.6], zoom: 1.75 } },
  { id: 'veh_sports', slug: 'sports', label: 'Premium Sports Car', parkedView: { at: [27.4, 14.6], zoom: 1.75 } },
]

async function boot(page: Page) {
  await page.goto('/')
  await page.waitForFunction(() => window.GAME_TEST_API?.ready() === true, undefined, { timeout: 45_000 })
  // Wait for the GLBs to actually mount, or a shot races the fallback->model swap.
  await page.waitForFunction(() => window.GAME_TEST_API?.assetsSettled() === true, undefined, {
    timeout: 45_000,
  })
}

/**
 * A vehicle GLB only mounts once a class is ACTIVE or parked, i.e. AFTER the grant — so the
 * boot-time `assetsSettled()` says nothing about it. Without re-waiting here a shot races the
 * CarMesh -> GLB swap and photographs whichever won, which is exactly how a "stable" baseline
 * ends up recording the fallback.
 */
async function waitForVehicleGlb(page: Page) {
  await page.waitForFunction(() => window.GAME_TEST_API?.assetsSettled() === true, undefined, {
    timeout: 30_000,
  })
}

async function settleAndPause(page: Page) {
  await waitForVehicleGlb(page)
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
async function stageActive(page: Page, defId: ClassId, yaw: number, hour = 13, zoom = CLOSE) {
  await arrange(page, VIEWER, hour, zoom)
  await page.evaluate((id) => window.GAME_TEST_API!.vehicleGrant(id, { location: 'active' }), defId)
  await page.waitForTimeout(200)
  // setDrivenCarPosition seats the shell above the ground, so it needs settle time on a READY
  // sector floor; re-issue after the settle so the frozen pose is the grounded one.
  const place = async () =>
    page.evaluate(
      ([pos, y]) => window.GAME_TEST_API!.setDrivenCarPosition(pos as [number, number], y as number),
      [STAGE, yaw] as const,
    )
  await place()
  await page.waitForTimeout(900)
  await place()
  await settleAndPause(page)
}

// ------------------------------------------------------- per-class evidence ----
for (const { id, slug, label, parkedView } of CLASSES) {
  test.describe(`Wave 1 — ${label}`, () => {
    // Broadside reads world LENGTH; head-on reads world WIDTH. If the manifest's local X/Z were
    // swapped — or the shell's per-class mesh scale were ignored — exactly these two disagree.
    test(`${slug}: active side view — full length, every wheel on the ground`, async ({ page }) => {
      await boot(page)
      await stageActive(page, id, Math.PI / 2)
      await expect(page).toHaveScreenshot(`wave1-${slug}-active-side.png`, SHOT)
    })

    test(`${slug}: active front view — width and ride height`, async ({ page }) => {
      await boot(page)
      await stageActive(page, id, 0)
      await expect(page).toHaveScreenshot(`wave1-${slug}-active-front.png`, SHOT)
    })

    // Parked at the authored dealership bay through the real parking anchor, which is where a
    // player first sees a class they do not own yet.
    test(`${slug}: parked at the dealership bay`, async ({ page }) => {
      await boot(page)
      // Per-class viewer (see CLASSES): the camera centres on the PLAYER, so the vehicle must be
      // framed by where the player stands relative to the bay at [24, 10].
      await arrange(page, parkedView.at, 13, parkedView.zoom)
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
      await arrange(page, VIEWER, 13, CLOSE)
      await page.evaluate((defId) => window.GAME_TEST_API!.vehicleGrant(defId, { location: 'active' }), id)
      await page.waitForTimeout(200)
      // Enter through the SHIPPED path, at the shell's own spawn where its interactable is
      // unambiguously the nearest one — then drive it to the staging pose. Entering at the
      // staged pose instead let a nearer plaza interactable win the "press E" target.
      await page.evaluate(() => window.GAME_TEST_API!.teleportPlayer([13, 1.2, 14]))
      await waitForActiveInteractable(page, 'vehicle_compact_car_01')
      await pressE(page)
      await page.waitForFunction(() => window.GAME_TEST_API!.getStats().mode === 'driving', undefined, {
        timeout: 10_000,
      })
      const place = async () =>
        page.evaluate(
          ([pos, y]) => window.GAME_TEST_API!.setDrivenCarPosition(pos as [number, number], y as number),
          [STAGE, Math.PI / 2] as const,
        )
      await place()
      await page.waitForTimeout(900)
      await place()
      // Entering driving mode installs the driving camera, which overrides the zoom `arrange`
      // set — so re-apply it here, after the mode switch, or the occupant is a few pixels wide
      // and the seat alignment this shot exists to prove cannot be judged.
      await page.evaluate(() => {
        const a = window.GAME_TEST_API!
        a.setCameraZoomMul(3.1)
        a.setCameraAzimuth(0)
      })
      await settleAndPause(page)
      await expect(page).toHaveScreenshot(`wave1-${slug}-occupied.png`, SHOT)
    })

    // Night: the Wave 1 bodies are the first vehicles to carry a baked base-colour TEXTURE
    // (the retired ones were untextured, metallic 0.15). A texture that reads as self-lit —
    // or an emissive factor that slipped through intake — shows here and nowhere else.
    test(`${slug}: night — no self-glow under the night rig`, async ({ page }) => {
      await boot(page)
      await stageActive(page, id, Math.PI / 4, 22)
      await expect(page).toHaveScreenshot(`wave1-${slug}-night.png`, SHOT)
    })
  })
}

/**
 * Issue #40 requires the utility van's DRIVER + PASSENGER alignment specifically, and the generic
 * occupied shot seats only the driver (`showPassenger` is gated on a real ride passenger).
 *
 * This stages a genuine one through the SAME production social path gameplay uses — befriend
 * Maya, own and retrieve a van, invite her to drive via Contacts, start the plan from Messages —
 * exactly as `tests/visual/vehicle-visuals.spec.ts` already does. No DEV passenger write hook is
 * introduced; `vehicleRidePassenger()` stays read-only.
 */
test('Wave 1 — utility van: driver AND passenger seated in the cab', async ({ page }) => {
  await boot(page)
  await page.evaluate(() => {
    const a = window.GAME_TEST_API!
    a.resetGame()
    a.setTime(12) // Maya is available 10–20, so the drive invite is accepted + startable
    a.setWeather('clear')
  })
  type Api = Record<string, (...a: unknown[]) => unknown>
  const api = (method: string, ...args: unknown[]) =>
    page.evaluate(
      ([m, a]) => (window.GAME_TEST_API as unknown as Api)[m as string](...(a as unknown[])),
      [method, args] as const,
    )

  for (let i = 0; i < 5; i++) {
    await api('ingestSocialEvent', {
      id: `wave1_van_ride_${i}`, kind: 'activity_completed', actorId: 'npc_maya_01', gameDay: 1, gameHour: 12,
    })
  }
  const owned = (await api('vehicleGrant', 'veh_van', {
    location: 'parked', anchorId: 'park_public_central',
  })) as string
  await api('vehicleStandAtAnchor', 'park_public_central')
  await api('vehicleRetrieve', owned)
  await page.waitForTimeout(300)

  await api('openPhoneApp', 'contacts')
  await page.getByTestId('contact-invite-drive-npc_maya_01').click()
  const invitations = (await api('getSocialInvitations')) as Array<{
    id: string; activityKind: string; status: string; actorId: string
  }>
  const plan = invitations.find(
    (i) => i.activityKind === 'drive_around' && i.actorId === 'npc_maya_01' && i.status === 'accepted',
  )!
  await api('openPhoneApp', 'messages')
  await page.getByTestId(`plan-start-${plan.id}`).click()
  await page.keyboard.press('Tab') // close the phone for a clean shot

  // Both occupants must actually be aboard before the shot, or this proves nothing.
  await page.waitForFunction(() => window.GAME_TEST_API!.vehicleRidePassenger() != null, undefined, {
    timeout: 20_000,
  })
  // Yaw 0 puts the nose toward the camera. This shot exists to prove the two seats are ALIGNED
  // side by side in the cab, and a broadside view hides the far one behind the A-pillar and the
  // roof overhang — so the front three-quarter is the only angle that shows both.
  const place = async () =>
    page.evaluate(
      ([pos, y]) => window.GAME_TEST_API!.setDrivenCarPosition(pos as [number, number], y as number),
      [STAGE, 0] as const,
    )
  await place()
  await page.waitForTimeout(900)
  await place()
  await page.evaluate(() => {
    const a = window.GAME_TEST_API!
    a.setCameraZoomMul(3.1)
    a.setCameraAzimuth(0)
  })
  await settleAndPause(page)
  await expect(page).toHaveScreenshot('wave1-van-driver-and-passenger.png', SHOT)
})

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
  await arrange(page, [27, 16], 13, 1.9)
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
