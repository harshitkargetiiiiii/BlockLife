import { expect, test } from '@playwright/test'
import { acquireDrivableCar, getStats, gotoGame, teleport } from './helpers'

/**
 * City Expansion v1: three districts connected by real roads. Movement is
 * screen-relative — W+D walks due north, S+D due east.
 */
test.describe('districts', () => {
  test('player can walk from Central up the connector into Residential Street', async ({
    page,
  }) => {
    const errors: string[] = []
    page.on('pageerror', (err) => errors.push(String(err)))
    await gotoGame(page)
    await page.evaluate(() => window.GAME_TEST_API!.resetGame())
    await teleport(page, [12, 1.2, -26]) // on the connector mouth
    expect(await page.evaluate(() => window.GAME_TEST_API!.getPlayerDistrict())).toBe('central')

    await page.keyboard.down('w')
    await page.keyboard.down('d')
    await page.waitForFunction(
      () => window.GAME_TEST_API!.getPlayerDistrict() === 'residential',
      undefined,
      { timeout: 15_000 },
    )
    await page.keyboard.up('w')
    await page.keyboard.up('d')

    const pos = (await getStats(page)).position
    expect(pos[2]).toBeLessThan(-36)
    expect(errors).toEqual([])
  })

  test('player can drive from Central through the east connector into the Market Strip', async ({
    page,
  }) => {
    await gotoGame(page)
    await page.evaluate(() => window.GAME_TEST_API!.resetGame())
    await acquireDrivableCar(page) // §19: own an active Compact shell (no free car on a new game)
    // Get in the car and stage it at the east connector mouth, facing east.
    await teleport(page, [13, 1.2, 14])
    await page.waitForFunction(
      () => window.GAME_TEST_API!.getStats().activeInteractableId === 'vehicle_compact_car_01',
    )
    await page.keyboard.press('e')
    await page.waitForTimeout(200)
    await page.evaluate(() =>
      window.GAME_TEST_API!.setDrivenCarPosition([31, 6], Math.PI / 2),
    )
    await page.waitForTimeout(300)

    await page.keyboard.down('w')
    await page.waitForFunction(
      () => {
        const p = window.GAME_TEST_API!.getStats().position
        return p[0] > 40
      },
      undefined,
      { timeout: 15_000 },
    )
    await page.keyboard.up('w')
    expect(await page.evaluate(() => window.GAME_TEST_API!.getPlayerDistrict())).toBe(
      'industrial',
    )
  })

  test('phone map tracks the player into a new district and shows district labels', async ({
    page,
  }) => {
    await gotoGame(page)
    await page.evaluate(() => {
      window.GAME_TEST_API!.resetGame()
      window.GAME_TEST_API!.teleportTo('residential_street')
    })
    await page.waitForTimeout(500)
    await page.keyboard.press('Tab')
    await page.getByTestId('phone-nav-map').click()
    await expect(page.getByTestId('phone-app-map')).toBeVisible()
    for (const id of ['central', 'residential', 'industrial']) {
      await expect(page.getByTestId(`map-district-${id}`)).toBeVisible()
    }
    await expect(page.getByTestId('map-marker-future_townhomes')).toBeVisible()
    // The expanded city pushed the ORIGINAL blocks into the map's lower
    // band — the residential street reads at ~70-80% from the top now.
    const top = await page
      .getByTestId('map-marker-player')
      .evaluate((el) => parseFloat((el as HTMLElement).style.top))
    expect(top).toBeGreaterThan(60)
    expect(top).toBeLessThan(85)
    // Existing central markers are still present.
    await expect(page.getByTestId('map-marker-food_truck_01')).toBeVisible()
    await page.keyboard.press('Escape')
  })

  test('an ambient car works the residential loop and holds at the stop sign', async ({
    page,
  }) => {
    test.slow()
    await gotoGame(page)
    await page.evaluate(() => {
      window.GAME_TEST_API!.resetGame()
      window.GAME_TEST_API!.teleportTo('central_plaza')
    })

    // Car 04 loops the residential street: watch it actually travel.
    const first = await page.evaluate(
      () =>
        window.GAME_TEST_API!.getTrafficState().cars.find(
          (c) => c.id === 'vehicle_ambient_car_04',
        )!.position,
    )
    await page.waitForFunction(
      (start) => {
        const c = window.GAME_TEST_API!.getTrafficState().cars.find(
          (x) => x.id === 'vehicle_ambient_car_04',
        )!
        return Math.hypot(c.position[0] - start[0], c.position[1] - start[1]) > 8
      },
      first,
      { timeout: 20_000 },
    )

    // And it observes the stop sign at the residential crosswalk.
    await page.evaluate(() =>
      window.GAME_TEST_API!.setAmbientCarPosition('vehicle_ambient_car_04', [-14, -46.4], 1),
    )
    await page.waitForFunction(
      () => {
        const c = window.GAME_TEST_API!.getTrafficState().cars.find(
          (x) => x.id === 'vehicle_ambient_car_04',
        )!
        return c.reason === 'stop_sign' && c.speed < 0.35
      },
      undefined,
      // Under full-gate CPU load sim time lags wall time, and a courtesy
      // yield for a waiting pedestrian can legitimately precede the
      // stop-sign hold — 15s proved marginal after seven green gates.
      { timeout: 30_000 },
    )
    // After the hold it rolls through and past the crossing.
    await page.waitForFunction(
      () =>
        window.GAME_TEST_API!.getTrafficState().cars.find(
          (c) => c.id === 'vehicle_ambient_car_04',
        )!.position[0] > 2,
      undefined,
      { timeout: 15_000 },
    )
  })

  test('Officer Kim patrols into Residential Street', async ({ page }) => {
    await gotoGame(page)
    await page.evaluate(() => {
      const api = window.GAME_TEST_API!
      api.resetGame()
      api.teleportTo('central_plaza')
      // Start her at the connector sidewalk, heading for the residential leg
      // (routine index 2 = [16, -40.5]).
      api.setNpcPosition('npc_kim_01', [16, -32], 2)
    })
    await page.waitForFunction(
      () => {
        const kim = window.GAME_TEST_API!.getTrafficState().pedestrians.find(
          (p) => p.id === 'npc_kim_01',
        )!
        return kim.position[1] < -38
      },
      undefined,
      { timeout: 15_000 },
    )
    // She keeps walking her residential leg toward the townhomes.
    await page.waitForFunction(
      () => {
        const kim = window.GAME_TEST_API!.getTrafficState().pedestrians.find(
          (p) => p.id === 'npc_kim_01',
        )!
        return kim.position[0] > 18 && kim.position[1] < -38
      },
      undefined,
      { timeout: 15_000 },
    )
  })

  test('named test locations all teleport correctly', async ({ page }) => {
    await gotoGame(page)
    test.setTimeout(240_000)
    const results = await page.evaluate(async () => {
      const api = window.GAME_TEST_API!
      const out: Record<string, string> = {}
      for (const name of api.getTestLocations()) {
        const before = api.getStats().position as [number, number, number]
        api.teleportTo(name)
        // Far-sector teleports commit DEFERRED (the coordinator streams the
        // destination in first). Chained teleports can land late, so wait
        // until the player has MOVED from the pre-call spot AND the position
        // has been STABLE for four consecutive samples — no pending commit.
        let stable = 0
        let last = before
        for (let i = 0; i < 100 && stable < 4; i++) {
          await new Promise((r) => setTimeout(r, 250))
          const p = api.getStats().position as [number, number, number]
          const moved = Math.hypot(p[0] - before[0], p[2] - before[2]) > 2
          const settled = Math.hypot(p[0] - last[0], p[2] - last[2]) < 0.5
          stable = moved && settled ? stable + 1 : 0
          last = p
        }
        out[name] = api.getPlayerDistrict()
      }
      return out
    })
    expect(results['central_plaza']).toBe('central')
    expect(results['residential_street']).toBe('residential')
    expect(results['industrial_strip']).toBe('industrial')
    expect(results['warehouse_or_garage']).toBe('industrial')
    expect(results['apartment_entrance']).toBe('central')
    // City Expansion v2 blocks:
    expect(results['residential_west_street']).toBe('residential_west')
    expect(results['residential_south_street']).toBe('residential_south')
    expect(results['industrial_north_strip']).toBe('industrial_north')
    // The interior sits far outside the districts; the classifier falls
    // through to its default. The debug panel shows "(indoors)" instead.
    expect(results['apartment_interior']).toBeDefined()
    // City Expansion Content Pack v1 districts:
    expect(results['main_street_north']).toBe('downtown_north')
    expect(results['waterfront']).toBe('waterfront_north')
    expect(results['residential_east']).toBe('residential_east')
    expect(results['industrial_yard']).toBe('industrial_west')
    // The intersection sits at z=-160: inside the gateway's COARSE band
    // (waterfront_north starts at z<-216) even though the sector metadata
    // files it under the waterfront's authoring district.
    expect(results['harbor_cross']).toBe('downtown_gateway')
    expect(Object.keys(results)).toHaveLength(21)
  })
})
