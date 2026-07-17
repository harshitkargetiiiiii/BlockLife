import { expect, test, type Page } from '@playwright/test'

/**
 * Large City Foundation v1 visual snapshots: the gateway sector, the sector
 * boundary with both sides ready, and the expanded phone map. Deterministic
 * via pause-snap; teleports wait on sector readiness by design.
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

test.describe('sector visuals', () => {
  test('downtown gateway overview', async ({ page }) => {
    await boot(page)
    await page.evaluate(() => {
      const api = window.GAME_TEST_API!
      api.resetGame()
      api.setTime(10)
      api.teleportTo('gateway_plaza')
    })
    await page.waitForFunction(
      () => window.GAME_TEST_API!.getSectorState('s0_-1')?.lifecycle === 'active',
      undefined,
      { timeout: 15_000 },
    )
    await settleAndPause(page)
    await expect(page).toHaveScreenshot('sector-gateway-overview.png')
  })

  test('sector boundary corridor with both sectors ready', async ({ page }) => {
    await boot(page)
    await page.evaluate(() => {
      const api = window.GAME_TEST_API!
      api.resetGame()
      api.setTime(10)
      api.teleportPlayer([48, 1.2, -70])
    })
    await settleAndPause(page)
    await expect(page).toHaveScreenshot('sector-boundary-corridor.png')
  })

  test('phone map shows the gateway district', async ({ page }) => {
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
    await expect(page).toHaveScreenshot('sector-phone-map-gateway.png')
  })
})
