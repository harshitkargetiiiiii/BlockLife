import { expect, test } from '@playwright/test'
import { boot, settleAndPause, waitForVehicleGrounded } from './visualHelpers'

/**
 * Building Occlusion v1 visual snapshots. The world is paused after setup;
 * the pause snap completes fades instantly, so frames are deterministic.
 */

test.describe('occlusion visuals', () => {
  test('player behind the GLB office tower — building ghosts, player readable', async ({
    page,
  }) => {
    await boot(page)
    await page.evaluate(() => {
      const api = window.GAME_TEST_API!
      api.resetGame()
      api.setTime(10)
      api.teleportPlayer([11.5, 1.2, -6.5])
    })
    await settleAndPause(page)
    await expect(page).toHaveScreenshot('occlusion-glb-office.png')
  })

  test('player behind a procedural freight warehouse', async ({ page }) => {
    await boot(page)
    await page.evaluate(() => {
      const api = window.GAME_TEST_API!
      api.resetGame()
      api.setTime(15)
      api.teleportPlayer([52, 1.2, -33])
    })
    await settleAndPause(page)
    await expect(page).toHaveScreenshot('occlusion-procedural-warehouse.png')
  })

  test('driven car behind the gym', async ({ page }) => {
    await boot(page)
    await page.evaluate(() => {
      const api = window.GAME_TEST_API!
      api.resetGame()
      api.setTime(10)
      api.vehicleGrant('veh_compact', { location: 'active' }) // §19: own an active shell (no free car)
      api.teleportTo('parking_lot_test')
    })
    await page.waitForFunction(
      () => window.GAME_TEST_API!.getStats().activeInteractableId === 'vehicle_compact_car_01',
    )
    // Wait for the shell to LAND before driving it: `resetGame()` re-seats it at CAR_SPAWN's
    // y = 0.8 and `VehicleController` preserves vertical velocity, so entering mid-fall makes
    // the car — and the follow camera — drift for the whole shot (CONVENTIONS #40).
    await waitForVehicleGrounded(page)
    await page.keyboard.press('e')
    await page.waitForFunction(() => window.GAME_TEST_API!.getStats().mode === 'driving')
    await page.evaluate(() => window.GAME_TEST_API!.setDrivenCarPosition([9, -17.5], 0))
    await settleAndPause(page)
    await expect(page).toHaveScreenshot('occlusion-car-behind-gym.png')
  })

  test('night + rain fade — window overlays ghost with the facade', async ({ page }) => {
    await boot(page)
    await page.evaluate(() => {
      const api = window.GAME_TEST_API!
      api.resetGame()
      api.setTime(21)
      api.setWeather('rain')
      api.teleportPlayer([11.5, 1.2, -6.5])
    })
    await settleAndPause(page)
    await expect(page).toHaveScreenshot('occlusion-night-rain.png')
  })

  test('same scene with occlusion disabled — the solid control image', async ({ page }) => {
    await boot(page)
    await page.evaluate(() => {
      const api = window.GAME_TEST_API!
      api.resetGame()
      api.setTime(10)
      api.setOcclusionEnabled(false)
      api.teleportPlayer([11.5, 1.2, -6.5])
    })
    await settleAndPause(page)
    await expect(page).toHaveScreenshot('occlusion-disabled-control.png')
    await page.evaluate(() => window.GAME_TEST_API!.setOcclusionEnabled(true))
  })
})
