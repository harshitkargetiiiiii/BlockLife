import { expect, test, type Page } from '@playwright/test'

/**
 * District Authoring Kit v1 visual snapshots: the Main Street East proof
 * sector (compiled entirely from templates) and the phone map that includes
 * it. Deterministic via pause-snap.
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

test.describe('authoring kit visuals', () => {
  test('main street east proof sector overview', async ({ page }) => {
    await boot(page)
    await page.evaluate(() => {
      const api = window.GAME_TEST_API!
      api.resetGame()
      api.setTime(10)
      api.teleportTo('main_street_east')
    })
    await page.waitForFunction(
      () => {
        const s = window.GAME_TEST_API!.getSectorState('s1_-1')
        return s?.lifecycle === 'active' && s.visualsReady && s.collidersReady
      },
      undefined,
      { timeout: 15_000 },
    )
    await settleAndPause(page)
    await expect(page).toHaveScreenshot('authoring-main-street-overview.png')
  })

  test('phone map shows the main street east proof sector', async ({ page }) => {
    await boot(page)
    await page.evaluate(() => {
      const api = window.GAME_TEST_API!
      api.resetGame()
      api.setTime(10)
      api.teleportTo('main_street_east')
    })
    await page.waitForFunction(
      () => window.GAME_TEST_API!.getSectorState('s1_-1')?.lifecycle === 'active',
      undefined,
      { timeout: 15_000 },
    )
    await page.evaluate(() => window.GAME_TEST_API!.pauseWorld(true))
    await page.waitForTimeout(600)
    await page.keyboard.press('Tab')
    await page.getByText('Map', { exact: true }).click()
    await expect(page.getByTestId('phone-map')).toBeVisible()
    await expect(page).toHaveScreenshot('authoring-phone-map-main-street.png')
  })
})
