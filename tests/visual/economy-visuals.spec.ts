import { expect, test, type Page } from '@playwright/test'

/**
 * Personal Economy, Inventory & Shopping v1 visual baselines. Deterministic:
 * fixed hour + clear weather, state driven through the dev API, the world PAUSED
 * before the shot. The panels are DOM (not the 3D canvas) so they render stably.
 */

async function ready(page: Page): Promise<void> {
  await page.goto('/')
  await page.waitForFunction(() => window.GAME_TEST_API?.ready() === true, undefined, { timeout: 45_000 })
  await page.waitForFunction(() => window.GAME_TEST_API?.assetsSettled() === true, undefined, { timeout: 45_000 })
  await page.evaluate(() => {
    const api = window.GAME_TEST_API!
    api.resetGame()
    api.setTime(13)
    api.setWeather('clear')
  })
  await page.waitForTimeout(500)
}

async function freeze(page: Page): Promise<void> {
  await page.evaluate(() => window.GAME_TEST_API!.pauseWorld(true))
  await page.waitForTimeout(200)
}

test.describe('economy visuals', () => {
  test('Main St shop UI', async ({ page }) => {
    await ready(page)
    await page.evaluate(() => {
      const api = window.GAME_TEST_API!
      api.enterInterior('store_mainst')
      api.openTestShop('store_mainst')
    })
    await freeze(page)
    await expect(page.getByTestId('shop-panel')).toBeVisible()
    await expect(page).toHaveScreenshot('economy-shop-mainst.png')
  })

  test('shop with a sold-out + unaffordable item', async ({ page }) => {
    await ready(page)
    await page.evaluate(() => {
      const api = window.GAME_TEST_API!
      api.enterInterior('store_mainst')
      for (let i = 0; i < 8; i++) api.buyTestItem('store_mainst', 'snack') // sell out snacks
      api.openTestShop('store_mainst')
    })
    await freeze(page)
    await expect(page).toHaveScreenshot('economy-shop-soldout.png')
  })

  test('phone Bag with several item categories', async ({ page }) => {
    await ready(page)
    await page.evaluate(() => {
      const api = window.GAME_TEST_API!
      api.giveTestItem('snack', 4)
      api.giveTestItem('first_aid', 1)
      api.giveTestItem('ammo_box', 2)
      api.giveTestItem('coffee', 1)
      api.openTestPhoneApp('bag')
    })
    await freeze(page)
    await expect(page.getByTestId('phone-bag')).toBeVisible()
    await expect(page).toHaveScreenshot('economy-phone-bag.png')
  })

  test('apartment storage transfer UI', async ({ page }) => {
    await ready(page)
    await page.evaluate(() => {
      const api = window.GAME_TEST_API!
      api.giveTestItem('snack', 5)
      api.giveTestItem('coffee', 1)
      api.depositTestItem('snack', 2)
      api.openTestPanel('storage')
    })
    await freeze(page)
    await expect(page.getByTestId('storage-panel')).toBeVisible()
    await expect(page).toHaveScreenshot('economy-storage-transfer.png')
  })

  test('wardrobe with locked premium colours', async ({ page }) => {
    await ready(page)
    await page.evaluate(() => window.GAME_TEST_API!.openTestPanel('wardrobe'))
    await freeze(page)
    await expect(page.getByTestId('wardrobe-panel')).toBeVisible()
    await expect(page).toHaveScreenshot('economy-wardrobe-locked.png')
  })
})
