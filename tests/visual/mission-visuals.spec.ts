import { expect, test, type Page } from '@playwright/test'
import { waitForSceneSettled } from './visualHelpers'

/**
 * Mission & Activity Framework v1 visual baselines. Deterministic exactly like
 * the crime set: fixed hour + clear weather, mission state driven through the
 * dev API, the player teleported to a fixed spot, then the world PAUSED (which
 * snaps actors to canonical poses and freezes the marker bob) before the shot.
 */

async function ready(page: Page): Promise<void> {
  await page.goto('/')
  await page.waitForFunction(() => window.GAME_TEST_API?.ready() === true, undefined, { timeout: 45_000 })
  await waitForSceneSettled(page)
  await page.evaluate(() => {
    const api = window.GAME_TEST_API!
    api.resetGame()
    api.setTime(13)
    api.setWeather('clear')
  })
  await page.waitForTimeout(700)
}

/** Settle the world, freeze it, and shoot. */
async function freeze(page: Page): Promise<void> {
  await page.waitForTimeout(1500)
  await page.evaluate(() => window.GAME_TEST_API!.pauseWorld(true))
  await page.waitForTimeout(500)
}

test.describe('mission visuals', () => {
  test('City Courier — pickup marker + HUD tracker', async ({ page }) => {
    await ready(page)
    await page.evaluate(() => {
      const api = window.GAME_TEST_API!
      api.startMission('city_courier')
      api.teleportPlayer([16, 1.2, 6])
    })
    await freeze(page)
    await expect(page).toHaveScreenshot('mission-courier-pickup.png')
  })

  test('City Courier — Waterfront delivery marker', async ({ page }) => {
    await ready(page)
    await page.evaluate(() => {
      const api = window.GAME_TEST_API!
      api.startMission('city_courier')
      api.forceMissionEvent({ type: 'interactable_used', interactableId: 'courier_depot' })
      api.teleportPlayer([2, 1.2, -292])
    })
    await freeze(page)
    await expect(page).toHaveScreenshot('mission-courier-waterfront.png')
  })

  test('Hot Cargo — marked target vehicle', async ({ page }) => {
    await ready(page)
    await page.evaluate(() => {
      const api = window.GAME_TEST_API!
      api.startMission('hot_cargo')
      api.setMissionTargetVehicle('theft_occupied_plaza')
      // Stand on the road just south of the marked car so the beacon frames
      // centrally (and the player isn't inside a building's cutaway).
      api.teleportPlayer([30, 1.2, 13])
    })
    await freeze(page)
    await expect(page).toHaveScreenshot('mission-hotcargo-target.png')
  })

  test("Hot Cargo — fixer's garage delivery marker", async ({ page }) => {
    await ready(page)
    await page.evaluate(() => {
      const api = window.GAME_TEST_API!
      api.startMission('hot_cargo')
      api.setMissionTargetVehicle('theft_occupied_plaza')
      api.forceMissionEvent({ type: 'vehicle_stolen', vehicleId: 'theft_occupied_plaza', theftKind: 'occupied_vehicle_theft' })
      api.clearWanted()
      api.forceMissionEvent({ type: 'wanted_changed', previous: 2, current: 0 })
      api.teleportPlayer([-182, 1.2, -228])
    })
    await freeze(page)
    await expect(page).toHaveScreenshot('mission-hotcargo-garage.png')
  })

  test('mission completion banner', async ({ page }) => {
    await ready(page)
    await page.evaluate(() => {
      const api = window.GAME_TEST_API!
      api.teleportPlayer([-11, 1.2, -7])
      api.startMission('city_courier')
    })
    await page.waitForTimeout(900)
    await page.evaluate(() => {
      const api = window.GAME_TEST_API!
      // Drive the whole courier loop through events, ending in the reward banner.
      api.forceMissionEvent({ type: 'interactable_used', interactableId: 'courier_depot' })
      api.forceMissionEvent({ type: 'reached_zone', anchorId: 'courier_waterfront' })
      api.forceMissionEvent({ type: 'reached_zone', anchorId: 'courier_mainstreet' })
      api.forceMissionEvent({ type: 'reached_zone', anchorId: 'courier_return' })
      api.pauseWorld(true)
    })
    await page.waitForTimeout(600) // banner slide-in settles (well before auto-dismiss)
    await expect(page).toHaveScreenshot('mission-complete-banner.png')
  })

  test('mission failure banner', async ({ page }) => {
    await ready(page)
    await page.evaluate(() => {
      const api = window.GAME_TEST_API!
      api.teleportPlayer([-11, 1.2, -7])
      api.startMission('hot_cargo')
    })
    await page.waitForTimeout(900)
    await page.evaluate(() => {
      const api = window.GAME_TEST_API!
      api.forceMissionEvent({ type: 'player_arrested' })
      api.pauseWorld(true)
    })
    await page.waitForTimeout(600)
    await expect(page).toHaveScreenshot('mission-failed-banner.png')
  })

  test('phone — Jobs+ mission board', async ({ page }) => {
    await ready(page)
    await page.evaluate(() => {
      const api = window.GAME_TEST_API!
      api.teleportPlayer([-11, 1.2, -7])
      api.startMission('city_courier')
      api.pauseWorld(true)
    })
    await page.waitForTimeout(500)
    await page.evaluate(() => window.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyP' })))
    await page.waitForTimeout(400)
    await page.getByText('Jobs+', { exact: true }).click()
    await page.waitForTimeout(500)
    await expect(page).toHaveScreenshot('mission-phone-board.png')
  })
})
