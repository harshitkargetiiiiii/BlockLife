import { expect, test } from '@playwright/test'
import { gotoGame, teleport } from './helpers'

/**
 * Social Life, Relationships & NPC Memory v1 (issue #13) — the twelve required
 * end-to-end scenarios (§15), each independently named + isolated so a failure
 * points at exactly one flow. Every test starts from a reset so state can't leak
 * between them.
 */
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
    const r = await page.evaluate(() => {
      const api = window.GAME_TEST_API!
      api.openDialogueWith('npc_ravi_01') // friendly after meeting → will ask a favor
      api.giveItem('snack', 1)
      const trust0 = api.getSocialRelationship('npc_ravi_01').trust
      api.startFavorFor('npc_ravi_01')
      api.advanceSocialActivity() // travel → deliver
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
      // A stranger refuses a favor request (relationship-gated refusal).
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
    expect(r.kimFavorNoTrustMem).toBe(true) // refused → no favor reward
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
    expect(r.a1).toBeGreaterThan(r.a0) // liked gift
    expect(r.a2).toBe(r.a1) // second gift the same day changed nothing
    expect(r.giftMems).toBe(1) // exactly one gift memory
  })

  test('5. a phone invitation → activity completes and persists', async ({ page }) => {
    const r = await page.evaluate(async () => {
      const api = window.GAME_TEST_API!
      api.openDialogueWith('npc_ravi_01')
      api.sendSocialInvite('npc_ravi_01', 'coffee')
      const inv = api.getSocialInvitations().find((i) => i.source === 'player' && i.status === 'accepted')
      const a0 = api.getSocialRelationship('npc_ravi_01').affinity
      if (inv) api.startSocialActivity(inv.id)
      api.advanceSocialActivity()
      api.advanceSocialActivity()
      await api.saveGame()
      api.resetGame()
      await api.loadGame()
      return { hadInvite: !!inv, a0, a1: api.getSocialRelationship('npc_ravi_01').affinity }
    })
    expect(r.hadInvite).toBe(true)
    expect(r.a1).toBeGreaterThan(r.a0)
  })

  test('6. missing an accepted invitation is a no-show consequence', async ({ page }) => {
    const r = await page.evaluate(() => {
      const api = window.GAME_TEST_API!
      api.openDialogueWith('npc_ravi_01')
      api.sendSocialInvite('npc_ravi_01', 'coffee')
      const inv = api.getSocialInvitations().find((i) => i.status === 'accepted')
      const t0 = api.getSocialRelationship('npc_ravi_01').trust
      if (inv) api.startSocialActivity(inv.id)
      api.cancelSocialActivity() // stood them up
      return {
        t0,
        t1: api.getSocialRelationship('npc_ravi_01').trust,
        noShow: api.getSocialMemories('npc_ravi_01').some((m) => m.kind === 'no_show'),
      }
    })
    expect(r.noShow).toBe(true)
    expect(r.t1).toBeLessThan(r.t0)
  })

  test('7. a crime witnessed by a named NPC hits fear/trust (real consequence)', async ({ page }) => {
    // Ensure the named NPCs are live in the registry, then drive the real
    // witness consequence at Officer Kim's world position (highest sensitivity).
    await teleport(page, [0, 1.2, 0])
    const r = await page.evaluate(() => {
      const api = window.GAME_TEST_API!
      api.openDialogueWith('npc_kim_01')
      const f0 = api.getSocialRelationship('npc_kim_01').fear
      const witnessed = api.devWitnessCrimeAt('npc_kim_01')
      return {
        witnessed,
        f1: api.getSocialRelationship('npc_kim_01').fear,
        f0,
        mem: api.getSocialMemories('npc_kim_01').some((m) => m.kind === 'crime_witnessed'),
      }
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
      api.performSocialAction('npc_ravi_01', 'gift', 'snack') // memory + affinity
      api.ingestSocialEvent({ id: 'seed', kind: 'conversation', actorId: 'npc_ravi_01', gameDay: 1, gameHour: 10 })
      api.reconcileSocialOutreach(5, 9) // message + invitation
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
      return {
        populated,
        contacts: api.getSocialContacts().length,
        raviAff: api.getSocialRelationship('npc_ravi_01').affinity,
        mems: api.getSocialMemories('npc_ravi_01').length,
      }
    })
    expect(r.populated).toBeGreaterThan(0)
    expect(r.contacts).toBe(0)
    expect(r.raviAff).toBe(25) // Ravi's canonical default affinity
    expect(r.mems).toBe(0)
  })

  test('10. Coffee for Ravi still completes and feeds the social system', async ({ page }) => {
    await page.evaluate(() => {
      const api = window.GAME_TEST_API!
      api.setQuestState('coffee_for_ravi', 'has_coffee')
      api.giveItem('coffee', 1)
      api.openDialogueWith('npc_ravi_01')
    })
    // Drive the REAL dialogue UI: hand Ravi the coffee.
    await expect(page.getByTestId('dialogue-panel')).toBeVisible()
    await page.click('[data-action-id="deliver_coffee"]')
    const r = await page.evaluate(() => {
      const api = window.GAME_TEST_API!
      return {
        quest: api.getStats().questStates['coffee_for_ravi'],
        socialMem: api.getSocialMemories('npc_ravi_01').some((m) => m.kind === 'gift_given'),
      }
    })
    expect(r.quest).toBe('completed')
    expect(r.socialMem).toBe(true) // legacy quest now nourishes the relationship
  })

  test('11. a cross-district activity preserves streaming + occupancy integrity', async ({ page }) => {
    await teleport(page, [53, 1.2, -108]) // jump to a far authored district
    // Let the teleport-respawned crowd settle (the capped separation nudge takes
    // ~1-2s), so the baseline reflects steady state, not a transient.
    await page.waitForTimeout(1600)
    const r = await page.evaluate(() => {
      const api = window.GAME_TEST_API!
      api.runIntegrityScan()
      const baseAnoms = api.getIntegrityAnomalies().length
      // Run a whole social activity here in the far district.
      api.openDialogueWith('npc_ravi_01')
      api.sendSocialInvite('npc_ravi_01', 'coffee')
      const inv = api.getSocialInvitations().find((i) => i.status === 'accepted')
      if (inv) api.startSocialActivity(inv.id)
      api.advanceSocialActivity()
      api.advanceSocialActivity()
      api.runIntegrityScan()
      const ring = api.getSafetyRing()
      return {
        baseAnoms,
        afterAnoms: api.getIntegrityAnomalies().length,
        solidOverlaps: api.assertNoPersonSolidOverlaps().length,
        ringCovered: ring ? ring.covered : true,
        activityDone: api.getActiveSocialActivity() === null,
      }
    })
    expect(r.activityDone).toBe(true)
    // The social activity introduced NO new anomalies + no embedded actors.
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
      return {
        firstApplied: first.applied,
        secondApplied: second.applied,
        trustSame: api.getSocialRelationship('npc_ravi_01').trust === t1,
        memsSame: api.getSocialMemories('npc_ravi_01').length === m1,
      }
    })
    expect(r.firstApplied).toBe(true)
    expect(r.secondApplied).toBe(false) // exact-once
    expect(r.trustSame).toBe(true)
    expect(r.memsSame).toBe(true)
  })
})
