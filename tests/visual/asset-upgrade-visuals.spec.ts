import { expect, test, type Page } from '@playwright/test'

/**
 * 3D Asset Pipeline & Visual Upgrade v1 (issue #21 §14) — dedicated showcase
 * baselines that frame the FOUR production GLB assets prominently (the existing
 * suite only exercises them incidentally). The world is PAUSED before each shot,
 * which snaps characters to the idle clip's first frame for pixel-determinism.
 * 3D-world shots allow a small pixel-diff ratio (low-poly AA on device pixels).
 */

async function boot(page: Page) {
  await page.goto('/')
  await page.waitForFunction(() => window.GAME_TEST_API?.ready() === true, undefined, { timeout: 45_000 })
  await page.waitForFunction(() => window.GAME_TEST_API?.assetsSettled() === true, undefined, {
    timeout: 45_000,
  })
}

async function waitForNpcModel(page: Page, id: string) {
  await page.waitForFunction(
    (n) => window.GAME_TEST_API!.getCharacterState(n)?.modelLoaded === true,
    id,
    { timeout: 15_000 },
  )
}

async function settleAndPause(page: Page) {
  await page.waitForTimeout(2600)
  await page.evaluate(() => window.GAME_TEST_API!.pauseWorld(true))
  await page.waitForTimeout(700)
}

test.describe('asset upgrade visuals (§21 §14)', () => {
  test('apartment building GLB on the residential corner', async ({ page }) => {
    await boot(page)
    await page.evaluate(() => {
      const a = window.GAME_TEST_API!
      a.resetGame()
      a.setTime(13)
      a.setWeather('clear')
      a.teleportPlayer([24, 1.2, -47])
    })
    await settleAndPause(page)
    await expect(page).toHaveScreenshot('asset-building-apartment.png', { maxDiffPixelRatio: 0.02 })
  })

  test('female humanoid NPC (Maya) at the food truck', async ({ page }) => {
    await boot(page)
    await page.evaluate(() => {
      const a = window.GAME_TEST_API!
      a.resetGame()
      a.setTime(13)
      a.setWeather('clear')
      a.teleportPlayer([7, 1.2, -2])
    })
    await waitForNpcModel(page, 'npc_maya_01')
    await settleAndPause(page)
    await expect(page).toHaveScreenshot('asset-humanoid-female.png', { maxDiffPixelRatio: 0.02 })
  })

  test('both humanoid NPCs (Maya + Ravi) near the plaza', async ({ page }) => {
    await boot(page)
    await page.evaluate(() => {
      const a = window.GAME_TEST_API!
      a.resetGame()
      a.setTime(13)
      a.setWeather('clear')
      a.teleportPlayer([12, 1.2, -1])
    })
    await waitForNpcModel(page, 'npc_maya_01')
    await waitForNpcModel(page, 'npc_ravi_01')
    await settleAndPause(page)
    await expect(page).toHaveScreenshot('asset-humanoids-both.png', { maxDiffPixelRatio: 0.02 })
  })

  // §14/§10: each ownable class projects a DISTINCT GLB body onto the one shell. Grant the
  // class ACTIVE (DEV bypass of the sports career gate), enter + drive so the shell is present,
  // and shoot it centred — the generous waits let the freshly-granted class GLB finish loading
  // (a fresh owned vehicle triggers a new GLB fetch; a CarMesh fallback is NOT a passing shot).
  for (const [defId, name] of [
    ['veh_compact', 'compact'],
    ['veh_scooter', 'scooter'],
    ['veh_van', 'van'],
    ['veh_sports', 'sports'],
  ] as const) {
    test(`${name} class GLB driven as the one shell`, async ({ page }) => {
      await boot(page)
      await page.evaluate((d) => {
        const a = window.GAME_TEST_API!
        a.resetGame()
        a.setTime(13)
        a.setWeather('clear')
        a.vehicleGrant(d, { location: 'active' })
        a.teleportPlayer([13, 1.2, 14])
      }, defId)
      await page.waitForFunction(
        () => window.GAME_TEST_API!.getStats().activeInteractableId === 'vehicle_compact_car_01',
        undefined,
        { timeout: 15_000 },
      )
      await page.keyboard.press('e')
      await page.waitForFunction(() => window.GAME_TEST_API!.getStats().mode === 'driving', undefined, {
        timeout: 15_000,
      })
      await page.waitForTimeout(1500)
      await page.evaluate(() => window.GAME_TEST_API!.setDrivenCarPosition([0, -10], 0.3))
      await settleAndPause(page)
      await expect(page).toHaveScreenshot(`asset-vehicle-${name}.png`, { maxDiffPixelRatio: 0.02 })
    })
  }
})
