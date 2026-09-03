import { expect, test } from '@playwright/test'
import { boot, settleAndPause } from './visualHelpers'

/**
 * Large City Foundation v1 visual snapshots: the gateway sector, the sector
 * boundary with both sides ready, and the expanded phone map. Deterministic
 * via pause-snap; teleports wait on sector readiness by design.
 */

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
