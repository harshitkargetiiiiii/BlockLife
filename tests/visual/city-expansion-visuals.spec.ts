import { expect, test, type Page } from '@playwright/test'

/**
 * City Expansion v2 visual snapshots: one framed shot per new block. The
 * paused world snaps every actor to a canonical pose, so frames are
 * deterministic.
 */

async function setupScene(page: Page, hour: number, position: [number, number, number]) {
  await page.goto('/')
  await page.waitForFunction(() => window.GAME_TEST_API?.ready() === true, undefined, {
    timeout: 45_000,
  })
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
  await page.waitForTimeout(2800)
}

test.describe('city expansion visuals', () => {
  test('residential west block overview', async ({ page }) => {
    await setupScene(page, 10, [-48, 1.2, -2])
    await expect(page).toHaveScreenshot('block-residential-west.png')
  })

  test('residential south block overview', async ({ page }) => {
    await setupScene(page, 15, [0, 1.2, 48])
    await expect(page).toHaveScreenshot('block-residential-south.png')
  })

  test('industrial north freight strip overview', async ({ page }) => {
    await setupScene(page, 16, [48, 1.2, -34])
    await expect(page).toHaveScreenshot('block-industrial-north.png')
  })

  test('phone map shows the full six-block city', async ({ page }) => {
    await setupScene(page, 12, [0, 1.2, 0])
    await page.keyboard.press('Tab')
    await page.getByTestId('phone-nav-map').click()
    await expect(page.getByTestId('phone-app-map')).toBeVisible()
    await page.waitForTimeout(600)
    await expect(page).toHaveScreenshot('phone-map-six-blocks.png')
  })
})
