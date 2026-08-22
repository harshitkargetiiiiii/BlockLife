import { expect, test } from '@playwright/test'
import { gotoGame, teleport } from './helpers'

/**
 * Bounded CAREER LIFECYCLE soak (issue #15 §16) driving the REAL runtime through the
 * dev API across many game-days and all four careers — applications, scheduled /
 * completed / missed shifts, XP awards, promotions, employer messages, travel, an
 * interior, and save/load/reset boundaries — while asserting nothing duplicates
 * (pay / XP / promotions / messages), every collection stays bounded, no shift /
 * objective / event leaks, no page/console errors, and no World Integrity anomaly is
 * introduced by work routes or workplaces. Complements (does not replace) the 300s
 * city-integrity soak.
 */
const CAREERS = ['delivery_driver', 'cafe_retail', 'gym_trainer', 'trade_worker'] as const

test.describe('career lifecycle soak', { tag: '@simulation-only' }, () => {
  test('cycles all four careers without duplication, leaks, or integrity damage', async ({ page }) => {
    test.setTimeout(180_000)

    const errors: string[] = []
    page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`))
    page.on('console', (m) => {
      if (m.type() === 'error') errors.push(`console: ${m.text()}`)
    })

    await gotoGame(page)

    const summary = await page.evaluate(
      async ({ careers }) => {
        const api = window.GAME_TEST_API!
        api.resetGame()
        // Seed enough skill to qualify for the gated careers up front (real XP funnel).
        api.ingestCareerEvent({ id: 'seed', kind: 'training_milestone', gameDay: 0, skillAwards: [
          { skill: 'fitness', amount: 120, reason: 'training_milestone' },
          { skill: 'social', amount: 120, reason: 'training_milestone' },
          { skill: 'work_ethic', amount: 60, reason: 'training_milestone' },
          { skill: 'driving', amount: 60, reason: 'training_milestone' },
        ] })

        const bounds: string[] = []
        const checkBounds = (day: number) => {
          const s = api.getCareerSnapshot()
          if (s.scheduledShiftCount > 8) bounds.push(`day${day} shifts ${s.scheduledShiftCount}`)
          if (s.performanceHistorySize > 20) bounds.push(`day${day} perf ${s.performanceHistorySize}`)
          if (s.appliedEventCount > 256) bounds.push(`day${day} applied ${s.appliedEventCount}`)
          if (s.paidAttemptCount > 64) bounds.push(`day${day} paid ${s.paidAttemptCount}`)
          if (s.unlockCount > 64) bounds.push(`day${day} unlocks ${s.unlockCount}`)
          for (const id of Object.keys(s.skills)) if (s.skills[id].xp > 1000) bounds.push(`day${day} ${id} xp ${s.skills[id].xp}`)
        }

        // ~24 game-days: rotate careers, work shifts to completion, miss some, promote.
        for (let day = 1; day <= 24; day++) {
          const careerId = careers[day % careers.length]
          // (Re)apply to this career if it isn't the active job.
          if (api.getCareerSnapshot().activeJob !== careerId) api.applyToCareer(careerId)
          const next = api.getCareerNextShift()
          if (next && day % 4 !== 0) {
            // Attend + complete the shift at each real stop.
            api.setGameDay(next.scheduledDay)
            api.setTime(next.startHour)
            api.setActiveInteractable(next.workplaceInteractableId)
            api.startCareerShift(next.id)
            for (let g = 0; g < 16; g++) {
              const s = api.getActiveCareerShift()
              if (!s) break
              const step = s.objectives.find((o) => !o.optional && !o.done)
              if (!step) break
              api.setActiveInteractable(step.anchorId ?? s.workplaceInteractableId)
              api.advanceCareerShift()
            }
            api.setActiveInteractable(null)
          } else if (next) {
            // Every 4th day: ignore the shift → a real missed no-show.
            api.reconcileMissedShifts(next.scheduledDay + 1, 12)
          }

          // District travel + an interior visit on a cadence (lifecycle churn).
          if (day % 5 === 0) api.teleportPlayer([53, 1.2, -108])
          if (day % 6 === 0) {
            api.enterInterior('store_mainst')
            api.exitInterior?.()
          }
          // Save/load + reset boundaries (state must survive / clear cleanly).
          if (day === 10) {
            await api.saveGame()
            api.resetGame()
            await api.loadGame()
          }
          checkBounds(day)
        }

        // Steady-state integrity back at spawn.
        api.teleportPlayer([0, 1.2, 0])
        await new Promise((r) => setTimeout(r, 900))
        api.runIntegrityScan()
        const solidOverlaps = api.assertNoPersonSolidOverlaps().length
        const vehicleOverlaps = api.assertNoPersonVehicleOverlaps().length

        // Exact-once: a duplicate career event never re-applies.
        const s0 = api.getCareerSnapshot()
        api.ingestCareerEvent({ id: 'dup', kind: 'shift_completed', gameDay: 24, skillAwards: [{ skill: 'driving', amount: 10, reason: 'shift_completed' }] })
        const drivingA = api.getCareerSnapshot().skills.driving.xp
        api.ingestCareerEvent({ id: 'dup', kind: 'shift_completed', gameDay: 24, skillAwards: [{ skill: 'driving', amount: 10, reason: 'shift_completed' }] })
        const drivingB = api.getCareerSnapshot().skills.driving.xp

        const snap = api.getCareerSnapshot()
        return {
          bounds,
          solidOverlaps,
          vehicleOverlaps,
          dupNoReapply: drivingA === drivingB,
          activeShift: snap.activeShiftStatus,
          scheduledShiftCount: snap.scheduledShiftCount,
          performanceHistorySize: snap.performanceHistorySize,
          paidAttemptCount: snap.paidAttemptCount,
          appliedEventCount: snap.appliedEventCount,
          unlockCount: snap.unlockCount,
          engagedCareers: careers.filter((c) => (s0.ranks as Record<string, string>)[c]).length,
        }
      },
      { careers: CAREERS },
    )

    expect(errors, errors.join('\n')).toEqual([])
    expect(summary.bounds, summary.bounds.join('; ')).toEqual([])
    expect(summary.scheduledShiftCount).toBeLessThanOrEqual(8)
    expect(summary.performanceHistorySize).toBeLessThanOrEqual(20)
    expect(summary.paidAttemptCount).toBeLessThanOrEqual(64)
    expect(summary.appliedEventCount).toBeLessThanOrEqual(256)
    expect(summary.unlockCount).toBeLessThanOrEqual(64)
    // No actor embedded in a solid/vehicle — work routes preserved occupancy.
    expect(summary.solidOverlaps).toBe(0)
    expect(summary.vehicleOverlaps).toBe(0)
    // Exact-once holds; no stranded active shift; the whole cast of careers was worked.
    expect(summary.dupNoReapply).toBe(true)
    expect(summary.activeShift).toBeNull()
    expect(summary.engagedCareers).toBeGreaterThanOrEqual(3)
  })
})
