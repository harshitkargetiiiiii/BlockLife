import { expect, test, type Page } from '@playwright/test'

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
  await page.waitForFunction(() => window.GAME_TEST_API?.assetsSettled() === true, undefined, {
    timeout: 45_000,
  })
  await page.waitForFunction(
    () => window.GAME_TEST_API!.getCharacterState('player')?.modelLoaded === true,
    undefined,
    { timeout: 15_000 },
  )
}

async function settleAndPause(page: Page) {
  await page.waitForTimeout(2600)
  await page.evaluate(() => window.GAME_TEST_API!.pauseWorld(true))
  await page.waitForTimeout(700)
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

  test('driving hides the character model inside the car', async ({ page }) => {
    await boot(page)
    await page.evaluate(() => {
      const api = window.GAME_TEST_API!
      api.resetGame()
      api.setTime(10)
      api.teleportTo('parking_lot_test')
    })
    await page.waitForFunction(
      () => window.GAME_TEST_API!.getStats().activeInteractableId === 'vehicle_compact_car_01',
    )
    await page.keyboard.press('e')
    await page.waitForFunction(() => window.GAME_TEST_API!.getStats().mode === 'driving')
    await settleAndPause(page)
    await expect(page).toHaveScreenshot('character-driving-hidden.png')
  })
})
