import { expect, test } from '@playwright/test'
import { getStats, gotoGame } from './helpers'

test.describe('save / load', { tag: '@simulation-only' }, () => {
  test('persists stats, quest state, inventory and position', async ({ page }) => {
    await gotoGame(page)
    await page.evaluate(async () => {
      const api = window.GAME_TEST_API!
      api.resetGame()
      api.setTime(15)
      api.setQuestState('coffee_for_ravi', 'has_coffee')
      api.giveItem('coffee', 1)
      api.teleportPlayer([5, 1.2, 5])
    })
    await page.waitForTimeout(400)
    const saved = await page.evaluate(() => window.GAME_TEST_API!.saveGame())
    expect(saved).toBe(true)

    // Wipe the live state...
    await page.evaluate(() => window.GAME_TEST_API!.resetGame())
    await page.waitForTimeout(300)
    let stats = await getStats(page)
    expect(stats.questStates['coffee_for_ravi']).toBe('not_started')
    expect(stats.inventory['coffee']).toBeUndefined()

    // ...and load it back.
    const loaded = await page.evaluate(() => window.GAME_TEST_API!.loadGame())
    expect(loaded).toBe(true)
    await page.waitForTimeout(300)
    stats = await getStats(page)
    expect(stats.questStates['coffee_for_ravi']).toBe('has_coffee')
    expect(stats.inventory['coffee']).toBe(1)
    expect(Math.floor(stats.hour)).toBe(15)
    expect(Math.abs(stats.position[0] - 5)).toBeLessThan(1)
    expect(Math.abs(stats.position[2] - 5)).toBeLessThan(1)
  })

  test('the save survives a full page reload', async ({ page }) => {
    await gotoGame(page)
    await page.evaluate(async () => {
      const api = window.GAME_TEST_API!
      api.resetGame()
      api.setQuestState('coffee_for_ravi', 'completed')
      await api.saveGame()
    })

    await page.reload()
    await gotoGame(page)
    const loaded = await page.evaluate(() => window.GAME_TEST_API!.loadGame())
    expect(loaded).toBe(true)
    const stats = await getStats(page)
    expect(stats.questStates['coffee_for_ravi']).toBe('completed')
  })

  test('the HUD save buttons work', async ({ page }) => {
    await gotoGame(page)
    await page.evaluate(() => window.GAME_TEST_API!.resetGame())
    await page.getByTestId('save-btn').click()
    await expect(page.getByTestId('toast')).toContainText('saved', { ignoreCase: true })

    await page.getByTestId('load-btn').click()
    await expect(page.getByTestId('toast')).toContainText('loaded', { ignoreCase: true })
  })

  test('reset clears the save and restores initial stats', async ({ page }) => {
    await gotoGame(page)
    await page.evaluate(async () => {
      const api = window.GAME_TEST_API!
      api.setQuestState('coffee_for_ravi', 'completed')
      await api.saveGame()
    })
    await page.getByTestId('reset-btn').click()
    await page.waitForTimeout(400)
    const stats = await getStats(page)
    expect(stats.money).toBe(50)
    expect(stats.questStates['coffee_for_ravi']).toBe('not_started')
    // After a reset there is nothing to load.
    const loaded = await page.evaluate(() => window.GAME_TEST_API!.loadGame())
    expect(loaded).toBe(false)
  })
})
