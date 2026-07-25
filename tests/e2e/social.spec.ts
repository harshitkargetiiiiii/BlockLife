import { expect, test, type Page } from '@playwright/test'
import { gotoGame, teleport } from './helpers'

/**
 * Social Life, Relationships & NPC Memory v1 (issue #13) + PR#14 lifecycle
 * hardening — the required end-to-end scenarios, each independently named +
 * isolated. Every test starts from a reset.
 */

/** Walk up to Maya's food truck so the proximity scanner marks us "arrived". */
async function arriveAtFoodTruck(page: Page): Promise<void> {
  await teleport(page, [1.5, 1.2, -4.4])
  await page.waitForFunction(() => window.GAME_TEST_API!.getStats().activeInteractableId === 'food_truck_01', undefined, {
    timeout: 8000,
  })
}

test.describe('social platform', () => {
  test.beforeEach(async ({ page }) => {
    await gotoGame(page)
    await page.evaluate(() => window.GAME_TEST_API!.resetGame())
  })

  test('1. first meeting unlocks a contact and it persists', async ({ page }) => {
    const r = await page.evaluate(async () => {
      const api = window.GAME_TEST_API!
      api.openDialogueWith('npc_ravi_01')
      const unlocked = api.getSocialContacts().includes('npc_ravi_01')
      await api.saveGame()
      api.resetGame()
      const afterReset = api.getSocialContacts().includes('npc_ravi_01')
      await api.loadGame()
      return { unlocked, afterReset, afterLoad: api.getSocialContacts().includes('npc_ravi_01') }
    })
    expect(r.unlocked).toBe(true)
    expect(r.afterReset).toBe(false)
    expect(r.afterLoad).toBe(true)
  })

  test('2. a completed favor writes memory, trust, a follow-up message', async ({ page }) => {
    // The favor errand venue is the apartment — arrive there first.
    await teleport(page, [-12.5, 1.2, -9])
    await page.waitForFunction(() => window.GAME_TEST_API!.getStats().activeInteractableId === 'apartment', undefined, { timeout: 8000 })
    const r = await page.evaluate(() => {
      const api = window.GAME_TEST_API!
      api.openDialogueWith('npc_ravi_01')
      api.giveItem('snack', 1)
      const trust0 = api.getSocialRelationship('npc_ravi_01').trust
      api.startFavorFor('npc_ravi_01')
      api.advanceSocialActivity() // travel (at venue) → deliver
      api.advanceSocialActivity() // deliver (consumes snack)
      api.advanceSocialActivity() // together → done
      return {
        trust0,
        trust1: api.getSocialRelationship('npc_ravi_01').trust,
        favorMem: api.getSocialMemories('npc_ravi_01').some((m) => m.kind === 'favor_completed'),
        followUp: api.getSocialMessages('npc_ravi_01').some((m) => m.dir === 'in' && m.token === 'followup_favor'),
        activeCleared: api.getActiveSocialActivity() === null,
      }
    })
    expect(r.favorMem).toBe(true)
    expect(r.trust1).toBeGreaterThan(r.trust0)
    expect(r.followUp).toBe(true)
    expect(r.activeCleared).toBe(true)
  })

  test('3. an abandoned favor is a no-show (negative memory) + low tiers are refused', async ({ page }) => {
    const r = await page.evaluate(() => {
      const api = window.GAME_TEST_API!
      api.openDialogueWith('npc_ravi_01')
      api.giveItem('snack', 1)
      const trust0 = api.getSocialRelationship('npc_ravi_01').trust
      api.startFavorFor('npc_ravi_01')
      api.cancelSocialActivity() // bail → no_show
      api.openDialogueWith('npc_kim_01')
      const kimMenu = api.getSocialMenu('npc_kim_01')
      api.performSocialAction('npc_kim_01', 'ask_favor')
      return {
        noShowMem: api.getSocialMemories('npc_ravi_01').some((m) => m.kind === 'no_show'),
        trustDropped: api.getSocialRelationship('npc_ravi_01').trust < trust0,
        noShowMsg: api.getSocialMessages('npc_ravi_01').some((m) => m.token === 'followup_noshow'),
        kimFavorNoTrustMem: !api.getSocialMemories('npc_kim_01').some((m) => m.kind === 'favor_completed'),
        kimHadFavorAction: kimMenu!.actions.some((a) => a.id === 'ask_favor'),
      }
    })
    expect(r.noShowMem).toBe(true)
    expect(r.trustDropped).toBe(true)
    expect(r.noShowMsg).toBe(true)
    expect(r.kimHadFavorAction).toBe(true)
    expect(r.kimFavorNoTrustMem).toBe(true)
  })

  test('4. a preferred gift lifts affinity; a repeat same-day gift is anti-farmed', async ({ page }) => {
    const r = await page.evaluate(() => {
      const api = window.GAME_TEST_API!
      api.openDialogueWith('npc_ravi_01')
      api.giveItem('snack', 3)
      const a0 = api.getSocialRelationship('npc_ravi_01').affinity
      api.performSocialAction('npc_ravi_01', 'gift', 'snack')
      const a1 = api.getSocialRelationship('npc_ravi_01').affinity
      api.performSocialAction('npc_ravi_01', 'gift', 'snack') // blocked same day
      const a2 = api.getSocialRelationship('npc_ravi_01').affinity
      const giftMems = api.getSocialMemories('npc_ravi_01').filter((m) => m.kind === 'gift_given').length
      return { a0, a1, a2, giftMems }
    })
    expect(r.a1).toBeGreaterThan(r.a0)
    expect(r.a2).toBe(r.a1)
    expect(r.giftMems).toBe(1)
  })

  test('5. a phone invitation → activity completes at the venue and persists', async ({ page }) => {
    await arriveAtFoodTruck(page)
    const r = await page.evaluate(async () => {
      const api = window.GAME_TEST_API!
      api.openDialogueWith('npc_ravi_01')
      api.sendSocialInvite('npc_ravi_01', 'coffee')
      const inv = api.getSocialInvitations().find((i) => i.source === 'player' && i.status === 'accepted')
      // A coffee invite proposes the next hour, so the plan is already inside its
      // start window (opens 1h before) — start it straight away, no clock advance.
      const a0 = api.getSocialRelationship('npc_ravi_01').affinity
      if (inv) api.startSocialActivity(inv.id)
      api.advanceSocialActivity() // travel (at truck) → together
      api.advanceSocialActivity() // together → done
      const invAfter = api.getSocialInvitations().find((i) => i.id === inv?.id)
      await api.saveGame()
      api.resetGame()
      await api.loadGame()
      return { hadInvite: !!inv, a0, a1: api.getSocialRelationship('npc_ravi_01').affinity, invStatus: invAfter?.status }
    })
    expect(r.hadInvite).toBe(true)
    expect(r.invStatus).toBe('completed') // linked invitation resolved
    expect(r.a1).toBeGreaterThan(r.a0)
  })

  test('6. an accepted invitation ignored past its window becomes a no-show (real clock)', async ({ page }) => {
    const r = await page.evaluate(() => {
      const api = window.GAME_TEST_API!
      api.openDialogueWith('npc_ravi_01')
      api.sendSocialInvite('npc_ravi_01', 'coffee')
      const inv = api.getSocialInvitations().find((i) => i.status === 'accepted')!
      const t0 = api.getSocialRelationship('npc_ravi_01').trust
      // Never start it; let the clock roll two days past the appointment.
      const missed = api.reconcileMissedInvitations(inv.proposedDay + 2, 12)
      const invAfter = api.getSocialInvitations().find((i) => i.id === inv.id)!
      return {
        missed,
        status: invAfter.status,
        t1: api.getSocialRelationship('npc_ravi_01').trust,
        t0,
        noShow: api.getSocialMemories('npc_ravi_01').some((m) => m.kind === 'no_show'),
        idempotent: api.reconcileMissedInvitations(inv.proposedDay + 3, 12), // already missed
      }
    })
    expect(r.missed).toBe(1)
    expect(r.status).toBe('missed')
    expect(r.noShow).toBe(true)
    expect(r.t1).toBeLessThan(r.t0)
    expect(r.idempotent).toBe(0)
  })

  test('7. a crime witnessed by a named NPC hits fear/trust (real consequence)', async ({ page }) => {
    await teleport(page, [0, 1.2, 0])
    const r = await page.evaluate(() => {
      const api = window.GAME_TEST_API!
      api.openDialogueWith('npc_kim_01')
      const f0 = api.getSocialRelationship('npc_kim_01').fear
      const witnessed = api.devWitnessCrimeAt('npc_kim_01')
      return { witnessed, f1: api.getSocialRelationship('npc_kim_01').fear, f0, mem: api.getSocialMemories('npc_kim_01').some((m) => m.kind === 'crime_witnessed') }
    })
    expect(r.witnessed).toBe(true)
    expect(r.f1).toBeGreaterThan(r.f0)
    expect(r.mem).toBe(true)
  })

  test('8. save/load preserves relationships, memories, contacts, messages, invitations', async ({ page }) => {
    const r = await page.evaluate(async () => {
      const api = window.GAME_TEST_API!
      api.openDialogueWith('npc_ravi_01')
      api.giveItem('snack', 1)
      api.performSocialAction('npc_ravi_01', 'gift', 'snack')
      api.ingestSocialEvent({ id: 'seed', kind: 'conversation', actorId: 'npc_ravi_01', gameDay: 1, gameHour: 10 })
      api.reconcileSocialOutreach(5, 9)
      const before = {
        aff: api.getSocialRelationship('npc_ravi_01').affinity,
        mems: api.getSocialMemories('npc_ravi_01').length,
        msgs: api.getSocialMessages('npc_ravi_01').length,
        invs: api.getSocialInvitations().length,
        contacts: api.getSocialContacts().length,
      }
      await api.saveGame()
      api.resetGame()
      const wiped = api.getSocialMemories('npc_ravi_01').length
      await api.loadGame()
      return {
        before,
        wiped,
        after: {
          aff: api.getSocialRelationship('npc_ravi_01').affinity,
          mems: api.getSocialMemories('npc_ravi_01').length,
          msgs: api.getSocialMessages('npc_ravi_01').length,
          invs: api.getSocialInvitations().length,
          contacts: api.getSocialContacts().length,
        },
      }
    })
    expect(r.wiped).toBe(0)
    expect(r.after).toEqual(r.before)
    expect(r.before.msgs).toBeGreaterThan(0)
    expect(r.before.invs).toBeGreaterThan(0)
  })

  test('9. reset clears social state to canonical defaults', async ({ page }) => {
    const r = await page.evaluate(() => {
      const api = window.GAME_TEST_API!
      api.openDialogueWith('npc_ravi_01')
      api.openDialogueWith('npc_maya_01')
      api.ingestSocialEvent({ id: 'g', kind: 'gift_liked', actorId: 'npc_ravi_01', gameDay: 1 })
      const populated = api.getSocialContacts().length
      api.resetGame()
      return { populated, contacts: api.getSocialContacts().length, raviAff: api.getSocialRelationship('npc_ravi_01').affinity, mems: api.getSocialMemories('npc_ravi_01').length }
    })
    expect(r.populated).toBeGreaterThan(0)
    expect(r.contacts).toBe(0)
    expect(r.raviAff).toBe(25)
    expect(r.mems).toBe(0)
  })

  test('10. Coffee for Ravi still completes and feeds the social system', async ({ page }) => {
    await page.evaluate(() => {
      const api = window.GAME_TEST_API!
      api.setQuestState('coffee_for_ravi', 'has_coffee')
      api.giveItem('coffee', 1)
      api.openDialogueWith('npc_ravi_01')
    })
    await expect(page.getByTestId('dialogue-panel')).toBeVisible()
    await page.click('[data-action-id="deliver_coffee"]')
    const r = await page.evaluate(() => {
      const api = window.GAME_TEST_API!
      return { quest: api.getStats().questStates['coffee_for_ravi'], socialMem: api.getSocialMemories('npc_ravi_01').some((m) => m.kind === 'gift_given') }
    })
    expect(r.quest).toBe('completed')
    expect(r.socialMem).toBe(true)
  })

  test('11. an activity crossing districts to the venue preserves streaming + occupancy', async ({ page }) => {
    // Accept a coffee plan, journey to a far district, then travel BACK to the
    // real venue (the food truck) to complete it — proving the trip is clean.
    await page.evaluate(() => {
      const api = window.GAME_TEST_API!
      api.openDialogueWith('npc_ravi_01')
      api.sendSocialInvite('npc_ravi_01', 'coffee')
      const inv = api.getSocialInvitations().find((i) => i.status === 'accepted')
      // The coffee plan is proposed for the next hour → already inside its window.
      if (inv) api.startSocialActivity(inv.id)
    })
    await teleport(page, [53, 1.2, -108]) // far district (activity can't complete here)
    const blocked = await page.evaluate(() => {
      const api = window.GAME_TEST_API!
      api.advanceSocialActivity() // out of range → no-op
      return api.getActiveSocialActivity()?.step
    })
    expect(blocked).toBe('travel') // destination gating held during the journey
    await arriveAtFoodTruck(page) // travel to the actual venue
    await page.waitForTimeout(1200) // let the crowd settle before the scan
    const r = await page.evaluate(() => {
      const api = window.GAME_TEST_API!
      api.runIntegrityScan()
      const baseAnoms = api.getIntegrityAnomalies().length
      api.advanceSocialActivity() // now at the venue → travel → together
      api.advanceSocialActivity() // together → done
      api.runIntegrityScan()
      const ring = api.getSafetyRing()
      return {
        activityDone: api.getActiveSocialActivity() === null,
        afterAnoms: api.getIntegrityAnomalies().length,
        baseAnoms,
        solidOverlaps: api.assertNoPersonSolidOverlaps().length,
        ringCovered: ring ? ring.covered : true,
      }
    })
    expect(r.activityDone).toBe(true)
    expect(r.afterAnoms).toBeLessThanOrEqual(r.baseAnoms)
    expect(r.solidOverlaps).toBe(0)
    expect(r.ringCovered).toBe(true)
  })

  test('12. repeated event delivery never duplicates rewards, memories, or deltas', async ({ page }) => {
    const r = await page.evaluate(() => {
      const api = window.GAME_TEST_API!
      api.openDialogueWith('npc_ravi_01')
      const first = api.ingestSocialEvent({ id: 'dup', kind: 'favor_completed', actorId: 'npc_ravi_01', gameDay: 2, gameHour: 9 })
      const t1 = api.getSocialRelationship('npc_ravi_01').trust
      const m1 = api.getSocialMemories('npc_ravi_01').length
      const second = api.ingestSocialEvent({ id: 'dup', kind: 'favor_completed', actorId: 'npc_ravi_01', gameDay: 2, gameHour: 9 })
      return { firstApplied: first.applied, secondApplied: second.applied, trustSame: api.getSocialRelationship('npc_ravi_01').trust === t1, memsSame: api.getSocialMemories('npc_ravi_01').length === m1 }
    })
    expect(r.firstApplied).toBe(true)
    expect(r.secondApplied).toBe(false)
    expect(r.trustSame).toBe(true)
    expect(r.memsSame).toBe(true)
  })

  test('13. accept + start + complete an invitation entirely through the production UI', async ({ page }) => {
    await arriveAtFoodTruck(page)
    // Set up an INCOMING coffee invitation proposed for a FUTURE day (the clock is
    // still day 1). The accept/start/complete below are all real DOM clicks — no
    // GAME_TEST_API.respondToInvitation / startSocialActivity on the happy path.
    const plan = await page.evaluate(() => {
      const api = window.GAME_TEST_API!
      api.ingestSocialEvent({ id: 'met:npc_ravi_01', kind: 'met', actorId: 'npc_ravi_01', gameDay: 1, gameHour: 10 })
      api.ingestSocialEvent({ id: 'seed', kind: 'conversation', actorId: 'npc_ravi_01', gameDay: 1, gameHour: 10 })
      api.reconcileSocialOutreach(5, 9) // Ravi proposes a plan several days out
      api.openTestPhoneApp('messages')
      const inv = api.getSocialInvitations().find((i) => i.source === 'npc' && i.status === 'pending')!
      return { id: inv.id, day: inv.proposedDay, hour: inv.proposedHour }
    })
    // Accept via the phone button → the plan is now confirmed.
    await page.click(`[data-testid="invite-accept-${plan.id}"]`)
    await expect(page.getByTestId('phone-plans')).toBeVisible()
    // BEFORE its window: production UI refuses to start it — the Start button is
    // disabled with a readable reason, and the store revalidates too (not only the UI).
    await expect(page.getByTestId(`plan-start-${plan.id}`)).toBeDisabled()
    await expect(page.getByTestId(`plan-reason-${plan.id}`)).toBeVisible()
    const refusedEarly = await page.evaluate((id) => {
      const api = window.GAME_TEST_API!
      api.startSocialActivity(id) // revalidated in the store action, not just the disabled button
      return api.getActiveSocialActivity() === null
    }, plan.id)
    expect(refusedEarly).toBe(true)
    // Advance the REAL game clock into the plan's window → Start becomes available.
    await page.evaluate(({ day, hour }) => {
      const api = window.GAME_TEST_API!
      api.setGameDay(day)
      api.setTime(hour)
    }, plan)
    await expect(page.getByTestId(`plan-start-${plan.id}`)).toBeEnabled()
    await page.click(`[data-testid="plan-start-${plan.id}"]`)
    // Complete via the HUD tracker buttons (we're already at the food truck).
    await expect(page.getByTestId('social-activity-tracker')).toBeVisible()
    await page.click('[data-testid="sat-continue"]') // travel → together
    await page.click('[data-testid="sat-continue"]') // together → done
    const r = await page.evaluate(() => {
      const api = window.GAME_TEST_API!
      return { active: api.getActiveSocialActivity(), status: api.getSocialInvitations().find((i) => i.status === 'completed') ? 'completed' : 'other', mem: api.getSocialMemories('npc_ravi_01').some((m) => m.summaryToken === 'hung_out') }
    })
    expect(r.active).toBeNull()
    expect(r.status).toBe('completed')
    expect(r.mem).toBe(true)
  })

  test('14. a completed invitation cannot be restarted through the production path', async ({ page }) => {
    await arriveAtFoodTruck(page)
    const r = await page.evaluate(() => {
      const api = window.GAME_TEST_API!
      api.openDialogueWith('npc_ravi_01')
      api.sendSocialInvite('npc_ravi_01', 'coffee')
      const inv = api.getSocialInvitations().find((i) => i.status === 'accepted')!
      api.startSocialActivity(inv.id) // proposed next hour → already inside its window
      api.advanceSocialActivity()
      api.advanceSocialActivity() // completed
      // No confirmed plan remains, and trying to restart it does nothing.
      const confirmedIds = api.getSocialConfirmedPlans().map((p) => p.id)
      api.startSocialActivity(inv.id) // refused (invitation is completed)
      return { completedGone: !confirmedIds.includes(inv.id), noActivity: api.getActiveSocialActivity() === null }
    })
    expect(r.completedGone).toBe(true)
    expect(r.noActivity).toBe(true)
  })

  test('15. a full page reload preserves messages without minting duplicate ids', async ({ page }) => {
    // Build messages + save, then RELOAD the page (resets the module) and load.
    const invId = await page.evaluate(async () => {
      const api = window.GAME_TEST_API!
      api.ingestSocialEvent({ id: 'met:npc_ravi_01', kind: 'met', actorId: 'npc_ravi_01', gameDay: 1, gameHour: 10 })
      api.sendSocialInvite('npc_ravi_01', 2, 10) // posts several messages
      await api.saveGame()
      return api.getSocialMessages('npc_ravi_01')[0]?.id ?? ''
    })
    expect(invId).not.toBe('')
    await page.reload()
    await page.waitForFunction(() => window.GAME_TEST_API?.ready() === true, undefined, { timeout: 45_000 })
    const r = await page.evaluate(async () => {
      const api = window.GAME_TEST_API!
      await api.loadGame()
      const loadedIds = api.getSocialMessages('npc_ravi_01').map((m) => m.id)
      // A new message after the reload must not collide with a loaded id.
      api.sendSocialInvite('npc_ravi_01', 3, 10)
      const allIds = api.getSocialMessages('npc_ravi_01').map((m) => m.id)
      return { loadedCount: loadedIds.length, unique: new Set(allIds).size === allIds.length }
    })
    expect(r.loadedCount).toBeGreaterThan(0)
    expect(r.unique).toBe(true) // no duplicate message ids across the reload boundary
  })
})
