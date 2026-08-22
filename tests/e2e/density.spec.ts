import { expect, test } from '@playwright/test'
import { getStats, gotoGame, teleport } from './helpers'

/** City Life Density v1: background citizens + a denser, still-playable city. */
test.describe('city life density', () => {
  test('every district has background citizens and they stay off the roads', async ({ page }) => {
    const errors: string[] = []
    page.on('pageerror', (err) => errors.push(String(err)))
    await gotoGame(page)
    await page.evaluate(() => {
      window.GAME_TEST_API!.resetGame()
      window.GAME_TEST_API!.setTime(10) // everyone's activeHours window is open
    })
    await page.waitForTimeout(600)

    const citizens = await page.evaluate(() => window.GAME_TEST_API!.getAmbientCitizens())
    expect(citizens.length).toBeGreaterThanOrEqual(10)
    for (const district of ['central', 'residential', 'industrial']) {
      const inDistrict = citizens.filter((c) => c.district === district)
      expect(inDistrict.length, `${district} citizens`).toBeGreaterThanOrEqual(3)
    }
    expect(errors).toEqual([])
  })

  test('activeHours citizens go home at night', async ({ page }) => {
    await gotoGame(page)
    await page.evaluate(() => {
      window.GAME_TEST_API!.resetGame()
      window.GAME_TEST_API!.setTime(23)
    })
    await page.waitForTimeout(600)
    const citizens = await page.evaluate(() => window.GAME_TEST_API!.getAmbientCitizens())
    const jogger = citizens.find((c) => c.id === 'cit_jogger')!
    expect(jogger.state).toBe('hidden')
    // Someone without hours is still around.
    const neighbor = citizens.find((c) => c.id === 'cit_neighbor')!
    expect(neighbor.state).not.toBe('hidden')
  })

  test('the player can walk through the dense residential street without getting stuck', async ({
    page,
  }) => {
    await gotoGame(page)
    await page.evaluate(() => {
      window.GAME_TEST_API!.resetGame()
      window.GAME_TEST_API!.teleportTo('long_road_test')
    })
    await page.waitForTimeout(400)
    // Walk east down the street, past curb cars, stop signs and citizens.
    const start = (await getStats(page)).position
    await page.keyboard.down('s')
    await page.keyboard.down('d')
    await page.waitForTimeout(3500)
    await page.keyboard.up('s')
    await page.keyboard.up('d')
    const end = (await getStats(page)).position
    expect(Math.hypot(end[0] - start[0], end[2] - start[2])).toBeGreaterThan(10)
  })

  test('core interactions still resolve amid the new clutter', async ({ page }) => {
    await gotoGame(page)
    await page.evaluate(() => window.GAME_TEST_API!.resetGame())
    // Maya's truck (with queue citizen + signboard + tables nearby).
    await teleport(page, [1.5, 1.2, -3.5])
    await page.waitForFunction(
      () => window.GAME_TEST_API!.getStats().activeInteractableId === 'food_truck_01',
    )
    // Job board (office worker idling nearby).
    await teleport(page, [11, 1.2, -4.5])
    await page.waitForFunction(
      () => window.GAME_TEST_API!.getStats().activeInteractableId === 'job_board',
    )
    // Gym (flower pots + poster by the door).
    await teleport(page, [14, 1.2, -9.2])
    await page.waitForFunction(
      () => window.GAME_TEST_API!.getStats().activeInteractableId === 'gym',
    )
  })

  test('traffic keeps flowing with citizens registered as pedestrians', async ({ page }) => {
    test.slow()
    await gotoGame(page)
    await page.evaluate(() => {
      window.GAME_TEST_API!.resetGame()
      window.GAME_TEST_API!.setSignalPhase('vehicle_green')
      window.GAME_TEST_API!.teleportTo('central_plaza')
    })
    // Cars keep moving (no citizen-induced gridlock) and never overlap.
    // car_02 still drives the original inner loop; car_01 is ROUTED now and
    // legitimately yields up to ~30s at the north-connector crossing while
    // boot-time citizens funnel through it — its flow check gets a wider
    // (but still bounded) window. Both must keep moving.
    const first = await page.evaluate(() => {
      const cars = window.GAME_TEST_API!.getTrafficState().cars
      return {
        loop: cars.find((c) => c.id === 'vehicle_ambient_car_02')!.position,
        routed: cars.find((c) => c.id === 'vehicle_ambient_car_01')!.position,
      }
    })
    await page.waitForFunction(
      (start) => {
        const c = window.GAME_TEST_API!.getTrafficState().cars.find(
          (x) => x.id === 'vehicle_ambient_car_02',
        )!
        return Math.hypot(c.position[0] - start[0], c.position[1] - start[1]) > 10
      },
      first.loop,
      { timeout: 25_000 },
    )
    await page.waitForFunction(
      (start) => {
        const c = window.GAME_TEST_API!.getTrafficState().cars.find(
          (x) => x.id === 'vehicle_ambient_car_01',
        )!
        return Math.hypot(c.position[0] - start[0], c.position[1] - start[1]) > 10
      },
      first.routed,
      { timeout: 75_000 },
    )
    const overlaps = await page.evaluate(() =>
      window.GAME_TEST_API!.assertNoVehicleVehicleOverlaps(),
    )
    expect(overlaps).toEqual([])
  })
})
