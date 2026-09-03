import { expect, test, type Page } from '@playwright/test'
import { waitForSceneSettled } from './visualHelpers'

/**
 * Vehicle Ownership, Parking & Customization v1 (issue #19) visual baselines. Deterministic:
 * fixed time + clear weather, state driven through the dev API, the world PAUSED before each shot.
 * Garage-app surfaces are scoped to the phone app element (stable DOM); the driving/parked surfaces
 * shoot the paused viewport with the shell/owned cars projected. 16 surfaces (incl. wheel styles §9
 * and an NPC ride passenger §11).
 */
type Api = Record<string, (...a: unknown[]) => unknown>
function api(page: Page, method: string, ...args: unknown[]) {
  return page.evaluate(([m, a]) => (window.GAME_TEST_API as unknown as Api)[m as string](...(a as unknown[])), [method, args] as const)
}
async function ready(page: Page): Promise<void> {
  await page.goto('/')
  await page.waitForFunction(() => window.GAME_TEST_API?.ready() === true, undefined, { timeout: 45_000 })
  await waitForSceneSettled(page)
  await page.evaluate(() => {
    const a = window.GAME_TEST_API!
    a.resetGame()
    a.setTime(13)
    a.setWeather('clear')
  })
  await api(page, 'setMoney', 100000)
  for (const d of ['veh_scooter', 'veh_compact', 'veh_van', 'veh_sports']) await api(page, 'vehicleSetDealershipStock', d, 5)
  await page.waitForTimeout(250)
}
async function freeze(page: Page): Promise<void> {
  await page.evaluate(() => window.GAME_TEST_API!.pauseWorld(true))
  await page.waitForTimeout(200)
}
// A freshly granted/retrieved vehicle's GLB mounts a frame AFTER the action, so a settle check
// taken immediately still describes the boot scene. The fixed 1.5 s that used to bridge that
// gap was a race with a longer fuse; `waitForSceneSettled` closes it properly by requiring the
// mount graph to hold still, and `requireGlb` proves the shot has the vehicle BODY rather than
// the CarShell fallback (that swap made driving-with-passenger flaky once the classes shipped
// real GLBs). The caller passes the asset id of the class it just granted.
/** Owned-vehicle class -> the manifest body it projects, so a shot can name what it needs. */
const VEHICLE_ASSET: Record<string, string> = {
  veh_compact: 'vehicle_compact_car_01',
  veh_van: 'vehicle_utility_van_01',
  veh_scooter: 'vehicle_scooter_01',
  veh_sports: 'vehicle_sports_car_01',
}
async function settleVehicle(page: Page, ...requireGlb: string[]): Promise<void> {
  await waitForSceneSettled(page, { requireGlb, timeout: 25_000 })
}
async function openGarage(page: Page): Promise<void> {
  await api(page, 'openPhoneApp', 'garage')
  await page.waitForTimeout(200)
}
const garage = (page: Page) => page.getByTestId('phone-garage')
async function grant(page: Page, defId: string, opts: Record<string, unknown>): Promise<string> {
  return (await api(page, 'vehicleGrant', defId, opts)) as string
}

test.describe('Vehicle Ownership v1 — visuals', () => {
  test('garage dealership listings', async ({ page }) => {
    await ready(page)
    await openGarage(page)
    await freeze(page)
    await expect(garage(page)).toHaveScreenshot('garage-dealership.png')
  })

  test('garage with one owned compact', async ({ page }) => {
    await ready(page)
    await api(page, 'vehicleBuy', 'veh_compact')
    await openGarage(page)
    await freeze(page)
    await expect(garage(page)).toHaveScreenshot('garage-owned-compact.png')
  })

  test('garage with a mixed owned fleet', async ({ page }) => {
    await ready(page)
    await grant(page, 'veh_compact', { location: 'parked', anchorId: 'park_home_studio' })
    await grant(page, 'veh_van', { location: 'parked', anchorId: 'park_public_central' })
    await grant(page, 'veh_scooter', { location: 'parked', anchorId: 'park_public_downtown' })
    await openGarage(page)
    await freeze(page)
    await expect(garage(page)).toHaveScreenshot('garage-fleet.png')
  })

  test('garage customize & cargo panel open', async ({ page }) => {
    await ready(page)
    const id = await grant(page, 'veh_compact', { location: 'parked', anchorId: 'park_public_central' })
    await api(page, 'giveItem', 'snack', 2)
    await openGarage(page)
    await page.getByTestId(`garage-owned-${id}`).locator('summary').click()
    await freeze(page)
    await expect(garage(page)).toHaveScreenshot('garage-customize.png')
  })

  test('garage sports car locked without career', async ({ page }) => {
    await ready(page)
    await openGarage(page)
    await freeze(page)
    await expect(page.getByTestId('garage-listing-veh_sports')).toHaveScreenshot('garage-sports-locked.png')
  })

  test('garage impounded vehicle card', async ({ page }) => {
    await ready(page)
    await grant(page, 'veh_van', { location: 'impound' })
    await openGarage(page)
    await freeze(page)
    await expect(garage(page)).toHaveScreenshot('garage-impounded.png')
  })

  test('garage worn vehicle with repair option', async ({ page }) => {
    await ready(page)
    await grant(page, 'veh_compact', { location: 'parked', anchorId: 'park_public_central', condition: 35 })
    await openGarage(page)
    await freeze(page)
    await expect(garage(page)).toHaveScreenshot('garage-worn.png')
  })

  // ---- 3D world surfaces (the one shell projects the active class) ----
  for (const [defId, name] of [
    ['veh_compact', 'driving-compact'],
    ['veh_van', 'driving-van'],
    ['veh_scooter', 'driving-scooter'],
    ['veh_sports', 'driving-sports'],
  ] as const) {
    test(`driving an owned ${defId}`, async ({ page }) => {
      await ready(page)
      const id = await grant(page, defId, { location: 'parked', anchorId: 'park_public_central' })
      await api(page, 'vehicleRetrieve', id)
      await settleVehicle(page, VEHICLE_ASSET[defId])
      await freeze(page)
      await expect(page).toHaveScreenshot(`${name}.png`, { maxDiffPixelRatio: 0.02 })
    })
  }

  test('a lot of owned parked vehicles', async ({ page }) => {
    await ready(page)
    await grant(page, 'veh_compact', { location: 'parked', anchorId: 'park_dealer_a' })
    await grant(page, 'veh_van', { location: 'parked', anchorId: 'park_public_central' })
    await api(page, 'teleportPlayer', [24, 1.2, 16])
    await settleVehicle(page, 'vehicle_compact_car_01', 'vehicle_utility_van_01')
    await freeze(page)
    await expect(page).toHaveScreenshot('parked-lot.png', { maxDiffPixelRatio: 0.02 })
  })

  test('a custom-painted sports car parked', async ({ page }) => {
    await ready(page)
    const id = await grant(page, 'veh_sports', { location: 'parked', anchorId: 'park_public_central' })
    await api(page, 'vehicleStandAtAnchor', 'park_service') // paint requires the authored service bay (§7/§9)
    await api(page, 'vehiclePaint', id, '#2c2c33')
    await api(page, 'teleportPlayer', [22, 1.2, 20])
    await settleVehicle(page, 'vehicle_sports_car_01')
    await freeze(page)
    await expect(page).toHaveScreenshot('painted-sports.png', { maxDiffPixelRatio: 0.02 })
  })

  test('a sports car with off-road wheels fitted', async ({ page }) => {
    await ready(page)
    const id = await grant(page, 'veh_sports', { location: 'parked', anchorId: 'park_public_central' })
    await api(page, 'vehicleStandAtAnchor', 'park_service') // wheels are a service-bay customization (§9)
    await api(page, 'vehicleSetWheels', id, 'wheels_offroad')
    await api(page, 'teleportPlayer', [22, 1.2, 20])
    await settleVehicle(page, 'vehicle_sports_car_01')
    await freeze(page)
    await expect(page).toHaveScreenshot('wheels-offroad.png', { maxDiffPixelRatio: 0.02 })
  })

  test('driving with an NPC passenger along for the ride', async ({ page }) => {
    await ready(page)
    await api(page, 'setTime', 12) // Maya is available 10–20 → the drive invite is accepted + startable
    // Befriend Maya to a friend + contact, own a usable van and get in it, then give her a ride
    // through the SAME production social UI as gameplay (Contacts invite → Chats start — §11).
    for (let i = 0; i < 5; i++) await api(page, 'ingestSocialEvent', { id: `ride_vis_${i}`, kind: 'activity_completed', actorId: 'npc_maya_01', gameDay: 1, gameHour: 12 })
    const id = await grant(page, 'veh_van', { location: 'parked', anchorId: 'park_public_central' })
    await api(page, 'vehicleStandAtAnchor', 'park_public_central')
    await api(page, 'vehicleRetrieve', id)
    await page.waitForTimeout(300)
    await api(page, 'openPhoneApp', 'contacts')
    await page.getByTestId('contact-invite-drive-npc_maya_01').click()
    const invs = (await api(page, 'getSocialInvitations')) as Array<{ id: string; activityKind: string; status: string; actorId: string }>
    const plan = invs.find((i) => i.activityKind === 'drive_around' && i.actorId === 'npc_maya_01' && i.status === 'accepted')!
    await api(page, 'openPhoneApp', 'messages')
    await page.getByTestId(`plan-start-${plan.id}`).click()
    await page.keyboard.press('Tab') // close the phone for a clean driving shot
    await settleVehicle(page, 'vehicle_utility_van_01')
    // Pin the driven van to a fixed spot + heading so the shot is deterministic. The social
    // drive ends the van at a physics-dependent pose that varies just enough to exceed the
    // tolerance under heavy machine load; the §14 asset-vehicle shots pin position for the same
    // reason. Camera follows the driven car, so the van stays centred regardless of the spot.
    await api(page, 'setDrivenCarPosition', [0, -10], 0.3)
    await freeze(page)
    await expect(page).toHaveScreenshot('driving-with-passenger.png', { maxDiffPixelRatio: 0.02 })
  })

  test('the dealership bays area', async ({ page }) => {
    await ready(page)
    await api(page, 'teleportPlayer', [18, 1.2, 12])
    await settleVehicle(page)
    await freeze(page)
    await expect(page).toHaveScreenshot('dealership-bays.png', { maxDiffPixelRatio: 0.02 })
  })
})
