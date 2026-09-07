import { expect, test, type Page } from '@playwright/test'
import { settleAndPause, waitForSceneSettled, waitForVehicleGrounded } from './visualHelpers'

/**
 * Character pipeline v1 visual snapshots. Pausing the world triggers the
 * animation controller's freezeAt(0) — every character pins to the idle
 * clip's first frame, so poses are deterministic across runs.
 */

async function boot(page: Page) {
  await page.goto('/')
  await page.waitForFunction(() => window.GAME_TEST_API?.ready() === true, undefined, {
    timeout: 45_000,
  })
  await waitForSceneSettled(page)
  await page.waitForFunction(
    () => window.GAME_TEST_API!.getCharacterState('player')?.modelLoaded === true,
    undefined,
    { timeout: 15_000 },
  )
}

test.describe('character visuals', () => {
  test('rigged player idling on the plaza in the default outfit', async ({ page }) => {
    await boot(page)
    await page.evaluate(() => {
      const api = window.GAME_TEST_API!
      api.resetGame()
      api.setTime(10)
      api.teleportTo('central_plaza')
    })
    await settleAndPause(page)
    await expect(page).toHaveScreenshot('character-player-idle-plaza.png')
  })

  test('wardrobe recolor renders on the model (shirt + pants + hair)', async ({ page }) => {
    await boot(page)
    await page.evaluate(() => {
      const api = window.GAME_TEST_API!
      api.resetGame()
      api.setTime(10)
      api.teleportTo('central_plaza')
      api.setAppearance({ shirtColor: '#e01818', pantsColor: '#f5d90a', accentColor: '#101010' })
    })
    await settleAndPause(page)
    await expect(page).toHaveScreenshot('character-wardrobe-recolor.png')
  })

  test('player beside Officer Kim — two independent model instances', async ({ page }) => {
    await boot(page)
    await page.evaluate(() => {
      const api = window.GAME_TEST_API!
      api.resetGame()
      api.setTime(10)
      // Pausing snaps every NPC to its routine anchor — Kim's is [-30, -30].
      // Standing next to that anchor guarantees both models share the frame.
      api.teleportPlayer([-28.2, 0.8, -28.6])
    })
    await settleAndPause(page)
    await expect(page).toHaveScreenshot('character-player-beside-kim.png')
  })

  test('modeled player readable behind the ghosted office tower', async ({ page }) => {
    await boot(page)
    await page.evaluate(() => {
      const api = window.GAME_TEST_API!
      api.resetGame()
      api.setTime(10)
      api.teleportPlayer([11.5, 1.2, -6.5])
    })
    await settleAndPause(page)
    await expect(page).toHaveScreenshot('character-behind-faded-building.png')
  })

  test('apartment interior with the rigged model', async ({ page }) => {
    await boot(page)
    await page.evaluate(() => {
      const api = window.GAME_TEST_API!
      api.resetGame()
      api.setTime(10)
      api.enterApartment()
    })
    await settleAndPause(page)
    await expect(page).toHaveScreenshot('character-apartment-interior.png')
  })

  test('forced primitive render mode — the fallback still fully works', async ({ page }) => {
    await boot(page)
    await page.evaluate(() => {
      const api = window.GAME_TEST_API!
      api.resetGame()
      api.setTime(10)
      api.teleportTo('central_plaza')
      api.setCharacterRenderMode('primitive')
    })
    await settleAndPause(page)
    await expect(page).toHaveScreenshot('character-primitive-fallback.png')
    await page.evaluate(() => window.GAME_TEST_API!.setCharacterRenderMode('auto'))
  })

  test('rigged ambient crowd around the food truck (issue #23)', async ({ page }) => {
    await boot(page)
    await page.evaluate(() => {
      const api = window.GAME_TEST_API!
      api.resetGame()
      api.setTime(10)
      // Among the food-truck queue: several central core citizens (now rigged) and
      // Maya snap to their canonical anchors here on pause — a deterministic crowd.
      api.teleportPlayer([1.5, 0.8, -4.5])
    })
    await settleAndPause(page)
    await expect(page).toHaveScreenshot('character-ambient-crowd-rigged.png')
  })

  test('driving hides the character model inside the car', async ({ page }) => {
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
    await settleAndPause(page)
    await expect(page).toHaveScreenshot('character-driving-hidden.png')
  })
})
