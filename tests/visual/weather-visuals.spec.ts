import { expect, test, type Page } from '@playwright/test'

/**
 * Weather visual snapshots. Weather is forced instantly through the test API
 * before the world is paused; the pause snap completes any fade, settles
 * wetness and pins the rain particle cloud to its seeded layout, so frames
 * are deterministic.
 */

async function setupWeatherScene(
  page: Page,
  hour: number,
  weather: string,
  position: [number, number, number],
) {
  await page.goto('/')
  await page.waitForFunction(() => window.GAME_TEST_API?.ready() === true, undefined, {
    timeout: 45_000,
  })
  await page.waitForFunction(() => window.GAME_TEST_API?.assetsSettled() === true, undefined, {
    timeout: 45_000,
  })
  await page.evaluate(
    ([h, kind, pos]) => {
      const api = window.GAME_TEST_API!
      api.resetGame()
      api.setTime(h as number)
      api.setWeather(kind as string)
      api.pauseWorld(true)
      api.teleportPlayer(pos as [number, number, number])
    },
    [hour, weather, position] as const,
  )
  await page.waitForTimeout(2800)
}

test.describe('weather visuals', () => {
  test('rainy evening on the central block — the cozy target scene', async ({ page }) => {
    await setupWeatherScene(page, 19, 'rain', [0, 1.2, 0])
    await expect(page).toHaveScreenshot('weather-rain-central-evening.png')
  })

  test('rainy night on the industrial strip', async ({ page }) => {
    await setupWeatherScene(page, 22, 'rain', [44, 1.2, 6])
    await expect(page).toHaveScreenshot('weather-rain-industrial-night.png')
  })

  test('foggy morning on the central block', async ({ page }) => {
    await setupWeatherScene(page, 9, 'foggy', [0, 1.2, 0])
    await expect(page).toHaveScreenshot('weather-fog-central-morning.png')
  })

  test('cloudy midday residential street', async ({ page }) => {
    await setupWeatherScene(page, 12, 'cloudy', [-2, 1.2, -44])
    await expect(page).toHaveScreenshot('weather-cloudy-residential.png')
  })

  test('phone home shows rain badge and flavor', async ({ page }) => {
    await setupWeatherScene(page, 19, 'rain', [0, 1.2, 0])
    await page.keyboard.press('Tab')
    await expect(page.getByTestId('phone-app-home')).toBeVisible()
    await page.waitForTimeout(600)
    await expect(page).toHaveScreenshot('weather-phone-home-rain.png')
  })
})
