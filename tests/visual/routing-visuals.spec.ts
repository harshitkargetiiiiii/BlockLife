import { expect, test, type Page } from '@playwright/test'

/**
 * Cross-District Routing v1 visual snapshots. Pausing snaps every routed
 * car to its seeded spawn anchor with its deterministic initial route (and
 * loop cars to their loop starts), so frames are pixel-stable. Behavioral
 * scenarios (connector traversal, signal waits, queues) are covered by the
 * E2E suite — these baselines pin the rendered road network + fleet.
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

test.describe('routing visuals', () => {
  test('central ring north junction with routed + loop traffic at anchors', async ({ page }) => {
    await boot(page)
    await page.evaluate(() => {
      const api = window.GAME_TEST_API!
      api.resetGame()
      api.setTime(10)
      api.teleportPlayer([2, 0.8, -21])
    })
    await settleAndPause(page)
    await expect(page).toHaveScreenshot('routing-ring-north-junction.png')
  })

  test('freight arterial with the through-traffic truck at its anchor', async ({ page }) => {
    await boot(page)
    await page.evaluate(() => {
      const api = window.GAME_TEST_API!
      api.resetGame()
      api.setTime(10)
      api.teleportTo('industrial_north_strip')
    })
    await settleAndPause(page)
    await expect(page).toHaveScreenshot('routing-freight-arterial.png')
  })

  test('market strip with the routed van at its anchor near the signal', async ({ page }) => {
    await boot(page)
    await page.evaluate(() => {
      const api = window.GAME_TEST_API!
      api.resetGame()
      api.setTime(10)
      api.teleportTo('industrial_strip')
    })
    await settleAndPause(page)
    await expect(page).toHaveScreenshot('routing-market-strip.png')
  })
})
