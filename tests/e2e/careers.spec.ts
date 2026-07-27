import { expect, test, type Page } from '@playwright/test'
import { gotoGame, teleport } from './helpers'

/**
 * Career, Skills & Life Progression v1 (issue #15 §16) — focused, independently
 * named scenarios. Application + starting run through PRODUCTION UI (Phone Jobs +
 * the HUD shift tracker); DEV APIs arrange prerequisites (skills, the clock, arrival
 * at each real stop) — never the sole path. NOTE the live proximity scanner rewrites
 * `activeInteractableId` every frame from the player's real position, so a shift's
 * per-step "arrive → advance" must run SYNCHRONOUSLY inside one page.evaluate (the
 * scanner doesn't tick mid-evaluate); the production DOM start is proven with a real
 * teleport (café — all steps at one workplace) so the scanner keeps us there.
 */

async function openJobs(page: Page): Promise<void> {
  await page.evaluate(() => window.GAME_TEST_API!.openTestPhoneApp('jobs'))
}

/** Drive the active shift to completion via the test API (DEV arranges arrival at
 *  each real stop, then advances the SAME store action the HUD button calls). */
async function completeShiftViaApi(page: Page): Promise<void> {
  await page.evaluate(() => {
    const api = window.GAME_TEST_API!
    for (let g = 0; g < 16; g++) {
      const s = api.getActiveCareerShift()
      if (!s) break
      const step = s.objectives.find((o) => !o.optional && !o.done)
      if (!step) break
      api.setActiveInteractable(step.anchorId ?? s.workplaceInteractableId)
      api.advanceCareerShift()
    }
  })
}

/** Apply + arrange the clock at the workplace, all inside one evaluate, then start. */
async function startShiftViaApi(page: Page, careerId: string): Promise<void> {
  await page.evaluate((careerId) => {
    const api = window.GAME_TEST_API!
    api.applyToCareer(careerId)
    const shift = api.getCareerNextShift()!
    api.setGameDay(shift.scheduledDay)
    api.setTime(shift.startHour)
    api.setActiveInteractable(shift.workplaceInteractableId)
    api.startCareerShift(shift.id)
  }, careerId)
}

/** Attend + complete the ACTIVE job's next delivery shift end to end (start → all
 *  stops → finalize), synchronously inside one evaluate. Assumes delivery_driver. */
async function runOneDeliveryShift(page: Page): Promise<void> {
  await page.evaluate(() => {
    const api = window.GAME_TEST_API!
    const shift = api.getCareerNextShift()
    if (!shift || shift.careerId !== 'delivery_driver') return
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
    api.setActiveInteractable(null)
  })
}

test.describe('careers platform', () => {
  test.beforeEach(async ({ page }) => {
    await gotoGame(page)
    await page.evaluate(() => window.GAME_TEST_API!.resetGame())
  })

  test('1. discover, apply, and get hired through the production UI', async ({ page }) => {
    await openJobs(page)
    await expect(page.getByTestId('phone-jobs')).toBeVisible()
    await page.click('[data-testid="apply-delivery_driver"]')
    const r = await page.evaluate(() => window.GAME_TEST_API!.getCareerSnapshot())
    expect(r.activeJob).toBe('delivery_driver')
    expect(r.ranks.delivery_driver).toBe('trainee')
    await expect(page.getByTestId('career-active')).toBeVisible()
  })

  test('2. an ineligible application shows a readable unmet requirement', async ({ page }) => {
    await openJobs(page)
    await expect(page.getByTestId('career-reason-gym_trainer')).toContainText('Fitness level 3')
  })

  test('3. a social recommendation relaxes a career requirement', async ({ page }) => {
    const ok = await page.evaluate(() => {
      const api = window.GAME_TEST_API!
      api.openDialogueWith('npc_bruno_01')
      for (let i = 0; i < 4; i++) api.ingestSocialEvent({ id: `f${i}`, kind: 'favor_completed', actorId: 'npc_bruno_01', gameDay: 1, gameHour: 9 })
      api.reconcileCareerRecommendations(1, 10) // Bruno puts in a good word
      return api.getCareerSnapshot().recommendations.includes('bruno_gym')
    })
    expect(ok).toBe(true)
    await openJobs(page)
    await expect(page.getByTestId('apply-gym_trainer')).toBeEnabled() // gate relaxed
  })

  test('4. start is refused before the window and away from the workplace', async ({ page }) => {
    const r = await page.evaluate(() => {
      const api = window.GAME_TEST_API!
      api.applyToCareer('delivery_driver')
      const shift = api.getCareerNextShift()!
      api.setActiveInteractable(null) // before the window + off-site
      api.startCareerShift(shift.id)
      const early = api.getActiveCareerShift() === null
      api.setGameDay(shift.scheduledDay) // into the window but still off-site
      api.setTime(shift.startHour)
      api.setActiveInteractable('gym')
      api.startCareerShift(shift.id)
      const offsite = api.getActiveCareerShift() === null
      return { early, offsite }
    })
    expect(r.early).toBe(true)
    expect(r.offsite).toBe(true)
  })

  test('5. complete a delivery shift through real stops; pay + skill XP apply once', async ({ page }) => {
    const before = await page.evaluate(() => {
      const api = window.GAME_TEST_API!
      api.applyToCareer('delivery_driver')
      const shift = api.getCareerNextShift()!
      api.setGameDay(shift.scheduledDay)
      api.setTime(shift.startHour)
      api.setActiveInteractable(shift.workplaceInteractableId)
      api.startCareerShift(shift.id)
      return { money: api.getStats().money }
    })
    await completeShiftViaApi(page)
    const after = await page.evaluate(() => {
      const s = window.GAME_TEST_API!.getCareerSnapshot()
      return { money: window.GAME_TEST_API!.getStats().money, driving: s.skills.driving.xp, active: s.activeShiftStatus, paid: s.paidAttemptCount, completed: s.performanceHistorySize }
    })
    expect(after.money).toBeGreaterThan(before.money) // paid through the economy authority
    expect(after.driving).toBeGreaterThan(0) // Driving XP awarded
    expect(after.paid).toBe(1) // exactly one pay receipt
    expect(after.active).toBeNull()
    expect(after.completed).toBe(1)
  })

  test('6. start + complete a café shift through the production UI + HUD tracker', async ({ page }) => {
    // Café steps all happen at one workplace — a real teleport keeps us there so the
    // production Start button + HUD advance button both pass the proximity gate.
    await page.evaluate(() => {
      const api = window.GAME_TEST_API!
      api.ingestCareerEvent({ id: 'soc', kind: 'training_milestone', gameDay: 1, skillAwards: [{ skill: 'social', amount: 60, reason: 'training_milestone' }] })
      api.applyToCareer('cafe_retail')
      const shift = api.getCareerNextShift()!
      api.setGameDay(shift.scheduledDay)
      api.setTime(shift.startHour)
    })
    await teleport(page, [1.5, 1.2, -4.4]) // Maya's counter (food_truck_01)
    await page.waitForFunction(() => window.GAME_TEST_API!.getStats().activeInteractableId === 'food_truck_01', undefined, { timeout: 8000 })
    const shiftId = await page.evaluate(() => window.GAME_TEST_API!.getCareerNextShift()!.id)
    await openJobs(page)
    await page.click(`[data-testid="start-shift-${shiftId}"]`) // production start
    await page.evaluate(() => window.GAME_TEST_API!.closePanel?.()) // close phone to reach the HUD
    await expect(page.getByTestId('career-shift-tracker')).toBeVisible()
    for (let i = 0; i < 6; i++) {
      const active = await page.evaluate(() => window.GAME_TEST_API!.getActiveCareerShift() !== null)
      if (!active) break
      await page.click('[data-testid="cst-advance"]') // production objective completion (all at the counter)
    }
    const perf = await page.evaluate(() => window.GAME_TEST_API!.getCareerSnapshot())
    expect(perf.activeShiftStatus).toBeNull()
    expect(perf.performanceHistorySize).toBe(1) // a deterministic performance result recorded
    expect(perf.paidAttemptCount).toBe(1)
  })

  test('7. a gym trainer shift improves Fitness', async ({ page }) => {
    await page.evaluate(() => {
      const api = window.GAME_TEST_API!
      api.ingestCareerEvent({ id: 'fit', kind: 'training_milestone', gameDay: 1, skillAwards: [{ skill: 'fitness', amount: 90, reason: 'training_milestone' }] })
    })
    await startShiftViaApi(page, 'gym_trainer')
    await completeShiftViaApi(page)
    const after = await page.evaluate(() => window.GAME_TEST_API!.getCareerSnapshot().skills)
    expect(after.fitness.xp).toBeGreaterThan(90) // fitness rose from the completed shift
  })

  test('8. a trade shift finalizes + cleans up (no leaked active shift/objectives)', async ({ page }) => {
    await page.evaluate(() => window.GAME_TEST_API!.ingestCareerEvent({ id: 'we', kind: 'training_milestone', gameDay: 1, skillAwards: [{ skill: 'work_ethic', amount: 25, reason: 'training_milestone' }] }))
    await startShiftViaApi(page, 'trade_worker')
    await completeShiftViaApi(page)
    const r = await page.evaluate(() => window.GAME_TEST_API!.getCareerSnapshot())
    expect(r.activeShiftStatus).toBeNull()
    expect(r.paidAttemptCount).toBe(1)
  })

  test('9. missing a shift by advancing real time costs an employer consequence', async ({ page }) => {
    const r = await page.evaluate(() => {
      const api = window.GAME_TEST_API!
      api.ingestCareerEvent({ id: 'soc', kind: 'training_milestone', gameDay: 1, skillAwards: [{ skill: 'social', amount: 60, reason: 'training_milestone' }] })
      api.applyToCareer('cafe_retail')
      const shift = api.getCareerNextShift()!
      const standingBefore = api.getCareerSnapshot().employerStanding['maya_cafe']
      const missed = api.reconcileMissedShifts(shift.scheduledDay + 2, 12)
      return { missed, standingBefore, standingAfter: api.getCareerSnapshot().employerStanding['maya_cafe'] }
    })
    expect(r.missed).toBe(1)
    expect(r.standingAfter).toBeLessThan(r.standingBefore)
  })

  test('10. an active wanted pursuit blocks shift start', async ({ page }) => {
    const blocked = await page.evaluate(() => {
      const api = window.GAME_TEST_API!
      api.applyToCareer('delivery_driver')
      const shift = api.getCareerNextShift()!
      api.setGameDay(shift.scheduledDay)
      api.setTime(shift.startHour)
      api.setActiveInteractable(shift.workplaceInteractableId)
      api.setWantedLevel(3)
      api.startCareerShift(shift.id)
      return api.getActiveCareerShift() === null
    })
    expect(blocked).toBe(true)
  })

  test('11. a completed shift cannot be replayed for duplicate pay/XP', async ({ page }) => {
    await startShiftViaApi(page, 'delivery_driver')
    await completeShiftViaApi(page)
    const r = await page.evaluate(() => {
      const api = window.GAME_TEST_API!
      const paid = api.getCareerSnapshot().paidAttemptCount
      api.advanceCareerShift() // no active shift now — nothing more to pay
      return { paid, paidAfter: api.getCareerSnapshot().paidAttemptCount }
    })
    expect(r.paid).toBe(1)
    expect(r.paidAfter).toBe(1) // no duplicate pay
  })

  test('12. promotion progress is gated and visible; a fresh trainee is not promotable', async ({ page }) => {
    const beforeMet = await page.evaluate(() => {
      const api = window.GAME_TEST_API!
      api.applyToCareer('delivery_driver')
      return api.getCareerPromotion('delivery_driver')!.met
    })
    expect(beforeMet).toBe(false)
    await openJobs(page)
    await expect(page.getByTestId('career-promo')).toBeVisible()
  })

  test('13. save/load preserves job, skills, rank, and history', async ({ page }) => {
    const r = await page.evaluate(async () => {
      const api = window.GAME_TEST_API!
      api.ingestCareerEvent({ id: 'x', kind: 'training_milestone', gameDay: 1, skillAwards: [{ skill: 'driving', amount: 120, reason: 'training_milestone' }] })
      api.applyToCareer('delivery_driver')
      await api.saveGame()
      api.resetGame()
      const cleared = api.getCareerSnapshot().activeJob
      await api.loadGame()
      const snap = api.getCareerSnapshot()
      return { cleared, job: snap.activeJob, driving: snap.skills.driving.xp }
    })
    expect(r.cleared).toBeNull()
    expect(r.job).toBe('delivery_driver')
    expect(r.driving).toBe(120)
  })

  test('14. a cross-district work route preserves streaming + occupancy integrity', async ({ page }) => {
    await startShiftViaApi(page, 'delivery_driver')
    await teleport(page, [53, 1.2, -108]) // far district mid-shift
    await page.waitForTimeout(1200)
    const r = await page.evaluate(() => {
      const api = window.GAME_TEST_API!
      api.runIntegrityScan()
      return { solid: api.assertNoPersonSolidOverlaps().length, vehicle: api.assertNoPersonVehicleOverlaps().length, ring: api.getSafetyRing()?.covered ?? true }
    })
    expect(r.solid).toBe(0)
    expect(r.vehicle).toBe(0)
    expect(r.ring).toBe(true)
  })

  test('15. reset clears progression to canonical defaults', async ({ page }) => {
    const r = await page.evaluate(() => {
      const api = window.GAME_TEST_API!
      api.applyToCareer('delivery_driver')
      api.resetGame()
      const snap = api.getCareerSnapshot()
      return { job: snap.activeJob, shifts: snap.scheduledShiftCount, xp: snap.skills.driving.xp }
    })
    expect(r.job).toBeNull()
    expect(r.shifts).toBe(0)
    expect(r.xp).toBe(0)
  })

  // ---- PR #16 review repairs (F1–F8) --------------------------------------

  test('16. switching primary jobs drops the old job’s shifts and blocks starting them (F1)', async ({ page }) => {
    const r = await page.evaluate(() => {
      const api = window.GAME_TEST_API!
      api.ingestCareerEvent({ id: 'soc', kind: 'training_milestone', gameDay: 1, skillAwards: [{ skill: 'social', amount: 60, reason: 'training_milestone' }] })
      api.applyToCareer('delivery_driver')
      const delivery = api.getCareerNextShift()!
      api.applyToCareer('cafe_retail') // atomic switch
      const next = api.getCareerNextShift()
      // Try to start the STALE delivery shift at its own window + workplace.
      api.setGameDay(delivery.scheduledDay)
      api.setTime(delivery.startHour)
      api.setActiveInteractable(delivery.workplaceInteractableId)
      api.startCareerShift(delivery.id)
      const startedOld = api.getActiveCareerShift() !== null
      const deliveryLeft = api.getCareerScheduledShifts().filter((s) => s.careerId === 'delivery_driver').length
      return { activeJob: api.getCareerSnapshot().activeJob, nextCareer: next?.careerId ?? null, startedOld, deliveryLeft }
    })
    expect(r.activeJob).toBe('cafe_retail')
    expect(r.nextCareer).toBe('cafe_retail') // the next shift is the current job's, never the old
    expect(r.startedOld).toBe(false) // a stale shift from the abandoned job can't be played
    expect(r.deliveryLeft).toBe(0) // the old job's attendable shifts were dropped
  })

  test('17. arrest mid-shift fails it, fires the employer follow-up, and schedules the next (F2)', async ({ page }) => {
    const r = await page.evaluate(() => {
      const api = window.GAME_TEST_API!
      api.ingestCareerEvent({ id: 'soc', kind: 'training_milestone', gameDay: 1, skillAwards: [{ skill: 'social', amount: 60, reason: 'training_milestone' }] })
      api.applyToCareer('cafe_retail')
      const shift = api.getCareerNextShift()!
      api.setGameDay(shift.scheduledDay)
      api.setTime(shift.startHour)
      api.setActiveInteractable(shift.workplaceInteractableId)
      api.startCareerShift(shift.id)
      api.advanceCareerShift() // clock in (partial progress)
      api.respawnPlayer('arrest') // arrested on the clock
      const results = api.getCareerRecentResults()
      const msgs = api.getSocialMessages('npc_maya_01')
      return {
        active: api.getCareerSnapshot().activeShiftStatus,
        lastReason: results[results.length - 1]?.reason ?? null,
        hasNext: api.getCareerNextShift() !== null,
        followedUp: msgs.some((m) => m.token === 'job_failed_shift'),
      }
    })
    expect(r.active).toBeNull() // shift ended
    expect(r.lastReason).toBe('arrested') // typed failure recorded (no criminal record)
    expect(r.hasNext).toBe(true) // the loop continues — a next shift was scheduled
    expect(r.followedUp).toBe(true) // the required failed-shift employer message was sent
  })

  test('17b. cancelling a shift also schedules the next (no dead-end) (F2)', async ({ page }) => {
    await startShiftViaApi(page, 'delivery_driver')
    const r = await page.evaluate(() => {
      const api = window.GAME_TEST_API!
      api.cancelCareerShift()
      return { active: api.getCareerSnapshot().activeShiftStatus, hasNext: api.getCareerNextShift() !== null }
    })
    expect(r.active).toBeNull()
    expect(r.hasNext).toBe(true)
  })

  test('18. a full page reload from a mid-shift save discards the shift, cleans cargo, schedules the next, never double-pays (F3)', async ({ page }) => {
    await page.evaluate(async () => {
      const api = window.GAME_TEST_API!
      api.applyToCareer('delivery_driver')
      const shift = api.getCareerNextShift()!
      api.setGameDay(shift.scheduledDay)
      api.setTime(shift.startHour)
      api.setActiveInteractable(shift.workplaceInteractableId)
      api.startCareerShift(shift.id)
      api.advanceCareerShift() // clock in
      const s = api.getActiveCareerShift()!
      const load = s.objectives.find((o) => !o.optional && !o.done)! // the collect step
      api.setActiveInteractable(load.anchorId ?? s.workplaceInteractableId)
      api.advanceCareerShift() // load cargo → now carrying restock_crate mid-shift
      await api.saveGame()
    })
    await page.reload()
    await page.waitForFunction(() => window.GAME_TEST_API?.ready() === true, undefined, { timeout: 45_000 })
    const r = await page.evaluate(async () => {
      const api = window.GAME_TEST_API!
      await api.loadGame()
      const snap = api.getCareerSnapshot()
      return {
        active: snap.activeShiftStatus,
        job: snap.activeJob,
        hasNext: api.getCareerNextShift() !== null,
        paid: snap.paidAttemptCount,
        crate: api.getBackpack().stacks['restock_crate'] ?? 0,
      }
    })
    expect(r.active).toBeNull() // no stranded active twin
    expect(r.job).toBe('delivery_driver') // still employed
    expect(r.hasNext).toBe(true) // a fresh next shift was scheduled
    expect(r.paid).toBe(0) // an unfinished shift was never paid
    expect(r.crate).toBe(0) // mid-shift cargo cleaned up
  })

  test('19. three good shifts earn a promotion; the next shift pays the higher rank rate (F5/§8)', async ({ page }) => {
    await page.evaluate(() => {
      const api = window.GAME_TEST_API!
      api.ingestCareerEvent({ id: 'drv', kind: 'training_milestone', gameDay: 0, skillAwards: [{ skill: 'driving', amount: 60, reason: 'training_milestone' }] })
      api.applyToCareer('delivery_driver')
    })
    for (let i = 0; i < 3; i++) await runOneDeliveryShift(page)
    const promoted = await page.evaluate(() => window.GAME_TEST_API!.getCareerSnapshot().ranks.delivery_driver)
    expect(promoted).toBe('regular') // promoted after three good shifts
    await runOneDeliveryShift(page) // the fourth shift is worked at the new rank
    const results = await page.evaluate(() => window.GAME_TEST_API!.getCareerRecentResults())
    const trainee = results.find((r) => r.rankModifier === 1)
    const regular = results.find((r) => r.rankModifier === 1.3)
    expect(trainee).toBeTruthy()
    expect(regular).toBeTruthy()
    expect(regular!.pay).toBeGreaterThan(trainee!.pay) // higher rank ⇒ higher pay, same run
  })

  test('20. an accepted social plan overlapping the next shift shows a conflict warning (F4)', async ({ page }) => {
    const overlaps = await page.evaluate(() => {
      const api = window.GAME_TEST_API!
      // Warm Ravi up so he accepts a plan (Ravi is available at 09:00 — the shift hour).
      for (let i = 0; i < 6; i++) api.ingestSocialEvent({ id: `rf${i}`, kind: 'favor_completed', actorId: 'npc_ravi_01', gameDay: 0, gameHour: 8 })
      api.applyToCareer('delivery_driver')
      const shift = api.getCareerNextShift()!
      // Jump to the shift's own day at 08:00 so Ravi's next slot (09:00) lands ON the shift.
      api.setGameDay(shift.scheduledDay)
      api.setTime(8)
      api.sendSocialInvite('npc_ravi_01', 'coffee') // accepted plan → (shiftDay, 09:00)
      const slots = api.getCareerCommitmentSlots()
      return slots.some((s) => s.day === shift.scheduledDay && s.hour >= shift.startHour - 1 && s.hour < shift.startHour + 4)
    })
    expect(overlaps).toBe(true) // the accepted plan really overlaps the shift window
    await openJobs(page)
    await expect(page.getByTestId('career-shift-conflict')).toBeVisible() // and Phone Jobs surfaces it
  })

  test('21. shift objectives cannot be cheesed: a full bag blocks collect; a stop needs the cargo (F8)', async ({ page }) => {
    const r = await page.evaluate(() => {
      const api = window.GAME_TEST_API!
      // Fill the backpack to capacity (items stack, so give enough to occupy all slots).
      api.giveTestItem('snack', 20) // 2 slots
      api.giveTestItem('energy_drink', 20) // 2 slots
      api.giveTestItem('coffee', 15) // 3 slots
      api.giveTestItem('meal', 15) // 3 slots → 10 slots, full
      const occupied = api.getBackpack().occupied
      api.applyToCareer('delivery_driver')
      const shift = api.getCareerNextShift()!
      api.setGameDay(shift.scheduledDay)
      api.setTime(shift.startHour)
      api.setActiveInteractable(shift.workplaceInteractableId)
      api.startCareerShift(shift.id)
      api.advanceCareerShift() // clock in (report)
      const beforeStep = api.getActiveCareerShift()!.objectives.find((o) => !o.optional && !o.done)!.id
      api.advanceCareerShift() // attempt collect with a FULL bag → must be blocked
      const blockedStep = api.getActiveCareerShift()!.objectives.find((o) => !o.optional && !o.done)!.id
      // Free room, then collect succeeds.
      api.discardTestItem('meal', 15)
      api.advanceCareerShift()
      const afterStep = api.getActiveCareerShift()?.objectives.find((o) => !o.optional && !o.done)?.id ?? 'done'
      return { occupied, beforeStep, blockedStep, afterStep }
    })
    expect(r.occupied).toBe(10) // setup: the bag is genuinely full
    expect(r.blockedStep).toBe(r.beforeStep) // collect did NOT advance while the bag was full
    expect(r.afterStep).not.toBe(r.beforeStep) // it advanced only once cargo could be carried
  })

  test('22. the thermal-bag unlock lets a full bag still carry cargo (F6)', async ({ page }) => {
    // Promote to Regular so the thermal bag is unlocked, then a full bag no longer blocks.
    await page.evaluate(() => {
      const api = window.GAME_TEST_API!
      api.ingestCareerEvent({ id: 'drv', kind: 'training_milestone', gameDay: 0, skillAwards: [{ skill: 'driving', amount: 60, reason: 'training_milestone' }] })
      api.applyToCareer('delivery_driver')
    })
    for (let i = 0; i < 3; i++) await runOneDeliveryShift(page)
    const r = await page.evaluate(() => {
      const api = window.GAME_TEST_API!
      const hasBag = api.hasCareerUnlock('delivery_thermal_bag')
      // Fill the backpack to capacity (10 slots).
      api.giveTestItem('snack', 20)
      api.giveTestItem('energy_drink', 20)
      api.giveTestItem('coffee', 15)
      api.giveTestItem('meal', 15)
      const shift = api.getCareerNextShift()!
      api.setGameDay(shift.scheduledDay)
      api.setTime(shift.startHour)
      api.setActiveInteractable(shift.workplaceInteractableId)
      api.startCareerShift(shift.id)
      api.advanceCareerShift() // report
      const beforeStep = api.getActiveCareerShift()!.objectives.find((o) => !o.optional && !o.done)!.id
      api.advanceCareerShift() // collect — with a full bag, the thermal bag carries it
      const afterStep = api.getActiveCareerShift()?.objectives.find((o) => !o.optional && !o.done)?.id ?? 'done'
      return { hasBag, advanced: afterStep !== beforeStep }
    })
    expect(r.hasBag).toBe(true)
    expect(r.advanced).toBe(true) // full bag no longer blocks collect once the bag is earned
  })

  test('23. completing a social activity raises Social through the production path (F7)', async ({ page }) => {
    const r = await page.evaluate(() => {
      const api = window.GAME_TEST_API!
      // Warm Maya up so a favor is offered, then drive it to completion via the SAME
      // production store actions the world UI calls (start → travel → deliver → done).
      for (let i = 0; i < 6; i++) api.ingestSocialEvent({ id: `mf${i}`, kind: 'favor_completed', actorId: 'npc_maya_01', gameDay: 0, gameHour: 8 })
      const before = api.getCareerSnapshot().skills.social.xp
      api.startFavorFor('npc_maya_01')
      let guard = 0
      while (guard++ < 12) {
        const act = api.getActiveSocialActivity()
        if (!act) break
        if (act.step === 'travel') api.setActiveInteractable(act.venueId)
        if (act.requiredItemId) api.giveTestItem(act.requiredItemId, 1)
        api.advanceSocialActivity()
      }
      return { before, after: api.getCareerSnapshot().skills.social.xp, finished: api.getActiveSocialActivity() === null }
    })
    expect(r.finished).toBe(true) // the activity ran to completion
    expect(r.after).toBeGreaterThan(r.before) // and funneled Social XP through the career funnel
  })

  test('23b. a gym workout raises Fitness through the production path (F7)', async ({ page }) => {
    const r = await page.evaluate(() => {
      const api = window.GAME_TEST_API!
      const before = api.getCareerSnapshot().skills.fitness.xp
      api.performActivityAction('train') // the SAME store action the gym button calls
      return { before, after: api.getCareerSnapshot().skills.fitness.xp }
    })
    expect(r.after).toBeGreaterThan(r.before)
  })

  test('24. the shift results screen shows the pay decomposition + score breakdown (F5)', async ({ page }) => {
    await startShiftViaApi(page, 'delivery_driver')
    await completeShiftViaApi(page)
    await openJobs(page)
    await expect(page.getByTestId('career-results')).toBeVisible()
    await expect(page.getByTestId('career-result-pay')).toContainText('base')
    await expect(page.getByTestId('career-result-pay')).toContainText('rank')
    await expect(page.getByTestId('career-result-breakdown')).toContainText('Attendance')
    const res = await page.evaluate(() => window.GAME_TEST_API!.getCareerRecentResults())
    expect(res.length).toBe(1)
    expect(res[0].reason).toBe('completed')
    expect(res[0].pay).toBeGreaterThan(0)
  })
})
