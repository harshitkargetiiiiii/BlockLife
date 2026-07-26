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
})
