import { expect, test } from '@playwright/test'
import { getStats, gotoGame, pressE, waitForActiveInteractable } from './helpers'

/** Apartment / Home Base v1: enter/exit, sleep, wardrobe, storage, phone. */
test.describe('apartment home base', () => {
  test('player enters from the street door and exits back to the city', async ({ page }) => {
    const errors: string[] = []
    page.on('pageerror', (err) => errors.push(String(err)))
    await gotoGame(page)
    await page.evaluate(() => {
      window.GAME_TEST_API!.resetGame()
      window.GAME_TEST_API!.teleportTo('apartment_entrance')
    })
    await waitForActiveInteractable(page, 'apartment')
    await pressE(page)

    await page.waitForFunction(() => window.GAME_TEST_API!.getLocationMode() === 'apartment')
    await expect(page.getByTestId('hud-location')).toHaveText(/Apartment/)

    // Walk-free exit via the door interactable.
    await page.evaluate(() =>
      window.GAME_TEST_API!.teleportPlayer([203.4, 1.2, 203.6]),
    )
    await waitForActiveInteractable(page, 'apartment_exit')
    await pressE(page)
    await page.waitForFunction(() => window.GAME_TEST_API!.getLocationMode() === 'city')
    const stats = await getStats(page)
    // Back on the street by the entrance, not somewhere weird.
    expect(Math.hypot(stats.position[0] + 12.5, stats.position[2] + 7.2)).toBeLessThan(3)
    await expect(page.getByTestId('hud-location')).toBeHidden()
    expect(errors).toEqual([])
  })

  test('sleeping in the bed restores energy and advances to next morning', async ({ page }) => {
    await gotoGame(page)
    await page.evaluate(() => {
      window.GAME_TEST_API!.resetGame()
      window.GAME_TEST_API!.setTime(22)
      window.GAME_TEST_API!.enterApartment()
    })
    await page.waitForTimeout(500)
    const before = await getStats(page)

    await page.evaluate(() => window.GAME_TEST_API!.teleportPlayer([197.5, 1.2, 198.6]))
    await waitForActiveInteractable(page, 'apartment_bed')
    await pressE(page)
    await expect(page.getByTestId('activity-panel')).toBeVisible()
    await page.getByTestId('action-sleep').click()
    await page.waitForTimeout(300)

    const after = await getStats(page)
    expect(after.energy).toBe(100)
    expect(after.hour).toBeCloseTo(7, 0)
    expect(after.day).toBe(before.day + 1)
    expect(after.hunger).toBeGreaterThanOrEqual(before.hunger)
    // Panel closed so the player sees the new morning.
    await expect(page.getByTestId('activity-panel')).toBeHidden()
  })

  test('wardrobe changes the outfit and it survives save/load', async ({ page }) => {
    await gotoGame(page)
    await page.evaluate(() => {
      window.GAME_TEST_API!.resetGame()
      window.GAME_TEST_API!.enterApartment()
    })
    await page.evaluate(() => window.GAME_TEST_API!.teleportPlayer([201.1, 1.2, 198.6]))
    await waitForActiveInteractable(page, 'apartment_wardrobe')
    await pressE(page)
    await expect(page.getByTestId('wardrobe-panel')).toBeVisible()
    await page.getByTestId('swatch-shirtColor-red').click()
    await page.getByTestId('swatch-pantsColor-black').click()
    await page.keyboard.press('Escape')
    await expect(page.getByTestId('wardrobe-panel')).toBeHidden()

    const changed = await page.evaluate(() => window.GAME_TEST_API!.getAppearance())
    expect(changed.shirtColor).toBe('#d1495b')
    expect(changed.pantsColor).toBe('#2b2d33')

    await page.evaluate(async () => {
      await window.GAME_TEST_API!.saveGame()
      window.GAME_TEST_API!.setAppearance({ shirtColor: '#ffffff' })
      await window.GAME_TEST_API!.loadGame()
    })
    await page.waitForTimeout(300)
    const restored = await page.evaluate(() => window.GAME_TEST_API!.getAppearance())
    expect(restored.shirtColor).toBe('#d1495b')
    expect(restored.pantsColor).toBe('#2b2d33')
    // Saved inside → loads back in the city by the entrance (v1 rule).
    expect(await page.evaluate(() => window.GAME_TEST_API!.getLocationMode())).toBe('city')
  })

  test('storage shows the bag without touching quest inventory', async ({ page }) => {
    await gotoGame(page)
    await page.evaluate(() => {
      window.GAME_TEST_API!.resetGame()
      window.GAME_TEST_API!.giveItem('coffee', 1)
      window.GAME_TEST_API!.enterApartment()
    })
    await page.evaluate(() => window.GAME_TEST_API!.teleportPlayer([203.6, 1.2, 198.8]))
    await waitForActiveInteractable(page, 'apartment_storage')
    await pressE(page)
    await expect(page.getByTestId('storage-panel')).toBeVisible()
    // The transfer UI lists the coffee on the bag side, but a quest-reserved item
    // is locked (🔒) — no Store control, so it can never leave the player's bag.
    await expect(page.getByTestId('storage-bag-coffee')).toContainText('Coffee × 1')
    await expect(page.getByTestId('storage-bag-one-coffee')).toHaveCount(0)
    await expect(page.getByTestId('storage-chest-empty')).toBeVisible()
    // Even a direct deposit request is refused by the item service.
    await page.evaluate(() => window.GAME_TEST_API!.depositTestItem('coffee', 1))
    await expect(page.getByTestId('storage-chest-empty')).toBeVisible()
    await page.keyboard.press('Escape')
    const inv = await page.evaluate(
      () => window.GAME_TEST_API!.getStats().inventory as Record<string, number>,
    )
    expect(inv.coffee).toBe(1)
  })

  test('phone works inside: At home flavor, closes, movement resumes', async ({ page }) => {
    await gotoGame(page)
    await page.evaluate(() => {
      window.GAME_TEST_API!.resetGame()
      window.GAME_TEST_API!.enterApartment()
    })
    await page.waitForTimeout(400)
    await page.keyboard.press('Tab')
    await expect(page.getByTestId('phone-location')).toHaveText(/At home/)
    await page.keyboard.press('Escape')

    // Movement resumes: walk within the room and verify displacement.
    const before = await getStats(page)
    await page.keyboard.down('a')
    await page.waitForTimeout(600)
    await page.keyboard.up('a')
    const after = await getStats(page)
    const moved = Math.hypot(
      after.position[0] - before.position[0],
      after.position[2] - before.position[2],
    )
    expect(moved).toBeGreaterThan(0.5)
    // Still indoors, still inside the room bounds.
    expect(await page.evaluate(() => window.GAME_TEST_API!.getLocationMode())).toBe('apartment')
    expect(Math.abs(after.position[0] - 200)).toBeLessThan(6.5)
    expect(Math.abs(after.position[2] - 200)).toBeLessThan(5.5)
  })
})
