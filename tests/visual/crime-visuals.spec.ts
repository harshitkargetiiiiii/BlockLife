import { expect, test, type Page } from '@playwright/test'

/**
 * Crime & Law Enforcement v1 visual snapshots. All scenes are deterministic:
 * the world is paused (weather + actor pause-snap), the player teleported to a
 * fixed clear spot near the spawn, wanted/weapon/health set through the test
 * API, and police units teleported to fixed positions in the SAME synchronous
 * call before the pause — so no director frame moves them. Police meshes map
 * from unit positions even while paused, so the frozen pursuit renders stably.
 */

async function ready(page: Page): Promise<void> {
  await page.goto('/')
  await page.waitForFunction(() => window.GAME_TEST_API?.ready() === true, undefined, {
    timeout: 45_000,
  })
  await page.waitForFunction(() => window.GAME_TEST_API?.assetsSettled() === true, undefined, {
    timeout: 45_000,
  })
}

interface SceneOpts {
  hour: number
  weather: string
  wanted?: number
  /** Police cruiser positions (x,z) placed around the suspect. */
  cruisers?: [number, number][]
  weapon?: boolean
  ammo?: [number, number]
  health?: number
  steal?: boolean
  /** Dismount one officer per in-range cruiser onto the street before pausing. */
  dismount?: boolean
}

async function scene(page: Page, opts: SceneOpts): Promise<void> {
  await ready(page)
  await page.evaluate((o) => {
    const api = window.GAME_TEST_API!
    api.resetGame()
    api.setTime(o.hour)
    api.setWeather(o.weather)
    api.teleportPlayer([-11, 1.2, -7])
    if (o.weapon) api.givePlayerWeapon('handgun')
    if (o.ammo) api.setPlayerAmmo(o.ammo[0], o.ammo[1])
    if (typeof o.health === 'number') api.setPlayerHealth(o.health)
    if (o.steal) api.stealVehicle('theft_parked_plaza')
    if (o.wanted) api.setWantedLevel(o.wanted)
    if (o.cruisers && o.cruisers.length) {
      api.spawnPoliceResponse(o.wanted ?? 3)
      const units = api.getPoliceUnits()
      o.cruisers.forEach((pos, i) => {
        if (units[i]) api.teleportPoliceUnit(units[i].id, pos[0], pos[1])
      })
      // Put officers on the street from the now-adjacent cruisers (suspect x,z
      // matches the fixed teleportPlayer spot above).
      if (o.dismount) api.forcePoliceDismount(-11, -7)
    }
    // Pause LAST, in the same call, so no unpaused director frame moves police.
    api.pauseWorld(true)
  }, opts)
  await page.waitForTimeout(2600)
}

test.describe('crime visuals', () => {
  test('police response — single cruiser (L1, day)', async ({ page }) => {
    await scene(page, { hour: 13, weather: 'clear', wanted: 1, cruisers: [[-5, -5]] })
    await expect(page).toHaveScreenshot('crime-police-l1-day.png')
  })

  test('police response — two cruisers (L2, day)', async ({ page }) => {
    await scene(page, { hour: 13, weather: 'clear', wanted: 2, cruisers: [[-5, -5], [-17, -9]] })
    await expect(page).toHaveScreenshot('crime-police-l2-day.png')
  })

  test('police response — three cruisers surround (L3, day)', async ({ page }) => {
    await scene(page, {
      hour: 13,
      weather: 'clear',
      wanted: 3,
      cruisers: [[-4, -4], [-17, -10], [-7, -14]],
    })
    await expect(page).toHaveScreenshot('crime-police-l3-day.png')
  })

  test('police response — night pursuit (L2)', async ({ page }) => {
    await scene(page, { hour: 22, weather: 'clear', wanted: 2, cruisers: [[-5, -5], [-17, -9]] })
    await expect(page).toHaveScreenshot('crime-police-night.png')
  })

  test('police response — rainy pursuit (L2)', async ({ page }) => {
    await scene(page, { hour: 15, weather: 'rain', wanted: 2, cruisers: [[-5, -5], [-17, -9]] })
    await expect(page).toHaveScreenshot('crime-police-rain.png')
  })

  test('single cruiser close-up', async ({ page }) => {
    await scene(page, { hour: 13, weather: 'clear', wanted: 1, cruisers: [[-8, -6]] })
    await expect(page).toHaveScreenshot('crime-cruiser-closeup.png')
  })

  test('dismounted officers on foot (L2)', async ({ page }) => {
    await scene(page, {
      hour: 13,
      weather: 'clear',
      wanted: 2,
      cruisers: [[-6, -5], [-16, -9]],
      dismount: true,
    })
    await expect(page).toHaveScreenshot('crime-police-dismount.png')
  })

  test('stolen car with a cruiser in pursuit', async ({ page }) => {
    await scene(page, {
      hour: 13,
      weather: 'clear',
      wanted: 2,
      steal: true,
      cruisers: [[-7, -12]],
    })
    await expect(page).toHaveScreenshot('crime-stolen-car.png')
  })

  test('HUD — wanted L1, armed, full health', async ({ page }) => {
    await scene(page, { hour: 13, weather: 'clear', wanted: 1, weapon: true, ammo: [12, 48], health: 100 })
    await expect(page).toHaveScreenshot('crime-hud-l1.png')
  })

  test('HUD — wanted L3, low ammo, low health', async ({ page }) => {
    await scene(page, { hour: 13, weather: 'clear', wanted: 3, weapon: true, ammo: [3, 6], health: 28 })
    await expect(page).toHaveScreenshot('crime-hud-l3-hurt.png')
  })

  test('parked stealable vehicles on the plaza', async ({ page }) => {
    await ready(page)
    await page.evaluate(() => {
      const api = window.GAME_TEST_API!
      api.resetGame()
      api.setTime(13)
      api.setWeather('clear')
      api.teleportPlayer([22, 1.2, 8]) // by the plaza parked car
      api.pauseWorld(true)
    })
    await page.waitForTimeout(2600)
    await expect(page).toHaveScreenshot('crime-parked-vehicles.png')
  })

  test('occupied cars with seated drivers (pre-carjack)', async ({ page }) => {
    await ready(page)
    await page.evaluate(() => {
      const api = window.GAME_TEST_API!
      api.resetGame()
      api.setTime(13)
      api.setWeather('clear')
      api.teleportPlayer([34, 1.2, 8]) // between the two occupied cars
      api.pauseWorld(true)
    })
    await page.waitForTimeout(2600)
    await expect(page).toHaveScreenshot('crime-occupied-cars.png')
  })

  test('carjacked driver fleeing the stolen car', async ({ page }) => {
    await ready(page)
    await page.evaluate(() => {
      const api = window.GAME_TEST_API!
      api.resetGame()
      api.setTime(13)
      api.setWeather('clear')
      api.teleportPlayer([30, 1.2, 10])
      api.forceOccupiedVehicleTheft('theft_occupied_plaza') // eject the driver
      api.pauseWorld(true)
    })
    await page.waitForTimeout(2600)
    await expect(page).toHaveScreenshot('crime-carjack-flee.png')
  })
})
