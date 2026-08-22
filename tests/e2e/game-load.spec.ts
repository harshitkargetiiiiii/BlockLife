import { expect, test } from '@playwright/test'
import { gotoGame, getStats } from './helpers'

test.describe('game load', { tag: '@simulation-only' }, () => {
  test('loads without console errors and shows the HUD', async ({ page }) => {
    const errors: string[] = []
    page.on('console', (msg) => {
      if (msg.type() === 'error') errors.push(msg.text())
    })
    page.on('pageerror', (err) => errors.push(String(err)))

    await gotoGame(page)

    await expect(page.getByTestId('hud')).toBeVisible()
    await expect(page.getByTestId('hud-stats')).toBeVisible()
    await expect(page.getByTestId('hud-clock')).toBeVisible()
    await expect(page.getByTestId('hud-mood')).toBeVisible()
    await expect(page.getByTestId('quest-log')).toBeVisible()
    await expect(page.locator('canvas')).toBeVisible()

    expect(errors, `console errors: ${errors.join('\n')}`).toEqual([])
  })

  test('starts with the documented initial stats', async ({ page }) => {
    await gotoGame(page)
    await page.evaluate(() => window.GAME_TEST_API!.resetGame())
    const stats = await getStats(page)
    expect(stats.money).toBe(50)
    expect(stats.energy).toBe(100)
    expect(stats.strength).toBe(1)
    expect(stats.day).toBe(1)
    expect(stats.mode).toBe('walking')
    expect(stats.questStates['coffee_for_ravi']).toBe('not_started')
  })

  test('day/night can be changed through the test API and the mood updates', async ({ page }) => {
    await gotoGame(page)
    await page.evaluate(() => window.GAME_TEST_API!.setTime(9))
    expect((await getStats(page)).mood).toBe('morning')
    await expect(page.getByTestId('hud-mood')).toContainText('morning')

    await page.evaluate(() => window.GAME_TEST_API!.setTime(23))
    expect((await getStats(page)).mood).toBe('night')
    await expect(page.getByTestId('hud-mood')).toContainText('night')

    await page.evaluate(() => window.GAME_TEST_API!.setTime(18.5))
    await expect(page.getByTestId('hud-mood')).toContainText('evening')
  })
})
