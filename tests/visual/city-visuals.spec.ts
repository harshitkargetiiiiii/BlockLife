import { expect, test, type Page } from '@playwright/test'

/**
 * Visual regression snapshots. The world is paused via the test API, which
 * snaps every animated actor (NPCs, ambient cars, smoke, birds, marker
 * pulses) to a canonical pose so frames are deterministic.
 *
 * First run seeds the baselines (Playwright writes them and fails once);
 * subsequent runs compare against them.
 */

async function setupScene(page: Page, hour: number, position: [number, number, number]) {
  await page.goto('/')
  await page.waitForFunction(() => window.GAME_TEST_API?.ready() === true, undefined, {
    timeout: 45_000,
  })
  // GLB landmarks load asynchronously behind Suspense; wait for the last
  // in-flight model/texture before framing the shot.
  await page.waitForFunction(() => window.GAME_TEST_API?.assetsSettled() === true, undefined, {
    timeout: 45_000,
  })
  await page.evaluate(
    ([h, pos]) => {
      const api = window.GAME_TEST_API!
      api.resetGame()
      api.setTime(h as number)
      api.pauseWorld(true)
      api.teleportPlayer(pos as [number, number, number])
    },
    [hour, position] as const,
  )
  // Let the follow camera settle and toasts fade.
  await page.waitForTimeout(2800)
}

test.describe('city visuals', () => {
  test('morning city', async ({ page }) => {
    await setupScene(page, 9, [0, 1.2, 0])
    await expect(page).toHaveScreenshot('city-morning.png')
  })

  test('evening city', async ({ page }) => {
    await setupScene(page, 19, [0, 1.2, 0])
    await expect(page).toHaveScreenshot('city-evening.png')
  })

  test('night city with street and window lights', async ({ page }) => {
    await setupScene(page, 23, [0, 1.2, 0])
    await expect(page).toHaveScreenshot('city-night.png')
  })

  test('food truck interaction', async ({ page }) => {
    await setupScene(page, 12, [1.5, 1.2, -3.5])
    await page.waitForFunction(
      () => window.GAME_TEST_API!.getStats().activeInteractableId === 'food_truck_01',
    )
    await page.keyboard.press('e')
    await expect(page.getByTestId('activity-panel')).toBeVisible()
    await page.waitForTimeout(600)
    await expect(page).toHaveScreenshot('food-truck-panel.png')
  })

  test('dialogue panel', async ({ page }) => {
    await setupScene(page, 9, [-8, 1.2, -4.4])
    await page.waitForFunction(
      () => window.GAME_TEST_API!.getStats().activeInteractableId === 'npc_ravi_01',
    )
    await page.keyboard.press('e')
    await expect(page.getByTestId('dialogue-panel')).toBeVisible()
    await page.waitForTimeout(600)
    await expect(page).toHaveScreenshot('dialogue-ravi.png')
  })

  test('traffic light at the north crosswalk', async ({ page }) => {
    // Paused world pins the signal to the cycle start (vehicle green).
    await setupScene(page, 15, [-3, 1.2, -19])
    await expect(page).toHaveScreenshot('traffic-light.png')
  })

  test('residential street overview', async ({ page }) => {
    await setupScene(page, 10, [-2, 1.2, -44])
    await expect(page).toHaveScreenshot('residential-street.png')
  })

  test('industrial market strip overview', async ({ page }) => {
    await setupScene(page, 16, [44, 1.2, 6])
    await expect(page).toHaveScreenshot('industrial-strip.png')
  })

  test('phone map expanded view', async ({ page }) => {
    await setupScene(page, 12, [0, 1.2, 0])
    await page.keyboard.press('Tab')
    await page.getByTestId('phone-nav-map').click()
    await expect(page.getByTestId('phone-app-map')).toBeVisible()
    await page.waitForTimeout(600)
    await expect(page).toHaveScreenshot('phone-map.png')
  })

  test('phone home screen', async ({ page }) => {
    await setupScene(page, 20, [0, 1.2, 0]) // dusk behind the glass
    await page.keyboard.press('Tab')
    await expect(page.getByTestId('phone-app-home')).toBeVisible()
    await page.waitForTimeout(600)
    await expect(page).toHaveScreenshot('phone-home.png')
  })

  test('driving the car', async ({ page }) => {
    await setupScene(page, 15, [13, 1.2, 14])
    await page.waitForFunction(
      () => window.GAME_TEST_API!.getStats().activeInteractableId === 'vehicle_compact_car_01',
    )
    await page.keyboard.press('e')
    await page.waitForFunction(() => window.GAME_TEST_API!.getStats().mode === 'driving')
    // Camera glides over to the car; wait for it to settle.
    await page.waitForTimeout(2500)
    await expect(page).toHaveScreenshot('driving-car.png')
  })
})
