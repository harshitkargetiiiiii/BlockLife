import { expect, test, type Page } from '@playwright/test'

/**
 * Apartment / Home Base v1 visual snapshots. The world is paused (weather
 * snap + actor pause-snap) and the player teleported to a fixed interior
 * spot, so frames are deterministic.
 */

async function setupApartmentScene(page: Page, hour: number, weather: string) {
  await page.goto('/')
  await page.waitForFunction(() => window.GAME_TEST_API?.ready() === true, undefined, {
    timeout: 45_000,
  })
  await page.waitForFunction(() => window.GAME_TEST_API?.assetsSettled() === true, undefined, {
    timeout: 45_000,
  })
  await page.evaluate(
    ([h, kind]) => {
      const api = window.GAME_TEST_API!
      api.resetGame()
      api.setTime(h as number)
      api.setWeather(kind as string)
      api.enterApartment()
      api.pauseWorld(true)
      api.teleportPlayer([200, 1.2, 200.5])
    },
    [hour, weather] as const,
  )
  await page.waitForTimeout(2800)
}

test.describe('apartment visuals', () => {
  test('apartment interior overview — clear afternoon', async ({ page }) => {
    await setupApartmentScene(page, 14, 'clear')
    await expect(page).toHaveScreenshot('apartment-overview-day.png')
  })

  test('apartment on a rainy night — the cozy home scene', async ({ page }) => {
    await setupApartmentScene(page, 21, 'rain')
    await expect(page).toHaveScreenshot('apartment-rainy-night.png')
  })

  test('wardrobe customization panel', async ({ page }) => {
    await setupApartmentScene(page, 14, 'clear')
    await page.evaluate(() => window.GAME_TEST_API!.teleportPlayer([201.1, 1.2, 198.6]))
    await page.waitForFunction(
      () => window.GAME_TEST_API!.getStats().activeInteractableId === 'apartment_wardrobe',
    )
    await page.keyboard.press('e')
    await expect(page.getByTestId('wardrobe-panel')).toBeVisible()
    await page.waitForTimeout(600)
    await expect(page).toHaveScreenshot('apartment-wardrobe-panel.png')
  })

  test('phone home while at home', async ({ page }) => {
    await setupApartmentScene(page, 20, 'rain')
    await page.keyboard.press('Tab')
    await expect(page.getByTestId('phone-app-home')).toBeVisible()
    await page.waitForTimeout(600)
    await expect(page).toHaveScreenshot('apartment-phone-home.png')
  })
})
