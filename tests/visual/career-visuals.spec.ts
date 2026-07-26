import { expect, test, type Page } from '@playwright/test'

/**
 * Career, Skills & Life Progression v1 (issue #15 §16) visual baselines.
 * Deterministic: fixed time + clear weather, state driven through the dev API, the
 * world PAUSED before each shot. Every shot is scoped to a DOM panel/element (never
 * the 3D canvas) so it renders stably. Eight required surfaces are covered.
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
  await page.waitForTimeout(400)
}
async function freeze(page: Page): Promise<void> {
  await page.evaluate(() => window.GAME_TEST_API!.pauseWorld(true))
  await page.waitForTimeout(200)
}
/** Run N delivery shifts to completion via the test API (for the promoted state). */
async function runDeliveryShifts(page: Page, n: number): Promise<void> {
  await page.evaluate((n) => {
    const api = window.GAME_TEST_API!
    api.ingestCareerEvent({ id: 'seed_drv', kind: 'training_milestone', gameDay: 0, skillAwards: [{ skill: 'driving', amount: 95, reason: 'training_milestone' }] })
    if (api.getCareerSnapshot().activeJob !== 'delivery_driver') api.applyToCareer('delivery_driver')
    for (let i = 0; i < n; i++) {
      const shift = api.getCareerNextShift()
      if (!shift) break
      api.setGameDay(shift.scheduledDay)
      api.setTime(shift.startHour)
      api.setActiveInteractable(shift.workplaceInteractableId)
      api.startCareerShift(shift.id)
      for (let g = 0; g < 16; g++) {
        const s = api.getActiveCareerShift()
        if (!s) break
        const step = s.objectives.find((o) => !o.optional && !o.done)
        if (!step) break
        api.setActiveInteractable(step.anchorId ?? s.workplaceInteractableId)
        api.advanceCareerShift()
      }
    }
    api.setActiveInteractable(null)
    api.setTime(13)
  }, n)
}

test.describe('career visuals', () => {
  test('career discovery + eligibility', async ({ page }) => {
    await ready(page)
    await page.evaluate(() => window.GAME_TEST_API!.openTestPhoneApp('jobs'))
    await freeze(page)
    await expect(page.getByTestId('phone-jobs')).toBeVisible()
    await expect(page.getByTestId('phone')).toHaveScreenshot('career-discovery.png')
  })

  test('application refusal reason', async ({ page }) => {
    await ready(page)
    await page.evaluate(() => window.GAME_TEST_API!.openTestPhoneApp('jobs'))
    await freeze(page)
    await expect(page.getByTestId('career-reason-gym_trainer')).toBeVisible()
    await expect(page.getByTestId('career-gym_trainer')).toHaveScreenshot('career-refusal.png')
  })

  test('active career + five-skill profile', async ({ page }) => {
    await ready(page)
    await page.evaluate(() => {
      const api = window.GAME_TEST_API!
      api.ingestCareerEvent({ id: 's', kind: 'training_milestone', gameDay: 0, skillAwards: [
        { skill: 'driving', amount: 95, reason: 'training_milestone' },
        { skill: 'work_ethic', amount: 55, reason: 'training_milestone' },
      ] })
      api.applyToCareer('delivery_driver')
      api.openTestPhoneApp('jobs')
    })
    await freeze(page)
    await expect(page.getByTestId('career-active')).toBeVisible()
    await expect(page.getByTestId('phone')).toHaveScreenshot('career-profile.png')
  })

  test('scheduled shift with a startable window', async ({ page }) => {
    await ready(page)
    await page.evaluate(() => {
      const api = window.GAME_TEST_API!
      api.applyToCareer('delivery_driver')
      const shift = api.getCareerNextShift()!
      api.setGameDay(shift.scheduledDay)
      api.setTime(shift.startHour)
      api.setActiveInteractable(shift.workplaceInteractableId)
      api.openTestPhoneApp('jobs')
    })
    await freeze(page)
    await expect(page.getByTestId('career-next-shift')).toBeVisible()
    await expect(page.getByTestId('career-next-shift')).toHaveScreenshot('career-next-shift.png')
  })

  test('active shift HUD tracker', async ({ page }) => {
    await ready(page)
    await page.evaluate(() => {
      const api = window.GAME_TEST_API!
      api.applyToCareer('delivery_driver')
      const shift = api.getCareerNextShift()!
      api.setGameDay(shift.scheduledDay)
      api.setTime(shift.startHour)
      api.setActiveInteractable(shift.workplaceInteractableId)
      api.startCareerShift(shift.id)
      api.setTime(13)
    })
    await freeze(page)
    await expect(page.getByTestId('career-shift-tracker')).toBeVisible()
    await expect(page.getByTestId('career-shift-tracker')).toHaveScreenshot('career-shift-tracker.png')
  })

  test('promotion progress', async ({ page }) => {
    await ready(page)
    await page.evaluate(() => {
      const api = window.GAME_TEST_API!
      api.applyToCareer('delivery_driver')
      api.openTestPhoneApp('jobs')
    })
    await freeze(page)
    await expect(page.getByTestId('career-promo')).toBeVisible()
    await expect(page.getByTestId('career-promo')).toHaveScreenshot('career-promotion.png')
  })

  test('promoted rank + unlocked benefit', async ({ page }) => {
    await ready(page)
    await runDeliveryShifts(page, 3) // promotes Trainee → Regular, unlocking the thermal bag
    await page.evaluate(() => window.GAME_TEST_API!.openTestPhoneApp('jobs'))
    await freeze(page)
    await expect(page.getByTestId('career-unlocks')).toBeVisible()
    await expect(page.getByTestId('phone')).toHaveScreenshot('career-unlocks.png')
  })

  test('shift result — pay + performance in the money HUD', async ({ page }) => {
    await ready(page)
    // A completed shift pays through the money authority — the HUD money reflects it.
    await runDeliveryShifts(page, 1)
    await page.evaluate(() => window.GAME_TEST_API!.openTestPhoneApp('jobs'))
    await freeze(page)
    await expect(page.getByTestId('career-active')).toBeVisible()
    await expect(page.getByTestId('phone')).toHaveScreenshot('career-shift-result.png')
  })
})
