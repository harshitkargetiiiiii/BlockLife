import { expect, test, type Page } from '@playwright/test'

/**
 * City Expansion Content Pack v1 visual snapshots: one overview per new
 * sector, the expanded phone map, a rainy waterfront night, and routed
 * traffic on the yard road. Deterministic via pause-snap.
 */

async function boot(page: Page) {
  await page.goto('/')
  await page.waitForFunction(() => window.GAME_TEST_API?.ready() === true, undefined, {
    timeout: 45_000,
  })
  await page.waitForFunction(() => window.GAME_TEST_API?.assetsSettled() === true, undefined, {
    timeout: 45_000,
  })
}

async function settleAndPause(page: Page) {
  await page.waitForTimeout(2600)
  await page.evaluate(() => window.GAME_TEST_API!.pauseWorld(true))
  await page.waitForTimeout(700)
}

async function teleportReady(page: Page, location: string, sectorId: string) {
  await page.evaluate(
    ([loc, time]) => {
      const api = window.GAME_TEST_API!
      api.resetGame()
      api.setTime(Number(time))
      api.teleportTo(loc as string)
    },
    [location, '10'],
  )
  await page.waitForFunction(
    (id) => {
      const s = window.GAME_TEST_API!.getSectorState(id as string)
      return s?.lifecycle === 'active' && s.visualsReady && s.collidersReady
    },
    sectorId,
    { timeout: 20_000 },
  )
}

/**
 * Some vantage points STAND in one sector while photographing content the
 * NEIGHBOR owns: Harbor Cross is owned by s0_-2 but its box (48,-160) sits
 * in the gateway's grid cell. Wait for the cell the player LANDS in to go
 * 'active' (far teleports commit deferred — 'active' proves the commit
 * finished, a neighbor's warm state is stale before it), then for the
 * owning neighbor's visuals/colliders via the warm ring.
 */
async function teleportNeighborReady(
  page: Page,
  location: string,
  landingSectorId: string,
  neighborSectorId: string,
) {
  await page.evaluate(
    ([loc, time]) => {
      const api = window.GAME_TEST_API!
      api.resetGame()
      api.setTime(Number(time))
      api.teleportTo(loc as string)
    },
    [location, '10'],
  )
  await page.waitForFunction(
    (id) => {
      const s = window.GAME_TEST_API!.getSectorState(id as string)
      return s?.lifecycle === 'active' && s.visualsReady && s.collidersReady
    },
    landingSectorId,
    { timeout: 20_000 },
  )
  await page.waitForFunction(
    (id) => {
      const s = window.GAME_TEST_API!.getSectorState(id as string)
      return s !== null && s !== undefined && s.visualsReady && s.collidersReady
    },
    neighborSectorId,
    { timeout: 20_000 },
  )
}

test.describe('expansion pack visuals', () => {
  test('waterfront gateway overview', async ({ page }) => {
    await boot(page)
    await teleportReady(page, 'waterfront', 's0_-2')
    await settleAndPause(page)
    await expect(page).toHaveScreenshot('expansion-waterfront-overview.png')
  })

  test('main street north overview', async ({ page }) => {
    await boot(page)
    await teleportReady(page, 'main_street_north', 's1_-2')
    await settleAndPause(page)
    await expect(page).toHaveScreenshot('expansion-main-street-north-overview.png')
  })

  test('residential east overview', async ({ page }) => {
    await boot(page)
    await teleportReady(page, 'residential_east', 's2_-1')
    await settleAndPause(page)
    await expect(page).toHaveScreenshot('expansion-residential-east-overview.png')
  })

  test('industrial yard overview', async ({ page }) => {
    await boot(page)
    await teleportReady(page, 'industrial_yard', 's-1_-2')
    await settleAndPause(page)
    await expect(page).toHaveScreenshot('expansion-industrial-yard-overview.png')
  })

  test('phone map shows the whole expanded city', async ({ page }) => {
    await boot(page)
    await page.evaluate(() => {
      const api = window.GAME_TEST_API!
      api.resetGame()
      api.setTime(10)
      api.teleportTo('central_plaza')
      api.pauseWorld(true)
    })
    await page.waitForTimeout(600)
    await page.keyboard.press('Tab')
    await page.getByText('Map', { exact: true }).click()
    await expect(page.getByTestId('phone-map')).toBeVisible()
    await expect(page).toHaveScreenshot('expansion-phone-map-city.png')
  })

  test('rainy night on the waterfront promenade', async ({ page }) => {
    await boot(page)
    await teleportReady(page, 'waterfront', 's0_-2')
    await page.evaluate(() => {
      window.GAME_TEST_API!.setTime(22)
      window.GAME_TEST_API!.setWeather('rain', { instant: true, intensity: 0.8 })
      window.GAME_TEST_API!.setWetness(0.7)
    })
    await settleAndPause(page)
    await expect(page).toHaveScreenshot('expansion-waterfront-rain-night.png')
  })

  test('main street north at night: lamp rhythm + storefront life', async ({ page }) => {
    await boot(page)
    await teleportReady(page, 'main_street_north', 's1_-2')
    await page.evaluate(() => window.GAME_TEST_API!.setTime(21.5))
    await settleAndPause(page)
    await expect(page).toHaveScreenshot('expansion-main-street-north-night.png')
  })

  test('harbor cross intersection: south green, poles lit', async ({ page }) => {
    await boot(page)
    await teleportNeighborReady(page, 'harbor_cross', 's0_-1', 's0_-2')
    await page.evaluate(() => window.GAME_TEST_API!.setIntersectionElapsed(4)) // green_south
    await settleAndPause(page)
    await expect(page).toHaveScreenshot('expansion-harbor-cross-day.png')
  })

  test('harbor cross at night: signal heads read clearly', async ({ page }) => {
    await boot(page)
    await teleportNeighborReady(page, 'harbor_cross', 's0_-1', 's0_-2')
    await page.evaluate(() => {
      window.GAME_TEST_API!.setTime(21.5)
      window.GAME_TEST_API!.setIntersectionElapsed(21) // green_east
    })
    await settleAndPause(page)
    await expect(page).toHaveScreenshot('expansion-harbor-cross-night.png')
  })

  test('harbor cross curbs: pedestrians waiting through a vehicle phase', async ({ page }) => {
    await boot(page)
    await teleportNeighborReady(page, 'harbor_cross', 's0_-1', 's0_-2')
    // dont_walk stretch; the pause-snap parks every citizen on its curb
    // corner, so the waiting crowd is pixel-deterministic.
    await page.evaluate(() => window.GAME_TEST_API!.setIntersectionElapsed(20))
    await settleAndPause(page)
    await expect(page).toHaveScreenshot('crossing-peds-waiting.png')
  })

  test('harbor cross all-walk: citizens mid-crossing while every approach holds', async ({
    page,
  }) => {
    await boot(page)
    await teleportNeighborReady(page, 'harbor_cross', 's0_-1', 's0_-2')
    await page.evaluate(() => {
      const api = window.GAME_TEST_API!
      api.setIntersectionElapsed(37) // walk_all
      api.forceCitizenToCrossing('cit_hc_south_shuttle', 's0_-2_harbor_cross_cross_south', 0.45)
      api.forceCitizenToCrossing('cit_hc_east_shuttle', 's0_-2_harbor_cross_cross_east', 0.6)
    })
    await settleAndPause(page)
    await expect(page).toHaveScreenshot('crossing-all-walk.png')
  })

  test('harbor cross rainy night: crossing crowd reads under the signals', async ({ page }) => {
    await boot(page)
    await teleportNeighborReady(page, 'harbor_cross', 's0_-1', 's0_-2')
    await page.evaluate(() => {
      const api = window.GAME_TEST_API!
      api.setTime(21.5)
      api.setWeather('rain', { instant: true, intensity: 0.8 })
      api.setWetness(0.7)
      api.setIntersectionElapsed(37)
      api.forceCitizenToCrossing('cit_hc_south_shuttle', 's0_-2_harbor_cross_cross_south', 0.45)
      api.forceCitizenToCrossing('cit_hc_west_shuttle', 's0_-2_harbor_cross_cross_west', 0.5)
    })
    await settleAndPause(page)
    await expect(page).toHaveScreenshot('crossing-rain-night.png')
  })

  test('destination trips: queued shoppers at Harbor Cross curbs', async ({ page }) => {
    await boot(page)
    await teleportNeighborReady(page, 'harbor_cross', 's0_-1', 's0_-2')
    await page.evaluate(() => {
      const api = window.GAME_TEST_API!
      api.setIntersectionElapsed(20) // long dont_walk: curbs hold
      api.forceCitizenToCrossing('cit_dd_shopper_west', 's0_-2_harbor_cross_cross_south', 0)
      api.forceCitizenToCrossing('cit_dd_yard_worker', 's0_-2_harbor_cross_cross_east', 1)
      api.forceCitizenToCrossing('cit_dd_bench_reader', 's0_-2_harbor_cross_cross_west', 0)
    })
    await settleAndPause(page)
    await expect(page).toHaveScreenshot('destinations-harbor-queues.png')
  })

  test('destination trips: arrivals at the waterfront viewpoint and cafe', async ({ page }) => {
    await boot(page)
    await teleportReady(page, 'waterfront', 's0_-2')
    await page.evaluate(() => {
      const api = window.GAME_TEST_API!
      api.forceCitizenPose('cit_dd_waterfront_gazer', 10, -311.5, Math.PI)
      api.forceCitizenPose('cit_dd_cafe_regular', -16, -293.5, 0)
      api.forceCitizenPose('cit_dd_mart_regular', 28, -293.5, 0)
    })
    await settleAndPause(page)
    await expect(page).toHaveScreenshot('destinations-waterfront-arrivals.png')
  })

  test('destination trips: rainy-night foot traffic at the drive crossing', async ({ page }) => {
    await boot(page)
    await teleportReady(page, 'waterfront', 's0_-2')
    await page.evaluate(() => {
      const api = window.GAME_TEST_API!
      api.setTime(21.5)
      api.setWeather('rain', { instant: true, intensity: 0.8 })
      api.setWetness(0.7)
      api.forceCitizenPose('cit_dd_shopper_west', 48, -291.8, Math.PI / 2)
      api.forceCitizenPose('cit_dd_waterfront_gazer', 41, -291.8, Math.PI / 2)
    })
    await settleAndPause(page)
    await expect(page).toHaveScreenshot('destinations-rain-night-crossing.png')
  })

  test('crosswalk art: plaza painted crossing', async ({ page }) => {
    await boot(page)
    await page.evaluate(() => {
      const api = window.GAME_TEST_API!
      api.resetGame()
      api.setTime(10)
      api.teleportPlayer([60, 1.2, -98])
    })
    await page.waitForFunction(
      () => window.GAME_TEST_API!.getSectorState('s1_-1')?.visualsReady === true,
      undefined,
      { timeout: 20_000 },
    )
    await settleAndPause(page)
    await expect(page).toHaveScreenshot('crosswalk-plaza-painted.png')
  })

  test('crosswalk art: industrial-yard painted crossing', async ({ page }) => {
    await boot(page)
    await page.evaluate(() => {
      const api = window.GAME_TEST_API!
      api.resetGame()
      api.setTime(10)
      api.teleportPlayer([42, 1.2, -228])
    })
    await page.waitForFunction(
      () => window.GAME_TEST_API!.getSectorState('s-1_-2')?.visualsReady === true,
      undefined,
      { timeout: 20_000 },
    )
    await settleAndPause(page)
    await expect(page).toHaveScreenshot('crosswalk-yard-painted.png')
  })

  test('crosswalk art: curb cuts and tactile paving up close', async ({ page }) => {
    await boot(page)
    await teleportNeighborReady(page, 'harbor_cross', 's0_-1', 's0_-2')
    await page.evaluate(() => {
      const api = window.GAME_TEST_API!
      api.setIntersectionElapsed(4)
      // Stand ON the SE corner so the camera frames the curb detail.
      api.teleportPlayer([55.5, 1.2, -152.9])
    })
    await settleAndPause(page)
    await expect(page).toHaveScreenshot('crosswalk-curb-detail.png')
  })

  test('routed car on the industrial yard road', async ({ page }) => {
    await boot(page)
    await teleportReady(page, 'industrial_yard', 's-1_-2')
    await page.evaluate(() => {
      const api = window.GAME_TEST_API!
      api.setTrafficRoutingSeed(1)
      api.teleportAmbientVehicleToSegment('vehicle_ambient_car_01', 's-1_-2_yard_rd_fwd', 0.62)
      api.forceVehicleDestination('vehicle_ambient_car_01', 'dest_s-1_-2_loading')
    })
    await settleAndPause(page)
    await expect(page).toHaveScreenshot('expansion-yard-routed-traffic.png')
  })
})
