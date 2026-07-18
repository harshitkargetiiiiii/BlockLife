import { expect, test, type Page } from '@playwright/test'

/**
 * Store Robbery v1 visual baselines. Deterministic like the crime/mission set:
 * fixed hour + clear weather, activity state driven through the dev API, the
 * player teleported to a fixed spot, then the world PAUSED (snaps actors to
 * canonical poses + freezes the threat meter) before the shot.
 */

async function ready(page: Page): Promise<void> {
  await page.goto('/')
  await page.waitForFunction(() => window.GAME_TEST_API?.ready() === true, undefined, { timeout: 45_000 })
  await page.waitForFunction(() => window.GAME_TEST_API?.assetsSettled() === true, undefined, { timeout: 45_000 })
  await page.evaluate(() => {
    const api = window.GAME_TEST_API!
    api.resetGame()
    api.resetActivities()
    api.clearWanted()
    api.setTime(13)
    api.setWeather('clear')
  })
  await page.waitForTimeout(700)
}

async function freeze(page: Page): Promise<void> {
  await page.waitForTimeout(900)
  await page.evaluate(() => window.GAME_TEST_API!.pauseWorld(true))
  await page.waitForTimeout(400)
}

test.describe('robbery visuals', () => {
  test('convenience store exterior + entrance marker', async ({ page }) => {
    await ready(page)
    await page.evaluate(() => window.GAME_TEST_API!.teleportPlayer([132, 1.2, -314]))
    await freeze(page)
    await expect(page).toHaveScreenshot('robbery-store-exterior.png')
  })

  test('convenience store interior — cashier + counter', async ({ page }) => {
    await ready(page)
    await page.evaluate(() => {
      const api = window.GAME_TEST_API!
      api.enterInterior('store_mainst')
      api.teleportPlayer([260, 1.2, 207])
    })
    await freeze(page)
    await expect(page).toHaveScreenshot('robbery-store-interior.png')
  })

  test('robbery in progress — threat HUD + covered cashier', async ({ page }) => {
    await ready(page)
    await page.evaluate(() => {
      const api = window.GAME_TEST_API!
      api.enterInterior('store_mainst')
      api.givePlayerWeapon('handgun')
      api.drawPlayerWeapon()
      api.teleportPlayer([258.6, 1.2, 205.5])
      api.setPlayerHeading(0)
      api.forceBeginRobbery('robbery_mainst_store')
    })
    await freeze(page)
    await expect(page).toHaveScreenshot('robbery-in-progress.png')
  })

  test('open register + unsecured proceeds badge', async ({ page }) => {
    await ready(page)
    await page.evaluate(() => {
      const api = window.GAME_TEST_API!
      api.enterInterior('store_mainst')
      api.givePlayerWeapon('handgun')
      api.drawPlayerWeapon()
      api.teleportPlayer([258.6, 1.2, 205.5])
      api.setPlayerHeading(0)
      api.forceBeginRobbery('robbery_mainst_store')
      api.teleportPlayer([258.6, 1.2, 203.8])
      api.lootStoreRegister()
    })
    await freeze(page)
    await expect(page).toHaveScreenshot('robbery-looted-proceeds.png')
  })

  test('waterfront kiosk interior', async ({ page }) => {
    await ready(page)
    await page.evaluate(() => {
      const api = window.GAME_TEST_API!
      api.enterInterior('store_kiosk')
      api.teleportPlayer([205, 1.2, 267])
    })
    await freeze(page)
    await expect(page).toHaveScreenshot('robbery-kiosk-interior.png')
  })
})
