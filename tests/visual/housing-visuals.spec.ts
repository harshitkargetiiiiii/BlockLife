import { expect, test, type Page } from '@playwright/test'

/**
 * Housing, Furniture & Property Progression v1 (issue #17 §17) visual baselines.
 * Deterministic: fixed time + clear weather, state driven through the dev API, the
 * world PAUSED before each shot. DOM surfaces are scoped to a panel/phone element;
 * the interior scenes shoot the paused viewport at a fixed spawn. 12 surfaces.
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
  await page.waitForTimeout(300)
}
async function freeze(page: Page): Promise<void> {
  await page.evaluate(() => window.GAME_TEST_API!.pauseWorld(true))
  await page.waitForTimeout(200)
}
/** Regular-rank tenant of a furnished City Loft, with a hostable coffee setup. */
async function furnishLoft(page: Page): Promise<void> {
  await page.evaluate(() => {
    const api = window.GAME_TEST_API!
    api.ingestCareerEvent({ id: 'seed', kind: 'training_milestone', gameDay: 0, skillAwards: [{ skill: 'driving', amount: 95, reason: 'training_milestone' }] })
    api.applyToCareer('delivery_driver')
    // Promote to Regular through real shifts so the loft is eligible.
    for (let n = 0; n < 3; n++) {
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
    api.setMoney(6000)
    api.housingTour('city_loft')
    api.housingLease('city_loft')
    for (const id of ['bed_kingsize', 'sofa', 'coffee_table', 'tv_flatscreen', 'wardrobe_mirror', 'storage_cabinet', 'area_rug', 'floor_lamp']) api.housingBuyFurniture(id)
    const s = api.getHousingState()
    const find = (def: string) => Object.keys(s.assets).find((a) => s.assets[a].defId === def)!
    api.housingPlaceFurniture('lf_bed', find('bed_kingsize'))
    api.housingPlaceFurniture('lf_sofa', find('sofa'))
    api.housingPlaceFurniture('lf_coffee', find('coffee_table'))
    api.housingPlaceFurniture('lf_ent', find('tv_flatscreen'))
    api.housingPlaceFurniture('lf_wardrobe', find('wardrobe_mirror'))
    api.housingPlaceFurniture('lf_storage', find('storage_cabinet'))
    api.housingPlaceFurniture('lf_decor', find('area_rug'))
    api.housingPlaceFurniture('lf_bedside', find('floor_lamp'))
    api.setTime(13)
  })
}
/** Walk into the current residence's interior via its city door. */
async function enterHome(page: Page, door: [number, number, number], id: string): Promise<void> {
  await page.evaluate((d) => window.GAME_TEST_API!.teleportPlayer(d), door)
  await page.waitForTimeout(150)
  await page.evaluate((iid) => window.GAME_TEST_API!.setActiveInteractable(iid), id)
  await page.evaluate(() => window.GAME_TEST_API!.interact())
  await page.waitForFunction(() => window.GAME_TEST_API!.getLocationMode() === 'apartment')
  await page.waitForTimeout(300)
}
/**
 * Stand inside the City Loft for an interior shot. Leasing WHILE touring already
 * leaves the player in the new home (`leaseHousingProperty` — you're standing in it),
 * so `furnishLoft` ends inside; re-running the city `enterHome` would only drag the
 * avatar back onto the street with the flag still 'apartment'. This just re-centres
 * on the loft spawn and waits until the far off-grid sector has streamed in.
 */
async function ensureInsideLoft(page: Page): Promise<void> {
  await page.evaluate(() => window.GAME_TEST_API!.teleportPlayer([204.6, 1.2, 305.6])) // LOFT_SPAWN
  await page.waitForFunction(
    () => window.GAME_TEST_API!.getLocationMode() === 'apartment'
      && (window.GAME_TEST_API!.getStats().activeInteractableId ?? '').startsWith('loft_'),
    undefined, { timeout: 10_000 },
  )
  await page.waitForTimeout(300)
}
/**
 * Open Furnish mode inside the City Loft. Must WALK the player onto the furnish
 * station ([200.2,1.2,305.4] = LOFT anchor) so the proximity scanner selects
 * `loft_furnish` and keeps it selected while `interact()` fires — forcing the id
 * via setActiveInteractable races the per-frame scanner (CONVENTIONS #26).
 */
async function openLoftFurnish(page: Page): Promise<void> {
  await page.evaluate(() => window.GAME_TEST_API!.teleportPlayer([200.2, 1.2, 305.4]))
  await page.waitForFunction(() => window.GAME_TEST_API!.getStats().activeInteractableId === 'loft_furnish', undefined, { timeout: 10_000 })
  await page.evaluate(() => window.GAME_TEST_API!.interact())
  await page.waitForFunction(() => !!document.querySelector('[data-testid="furnish-panel"]'), undefined, { timeout: 10_000 })
}

test.describe('housing visuals', () => {
  test('Home app — current lease + rent', async ({ page }) => {
    await ready(page)
    await page.evaluate(() => window.GAME_TEST_API!.openTestPhoneApp('housing'))
    await freeze(page)
    await expect(page.getByTestId('housing-current')).toBeVisible()
    await expect(page.getByTestId('housing-current')).toHaveScreenshot('housing-lease.png')
  })

  test('Home app — property listings + refusal', async ({ page }) => {
    await ready(page)
    await page.evaluate(() => window.GAME_TEST_API!.openTestPhoneApp('housing'))
    await freeze(page)
    await expect(page.getByTestId('housing-listing-city_loft')).toBeVisible()
    await expect(page.getByTestId('housing-listing-city_loft')).toHaveScreenshot('housing-listing-refusal.png')
  })

  test('Home app — metric breakdown', async ({ page }) => {
    await ready(page)
    await page.evaluate(() => window.GAME_TEST_API!.openTestPhoneApp('housing'))
    await freeze(page)
    await expect(page.getByTestId('housing-metrics')).toBeVisible()
    await expect(page.getByTestId('housing-metrics')).toHaveScreenshot('housing-metrics.png')
  })

  test('Home app — furniture inventory card', async ({ page }) => {
    await ready(page)
    await furnishLoft(page)
    await page.evaluate(() => window.GAME_TEST_API!.openTestPhoneApp('housing'))
    await freeze(page)
    await expect(page.getByTestId('housing-furniture')).toBeVisible()
    await expect(page.getByTestId('housing-furniture')).toHaveScreenshot('housing-furniture-card.png')
  })

  test('Home app — hosting requirements', async ({ page }) => {
    await ready(page)
    await page.evaluate(() => window.GAME_TEST_API!.openTestPhoneApp('housing'))
    await freeze(page)
    await expect(page.getByTestId('hosting-movie_night')).toBeVisible()
    await expect(page.getByTestId('hosting-movie_night')).toHaveScreenshot('housing-hosting-requirements.png')
  })

  test('Home app — overdue rent', async ({ page }) => {
    await ready(page)
    await page.evaluate(() => {
      const api = window.GAME_TEST_API!
      api.setMoney(0)
      api.setGameDay(12) // past the first due day + grace with no funds → delinquent
      api.housingReconcileRent() // production reconciles rent on phone-open; the shortcut needs it explicitly
      api.openTestPhoneApp('housing')
    })
    await freeze(page)
    await expect(page.getByTestId('housing-rent')).toBeVisible()
    await expect(page.getByTestId('housing-current')).toHaveScreenshot('housing-rent-overdue.png')
  })

  test('Furnish mode — slots + shop', async ({ page }) => {
    await ready(page)
    await furnishLoft(page)
    await openLoftFurnish(page)
    await freeze(page)
    await expect(page.getByTestId('furnish-panel')).toBeVisible()
    await expect(page.getByTestId('furnish-panel')).toHaveScreenshot('housing-furnish-mode.png')
  })

  test('Furnish mode — a slot selected for a move', async ({ page }) => {
    await ready(page)
    await furnishLoft(page)
    await openLoftFurnish(page)
    await page.getByTestId('furnish-move-lf_sofa').click()
    await freeze(page)
    await expect(page.getByTestId('furnish-slot-lf_sofa')).toHaveScreenshot('housing-furnish-selected.png')
  })

  test('Starter Studio interior', async ({ page }) => {
    await ready(page)
    await enterHome(page, [-12.5, 1.2, -9], 'apartment')
    await freeze(page)
    await expect(page).toHaveScreenshot('housing-studio-interior.png', { maxDiffPixelRatio: 0.02 })
  })

  test('City Loft furnished', async ({ page }) => {
    await ready(page)
    await furnishLoft(page)
    await ensureInsideLoft(page)
    await freeze(page)
    await expect(page).toHaveScreenshot('housing-loft-furnished.png', { maxDiffPixelRatio: 0.02 })
  })

  test('Premium Apartment interior (tour)', async ({ page }) => {
    await ready(page)
    // Touring enters the real Premium interior without needing to lease it.
    await page.evaluate(() => window.GAME_TEST_API!.housingTour('premium_apartment'))
    await page.waitForFunction(() => window.GAME_TEST_API!.getLocationMode() === 'apartment')
    await page.waitForTimeout(300)
    await freeze(page)
    await expect(page).toHaveScreenshot('housing-premium-interior.png', { maxDiffPixelRatio: 0.03 })
  })

  test('Active home hosting scene', async ({ page }) => {
    await ready(page)
    await furnishLoft(page)
    await ensureInsideLoft(page)
    // A guest at the anchor via a confirmed home plan.
    await page.evaluate(() => {
      const api = window.GAME_TEST_API!
      api.ingestSocialEvent({ id: 'met', kind: 'met', actorId: 'npc_ravi_01', gameDay: 0 })
      for (let i = 0; i < 8; i++) api.ingestSocialEvent({ id: `b${i}`, kind: 'gift_liked', actorId: 'npc_ravi_01', gameDay: 0 })
      api.ingestSocialEvent({ id: 'f', kind: 'favor_completed', actorId: 'npc_ravi_01', gameDay: 0 })
      api.housingInviteGuest('npc_ravi_01', 'coffee_home')
      const inv = api.getSocialInvitations().find((i) => i.activityKind === 'coffee_home')
      if (inv && inv.status === 'accepted') {
        api.setGameDay(inv.proposedDay)
        api.housingHostAtAnchor() // starts the hosting activity (step: travel)
      }
    })
    // Stand at the host anchor and advance to the active 'together' step, so the
    // tracker reads "Enjoy coffee at home with Ravi" rather than "head home".
    await page.evaluate(() => window.GAME_TEST_API!.teleportPlayer([202.4, 1.2, 301.6])) // loft_host
    await page.waitForFunction(() => window.GAME_TEST_API!.getStats().activeInteractableId === 'loft_host', undefined, { timeout: 10_000 })
    await page.evaluate(() => window.GAME_TEST_API!.housingHostAtAnchor()) // travel → together
    await page.waitForFunction(() => window.GAME_TEST_API!.getHomeHosting()?.step === 'together', undefined, { timeout: 10_000 })
    await freeze(page)
    await expect(page).toHaveScreenshot('housing-hosting-scene.png', { maxDiffPixelRatio: 0.03 })
  })
})
