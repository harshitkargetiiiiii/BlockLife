import { expect, test } from '@playwright/test'
import { acquireDrivableCar, getStats, gotoGame, teleport } from './helpers'

test.describe('phone', () => {
  test.beforeEach(async ({ page }) => {
    await gotoGame(page)
    await page.evaluate(() => window.GAME_TEST_API!.resetGame())
    await page.waitForTimeout(300)
  })

  test('opens with Tab, switches apps, closes, and movement resumes', { tag: '@simulation-only' }, async ({ page }) => {
    await teleport(page, [0, 1.2, 0])

    await page.keyboard.press('Tab')
    await expect(page.getByTestId('phone')).toBeVisible()
    await expect(page.getByTestId('phone-app-home')).toBeVisible()
    await expect(page.getByTestId('phone-status-money')).toContainText('$50')

    // Walk through every app via the bottom nav.
    for (const app of ['map', 'quests', 'messages', 'contacts', 'jobs', 'settings'] as const) {
      await page.getByTestId(`phone-nav-${app}`).click()
      await expect(page.getByTestId(`phone-app-${app}`)).toBeVisible()
    }
    // Map shows the key markers.
    await page.getByTestId('phone-nav-map').click()
    for (const marker of ['apartment', 'food_truck_01', 'gym', 'job_board', 'player', 'car']) {
      await expect(page.getByTestId(`map-marker-${marker}`)).toBeVisible()
    }

    // Escape closes; player can move again.
    await page.keyboard.press('Escape')
    await expect(page.getByTestId('phone')).toBeHidden()
    const before = (await getStats(page)).position
    await page.keyboard.down('w')
    await page.waitForTimeout(500)
    await page.keyboard.up('w')
    const after = (await getStats(page)).position
    expect(Math.hypot(after[0] - before[0], after[2] - before[2])).toBeGreaterThan(1)
  })

  test('blocks walking while open and Tab toggles it closed', async ({ page }) => {
    await teleport(page, [0, 1.2, 0])
    await page.keyboard.press('Tab')
    await expect(page.getByTestId('phone')).toBeVisible()

    const before = (await getStats(page)).position
    await page.keyboard.down('w')
    await page.waitForTimeout(600)
    await page.keyboard.up('w')
    const during = (await getStats(page)).position
    expect(
      Math.hypot(during[0] - before[0], during[2] - before[2]),
      'player moved while the phone was open',
    ).toBeLessThan(0.2)

    await page.keyboard.press('Tab')
    await expect(page.getByTestId('phone')).toBeHidden()
  })

  test('blocks driving while open', async ({ page }) => {
    await acquireDrivableCar(page) // §19: own an active Compact shell (no free car on a new game)
    await teleport(page, [13, 1.2, 14])
    await page.waitForFunction(
      () => window.GAME_TEST_API!.getStats().activeInteractableId === 'vehicle_compact_car_01',
    )
    await page.keyboard.press('e')
    await page.waitForTimeout(200)
    expect((await getStats(page)).mode).toBe('driving')

    await page.keyboard.press('Tab')
    await expect(page.getByTestId('phone')).toBeVisible()
    const before = (await getStats(page)).position
    await page.keyboard.down('w')
    await page.waitForTimeout(700)
    await page.keyboard.up('w')
    const during = (await getStats(page)).position
    expect(Math.hypot(during[0] - before[0], during[2] - before[2])).toBeLessThan(0.3)

    await page.keyboard.press('Escape')
    await page.keyboard.down('w')
    await page.waitForTimeout(700)
    await page.keyboard.up('w')
    const after = (await getStats(page)).position
    expect(Math.hypot(after[0] - during[0], after[2] - during[2])).toBeGreaterThan(1.5)
  })

  test('quest app reflects live quest state', async ({ page }) => {
    await page.evaluate(() => window.GAME_TEST_API!.setQuestState('coffee_for_ravi', 'has_coffee'))
    await page.keyboard.press('Tab')
    await page.getByTestId('phone-nav-quests').click()
    await expect(page.getByTestId('phone-quest-state')).toContainText('In progress')
    await expect(page.getByTestId('phone-quest-coffee_for_ravi')).toContainText(
      '▸ Return the coffee to Ravi',
    )
    await page.evaluate(() => window.GAME_TEST_API!.setQuestState('coffee_for_ravi', 'completed'))
    await expect(page.getByTestId('phone-quest-state')).toContainText('Completed')
  })
})
