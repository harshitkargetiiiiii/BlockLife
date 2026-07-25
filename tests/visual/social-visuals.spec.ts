import { expect, test, type Page } from '@playwright/test'

/**
 * Social Life, Relationships & NPC Memory v1 visual baselines (issue #13 §15).
 * Deterministic: fixed time + clear weather, state driven through the dev API,
 * the world PAUSED before the shot. Every shot is scoped to the DOM panel (not
 * the 3D canvas) so it renders stably. Six required surfaces are covered.
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

test.describe('social visuals', () => {
  test('named NPC interaction menu', async ({ page }) => {
    await ready(page)
    await page.evaluate(() => {
      const api = window.GAME_TEST_API!
      api.giveItem('snack', 2) // giftable → the gift buttons render
      api.giveItem('meal', 1)
      api.openDialogueWith('npc_ravi_01') // friendly after meeting → full menu
    })
    await freeze(page)
    await expect(page.getByTestId('social-menu')).toBeVisible()
    await expect(page.getByTestId('dialogue-panel')).toHaveScreenshot('social-interaction-menu.png')
  })

  test('a disabled action shows a readable reason', async ({ page }) => {
    await ready(page)
    await page.evaluate(() => {
      const api = window.GAME_TEST_API!
      api.giveItem('snack', 2)
      api.openDialogueWith('npc_ravi_01')
      api.performSocialAction('npc_ravi_01', 'gift', 'snack') // now gifting is spent today
      api.performSocialAction('npc_ravi_01', 'check_in') // and check-in is spent today
    })
    await freeze(page)
    await expect(page.getByTestId('social-reason-gift')).toBeVisible()
    await expect(page.getByTestId('dialogue-panel')).toHaveScreenshot('social-refused-action.png')
  })

  test('phone Contacts list', async ({ page }) => {
    await ready(page)
    await page.evaluate(() => {
      const api = window.GAME_TEST_API!
      // A spread of relationship states across the cast.
      api.openDialogueWith('npc_ravi_01')
      api.openDialogueWith('npc_nisha_01')
      api.ingestSocialEvent({ id: 'v_leo', kind: 'favor_completed', actorId: 'npc_leo_01', gameDay: 1, gameHour: 12 })
      api.openTestPhoneApp('contacts')
    })
    await freeze(page)
    await expect(page.getByTestId('phone-contacts')).toBeVisible()
    await expect(page.getByTestId('phone')).toHaveScreenshot('phone-contacts.png')
  })

  test('contact card with relationship summary + plan', async ({ page }) => {
    await ready(page)
    await page.evaluate(() => {
      const api = window.GAME_TEST_API!
      api.openDialogueWith('npc_ravi_01')
      api.ingestSocialEvent({ id: 'g1', kind: 'gift_liked', actorId: 'npc_ravi_01', gameDay: 1, gameHour: 10 })
      api.ingestSocialEvent({ id: 'c', kind: 'conversation', actorId: 'npc_ravi_01', gameDay: 1, gameHour: 11 })
      api.reconcileSocialOutreach(4, 9) // Ravi proposes a coffee → an open plan on his card
      api.openTestPhoneApp('contacts')
    })
    await freeze(page)
    await expect(page.getByTestId('contact-plan-npc_ravi_01')).toBeVisible()
    await expect(page.getByTestId('phone')).toHaveScreenshot('phone-contact-detail.png')
  })

  test('phone invitation state', async ({ page }) => {
    await ready(page)
    await page.evaluate(() => {
      const api = window.GAME_TEST_API!
      api.openDialogueWith('npc_ravi_01')
      api.ingestSocialEvent({ id: 's', kind: 'conversation', actorId: 'npc_ravi_01', gameDay: 1, gameHour: 10 })
      api.reconcileSocialOutreach(5, 9) // incoming invitation (accept / later / decline)
      api.openTestPhoneApp('messages')
    })
    await freeze(page)
    await expect(page.getByTestId('phone-invitations')).toBeVisible()
    await expect(page.getByTestId('phone')).toHaveScreenshot('phone-invitation-state.png')
  })

  test('phone recent messages / conversations', async ({ page }) => {
    await ready(page)
    await page.evaluate(() => {
      const api = window.GAME_TEST_API!
      api.openDialogueWith('npc_ravi_01')
      // A completed hangout leaves a follow-up thank-you in the thread. The
      // destination gate needs the player AT the venue to complete it.
      api.sendSocialInvite('npc_ravi_01', 'coffee')
      const inv = api.getSocialInvitations().find((i) => i.status === 'accepted')
      if (inv) api.startSocialActivity(inv.id)
      api.setActiveInteractable('food_truck_01') // arrive at Maya's truck
      api.advanceSocialActivity()
      api.advanceSocialActivity()
      api.setActiveInteractable(null)
      api.openTestPhoneApp('messages')
    })
    await freeze(page)
    await expect(page.getByTestId('phone-threads')).toBeVisible()
    await expect(page.getByTestId('phone')).toHaveScreenshot('phone-messages.png')
  })

  test('phone confirmed plans (start a hangout)', async ({ page }) => {
    await ready(page)
    await page.evaluate(() => {
      const api = window.GAME_TEST_API!
      api.openDialogueWith('npc_ravi_01')
      api.sendSocialInvite('npc_ravi_01', 'coffee') // accepted → a confirmed plan
      api.openTestPhoneApp('messages')
    })
    await freeze(page)
    await expect(page.getByTestId('phone-plans')).toBeVisible()
    await expect(page.getByTestId('phone')).toHaveScreenshot('phone-confirmed-plans.png')
  })
})
