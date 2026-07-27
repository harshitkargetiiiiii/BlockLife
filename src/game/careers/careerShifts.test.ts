import { beforeEach, describe, expect, it } from 'vitest'
import { computeFailedPay, computePay, instantiateShiftObjectives, scorePerformance, shiftSkillAwards } from './careerShifts'
import { allCareers, getCareer, getRank } from './careerRegistry'
import { INTERACTABLE_BY_ID } from '../../data/interactables'
import {
  advanceShift,
  activeShiftReadyToFinalize,
  applyToCareer,
  cancelActiveShift,
  careerRuntime,
  failActiveShift,
  finalizeActiveShift,
  getActiveShift,
  getNextShift,
  getSkillXp,
  quitJob,
  resetCareers,
  startShift,
} from './careerRuntime'
import type { EligibilityContext } from './careerApplications'

const delivery = getCareer('delivery_driver')!
const ctx = (): EligibilityContext => ({ skills: careerRuntime.state.skills, reputation: 0, wanted: 0, activeJob: careerRuntime.state.activeJob, hasActiveShift: careerRuntime.state.activeShift !== null, hasRecommendation: () => false })

describe('shift templates + scoring (§5/§6)', () => {
  it('instantiates the four templates with a report step + one optional', () => {
    for (const id of ['delivery_driver', 'cafe_retail', 'gym_trainer', 'trade_worker'] as const) {
      const objs = instantiateShiftObjectives(getCareer(id)!)
      expect(objs[0].kind).toBe('report')
      expect(objs.filter((o) => o.optional)).toHaveLength(1)
      expect(objs.filter((o) => !o.optional).length).toBeGreaterThanOrEqual(3)
    }
  })

  it('every workplace + shift anchor is a REAL interactable (jobs exist in the world, §5)', () => {
    for (const career of allCareers()) {
      expect(INTERACTABLE_BY_ID[career.workplaceInteractableId], `workplace ${career.workplaceInteractableId}`).toBeDefined()
      for (const o of instantiateShiftObjectives(career)) {
        if (o.anchorId) expect(INTERACTABLE_BY_ID[o.anchorId], `anchor ${o.anchorId}`).toBeDefined()
      }
    }
  })

  it('scores a perfect on-time run near 100 and a late partial run lower', () => {
    const objs = instantiateShiftObjectives(delivery).map((o) => ({ ...o, done: true }))
    const perfect = scorePerformance(delivery, objs, true)
    expect(perfect.score).toBeGreaterThanOrEqual(95)
    const partial = instantiateShiftObjectives(delivery).map((o, i) => ({ ...o, done: i < 2 }))
    const weak = scorePerformance(delivery, partial, false)
    expect(weak.score).toBeLessThan(perfect.score)
  })

  it('the optional objective is EARNED by a flawless, on-time run — not a free button (F8)', () => {
    // Every required step done, optional left untouched (no manual "complete bonus").
    const done = instantiateShiftObjectives(delivery).map((o) => ({ ...o, done: !o.optional }))
    expect(scorePerformance(delivery, done, true).optionalDone).toBe(1) // clean + on time ⇒ earned
    expect(scorePerformance(delivery, done, false).optionalDone).toBe(0) // late ⇒ forfeited
    const withMistake = done.map((o, i) => (i === 1 ? { ...o, mistake: true } : o))
    expect(scorePerformance(delivery, withMistake, true).optionalDone).toBe(0) // a mistake forfeits it
    const incomplete = instantiateShiftObjectives(delivery).map((o, i) => ({ ...o, done: i < 2 }))
    expect(scorePerformance(delivery, incomplete, true).optionalDone).toBe(0) // unfinished ⇒ no bonus
  })

  it('pay = base × rank × performance, deterministic; failed pay is reduced', () => {
    const rank = getRank('delivery_driver', 'trainee')!
    const objs = instantiateShiftObjectives(delivery).map((o) => ({ ...o, done: true }))
    const perf = scorePerformance(delivery, objs, true)
    const pay = computePay(delivery, rank, perf)
    expect(pay.total).toBe(Math.round(delivery.basePay * rank.payModifier * pay.performanceModifier))
    expect(computeFailedPay(delivery, rank, objs).total).toBeLessThan(pay.total)
  })

  it('skill awards target the career affinities', () => {
    const objs = instantiateShiftObjectives(delivery).map((o) => ({ ...o, done: true }))
    const awards = shiftSkillAwards(delivery, scorePerformance(delivery, objs, true), true)
    expect(awards.some((a) => a.skill === 'driving')).toBe(true) // primary
    expect(awards.some((a) => a.skill === 'work_ethic')).toBe(true) // secondary + on-time
  })
})

describe('shift lifecycle — begin → step → finalize, exact-once (§4/§7)', () => {
  beforeEach(() => resetCareers())

  function hireAndStart(): string {
    applyToCareer('delivery_driver', ctx(), 2, 8)
    const shift = careerRuntime.state.scheduledShifts[0]
    expect(startShift(shift.id, true, 9)).toBe(true)
    return shift.id
  }

  it('runs a full shift: pay + XP applied once', () => {
    hireAndStart()
    // Advance through every required step.
    let guard = 0
    while (!activeShiftReadyToFinalize() && guard++ < 20) advanceShift()
    expect(activeShiftReadyToFinalize()).toBe(true)
    const before = getSkillXp('driving')
    const out = finalizeActiveShift(2, 13)!
    expect(out.pay.total).toBeGreaterThan(0)
    expect(out.performance.score).toBeGreaterThan(0)
    expect(getSkillXp('driving')).toBeGreaterThan(before) // XP funneled
    expect(getActiveShift()).toBeNull()
    expect(careerRuntime.state.history.delivery_driver!.completedShifts).toBe(1)
    // A next shift was scheduled so the loop continues.
    expect(careerRuntime.state.scheduledShifts.length).toBeGreaterThan(0)
  })

  it('a completed shift cannot be finalized twice for duplicate pay (§7/§13)', () => {
    hireAndStart()
    let guard = 0
    while (!activeShiftReadyToFinalize() && guard++ < 20) advanceShift()
    const first = finalizeActiveShift(2, 13)!
    expect(first.alreadyFinalized).toBe(false)
    const earned = careerRuntime.state.history.delivery_driver!.totalEarned
    const again = finalizeActiveShift(2, 13) // no active shift now → null
    expect(again).toBeNull()
    expect(careerRuntime.state.history.delivery_driver!.totalEarned).toBe(earned) // unchanged
  })

  it('a failed shift pays reduced and records a failure (no criminal record here)', () => {
    hireAndStart()
    advanceShift() // partial progress
    const out = failActiveShift('arrested', 2)!
    expect(out.alreadyFinalized).toBe(false)
    expect(getActiveShift()).toBeNull()
    expect(careerRuntime.state.history.delivery_driver!.failedShifts).toBe(1)
  })

  it('a cancelled shift pays nothing and dings standing', () => {
    hireAndStart()
    const standingBefore = careerRuntime.state.employerStanding.courier_dispatch
    cancelActiveShift()
    expect(getActiveShift()).toBeNull()
    expect(careerRuntime.state.employerStanding.courier_dispatch).toBeLessThan(standingBefore!)
  })

  it('a shift cannot start while unemployed — ownership requires an exact active job (§4, R3)', () => {
    applyToCareer('delivery_driver', ctx(), 2, 8)
    const shiftId = careerRuntime.state.scheduledShifts[0].id
    // Force-unemploy while the scheduled shift lingers: startShift must refuse it.
    careerRuntime.state = { ...careerRuntime.state, activeJob: null }
    expect(startShift(shiftId, true, 9)).toBe(false)
    expect(getActiveShift()).toBeNull()
  })

  it('cannot leave the job mid-shift (quit is refused while a shift is active) (§4, R3)', () => {
    hireAndStart()
    quitJob()
    expect(careerRuntime.state.activeJob).toBe('delivery_driver') // still employed
    expect(getActiveShift()).not.toBeNull() // the shift keeps running
  })

  it('starting a shift removes it from the scheduled queue (no active-status twin, F3)', () => {
    hireAndStart()
    // The one scheduled shift is now the activeShift; the scheduled queue holds no
    // 'active' twin (so a mid-shift save can never strand one).
    expect(careerRuntime.state.scheduledShifts.some((s) => s.status === 'active')).toBe(false)
    expect(getActiveShift()!.status).toBe('active')
  })

  it('a completed shift records a rich result for the phone results screen (F5)', () => {
    hireAndStart()
    let guard = 0
    while (!activeShiftReadyToFinalize() && guard++ < 20) advanceShift()
    finalizeActiveShift(2, 13)
    const results = careerRuntime.state.recentResults
    expect(results).toHaveLength(1)
    expect(results[0].reason).toBe('completed')
    expect(results[0].base).toBe(delivery.basePay)
    expect(results[0].pay).toBeGreaterThan(0)
  })

  it('every terminal outcome (complete/fail/cancel) records a result + schedules a next shift (F2)', () => {
    // Cancel path.
    hireAndStart()
    cancelActiveShift(2, 10)
    expect(getActiveShift()).toBeNull()
    expect(careerRuntime.state.recentResults.at(-1)!.reason).toBe('cancelled_by_player')
    expect(getNextShift()).toBeDefined() // loop continues
  })
})
