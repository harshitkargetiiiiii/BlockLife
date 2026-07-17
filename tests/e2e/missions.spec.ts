import { expect, test, type Page } from '@playwright/test'
import { gotoGame } from './helpers'

/**
 * Mission & Open-World Activity Framework v1 — end-to-end scenarios. City
 * Courier is driven through REAL gameplay (teleport to each objective, then the
 * live director completes reach-zones and a real `E` press completes the
 * pickup). Hot Cargo exercises the REAL crime stack (occupied carjack → witness
 * → wanted) and has the mission OBSERVE it; the vehicle-movement legs a headless
 * test can't auto-drive are simulated with typed mission events, which still go
 * through the engine's guards (wanted-0 delivery gating, exact-target matching).
 */

async function fresh(page: Page): Promise<void> {
  await gotoGame(page)
  await page.evaluate(() => {
    const api = window.GAME_TEST_API!
    api.resetGame()
    api.clearWanted()
    api.setTime(13)
  })
  // Let the home sector settle so the first teleport commits (not deferred).
  await page.waitForTimeout(700)
}

/**
 * Advance the active mission by one objective through real gameplay: teleport
 * to the objective, and for an INTERACT objective wait until it's the detected
 * interactable then press E; for a zone objective the live director completes
 * it on arrival. Polls for the actual outcome (robust to streaming/commit lag).
 */
async function goToObjective(page: Page, interactId?: string): Promise<void> {
  const before = await page.evaluate(() => window.GAME_TEST_API!.getMissionState().objectiveIndex)
  await page.evaluate(() => window.GAME_TEST_API!.teleportToMissionObjective())
  if (interactId) {
    await page.waitForFunction(
      (id) => window.GAME_TEST_API!.getStats().activeInteractableId === id,
      interactId,
      { timeout: 15_000 },
    )
    await page.keyboard.press('KeyE')
  }
  await page.waitForFunction(
    (b) => {
      const s = window.GAME_TEST_API!.getMissionState()
      return s.objectiveIndex > b || s.activeMissionId === null
    },
    before,
    { timeout: 15_000 },
  )
}

test.describe('missions & activities', () => {
  test('1 — mission definitions validate against the live world', async ({ page }) => {
    await fresh(page)
    const errs = await page.evaluate(() => window.GAME_TEST_API!.getMissionValidation())
    expect(errs).toEqual([])
  })

  test('2 — two missions are defined; Hot Cargo is locked until discovered', async ({ page }) => {
    await fresh(page)
    const res = await page.evaluate(() => {
      const api = window.GAME_TEST_API!
      return {
        defs: api.getMissionDefinitions().map((d) => d.id),
        courier: api.getMissionAvailability('city_courier'),
        hotBefore: api.getMissionAvailability('hot_cargo'),
      }
    })
    expect(res.defs).toEqual(['city_courier', 'hot_cargo'])
    expect(res.courier).toBe('available')
    expect(res.hotBefore).toBe('locked')
  })

  test('3 — City Courier completes end-to-end and pays exactly once', async ({ page }) => {
    await fresh(page)
    const money0 = await page.evaluate(() => window.GAME_TEST_API!.getStats().money)
    await page.evaluate(() => window.GAME_TEST_API!.startMission('city_courier'))
    // Objective 1: pickup (interact) — teleport to the depot and press E.
    await goToObjective(page, 'courier_depot')
    expect(await objIndex(page)).toBe(1)
    // Objectives 2–4: reach-zones — the director completes on arrival.
    await goToObjective(page)
    expect(await objIndex(page)).toBe(2)
    await goToObjective(page)
    expect(await objIndex(page)).toBe(3)
    await goToObjective(page)
    await page.waitForTimeout(400)
    const done = await page.evaluate(() => {
      const api = window.GAME_TEST_API!
      return {
        active: api.getMissionState().activeMissionId,
        result: api.getMissionState().result?.outcome ?? null,
        completions: api.getMissionHistory()['city_courier']?.completions ?? 0,
        earned: api.getMissionHistory()['city_courier']?.totalEarned ?? 0,
        cooldown: api.getMissionCooldownHours('city_courier'),
        money: api.getStats().money,
      }
    })
    expect(done.active).toBeNull()
    expect(done.result).toBe('completed')
    expect(done.completions).toBe(1)
    expect(done.earned).toBe(100)
    expect(done.cooldown).toBeGreaterThan(0)
    expect(Math.round(done.money - money0)).toBe(100)
  })

  test('4 — a delivered courier mission is on cooldown, not re-acceptable', async ({ page }) => {
    await fresh(page)
    await completeCourier(page)
    const res = await page.evaluate(() => {
      const api = window.GAME_TEST_API!
      return { avail: api.getMissionAvailability('city_courier'), started: api.startMission('city_courier') }
    })
    expect(res.avail).toBe('cooldown')
    expect(res.started).toBe(false)
  })

  test('5 — City Courier survives save/load mid-run and still completes', async ({ page }) => {
    await fresh(page)
    await page.evaluate(() => window.GAME_TEST_API!.startMission('city_courier'))
    await goToObjective(page, 'courier_depot') // pickup done → at drop_waterfront (idx 1)
    expect(await objIndex(page)).toBe(1)
    await page.evaluate(async () => {
      const api = window.GAME_TEST_API!
      await api.saveGame()
      api.resetGame() // wipes the runtime
      await api.loadGame()
    })
    await page.waitForTimeout(600)
    // Restored at the same objective, no reward yet.
    const restored = await page.evaluate(() => {
      const api = window.GAME_TEST_API!
      return { idx: api.getMissionState().objectiveIndex, active: api.getMissionState().activeMissionId }
    })
    expect(restored.active).toBe('city_courier')
    expect(restored.idx).toBe(1)
    // Finish the remaining drops from the restored state.
    await goToObjective(page)
    await goToObjective(page)
    await goToObjective(page)
    await page.waitForTimeout(400)
    expect(await page.evaluate(() => window.GAME_TEST_API!.getMissionHistory()['city_courier']?.completions ?? 0)).toBe(1)
  })

  test('6 — Hot Cargo: real theft raises wanted, delivery gated on losing it, pays once', async ({ page }) => {
    await fresh(page)
    const money0 = await page.evaluate(() => window.GAME_TEST_API!.getStats().money)
    const target = await page.evaluate(() => {
      const api = window.GAME_TEST_API!
      api.startMission('hot_cargo')
      return api.getMissionTargetVehicle()
    })
    expect(target).toBeTruthy()
    // Steal the marked vehicle through the REAL crime system.
    await page.evaluate((t) => window.GAME_TEST_API!.stealVehicle(t as string), target)
    await page.waitForTimeout(600)
    const afterTheft = await page.evaluate(() => {
      const api = window.GAME_TEST_API!
      return { idx: api.getMissionState().objectiveKind, wanted: api.getWantedState().level }
    })
    // The occupied carjack was reported → wanted is up, and the mission is now
    // at the lose_wanted objective (it did NOT set wanted itself).
    expect(afterTheft.wanted).toBeGreaterThan(0)
    expect(afterTheft.idx).toBe('lose_wanted')
    // Try to deliver while still wanted → rejected.
    await page.evaluate(() => window.GAME_TEST_API!.forceMissionEvent({ type: 'reached_zone', anchorId: 'hotcargo_garage' }))
    expect(await objKind(page)).toBe('lose_wanted')
    // Escape (clear wanted) → the director advances lose_wanted.
    await page.evaluate(() => window.GAME_TEST_API!.clearWanted())
    await page.waitForTimeout(500)
    expect(await objKind(page)).toBe('drive_vehicle_to_zone')
    // Deliver the car (drive-in leg is simulated) → exit → hand over.
    await page.evaluate(() => {
      const api = window.GAME_TEST_API!
      api.forceMissionEvent({ type: 'reached_zone', anchorId: 'hotcargo_garage' })
      api.forceMissionEvent({ type: 'vehicle_exited', vehicleId: api.getMissionTargetVehicle() ?? '' })
    })
    expect(await objKind(page)).toBe('deliver_vehicle')
    const before = await page.evaluate(() => window.GAME_TEST_API!.getMissionTargetVehicle())
    await page.evaluate(() => window.GAME_TEST_API!.forceMissionEvent({ type: 'interactable_used', interactableId: 'hotcargo_fixer' }))
    // Re-firing the handoff must not pay twice.
    await page.evaluate(() => window.GAME_TEST_API!.forceMissionEvent({ type: 'interactable_used', interactableId: 'hotcargo_fixer' }))
    await page.waitForTimeout(300)
    const done = await page.evaluate(() => {
      const api = window.GAME_TEST_API!
      return {
        active: api.getMissionState().activeMissionId,
        result: api.getMissionState().result?.outcome ?? null,
        earned: api.getMissionHistory()['hot_cargo']?.totalEarned ?? 0,
        cooldown: api.getMissionCooldownHours('hot_cargo'),
        money: api.getStats().money,
      }
    })
    expect(before).toBe(target)
    expect(done.active).toBeNull()
    expect(done.result).toBe('completed')
    expect(done.earned).toBe(280)
    expect(done.cooldown).toBeGreaterThan(0)
    expect(Math.round(done.money - money0)).toBe(280)
  })

  test('7 — stealing the WRONG vehicle does not advance Hot Cargo', async ({ page }) => {
    await fresh(page)
    const res = await page.evaluate(() => {
      const api = window.GAME_TEST_API!
      api.startMission('hot_cargo')
      const target = api.getMissionTargetVehicle()
      // Force the target to the plaza occupied car, then steal a DIFFERENT one.
      api.setMissionTargetVehicle('theft_occupied_plaza')
      const wrong = target === 'theft_occupied_market' ? 'theft_parked_plaza' : 'theft_occupied_market'
      api.forceMissionEvent({ type: 'vehicle_stolen', vehicleId: wrong, theftKind: 'vehicle_theft' })
      return { kind: api.getMissionState().objectiveKind }
    })
    expect(res.kind).toBe('steal_vehicle') // still on the boost objective
  })

  test('8 — arrest fails Hot Cargo; retry starts a clean new attempt', async ({ page }) => {
    await fresh(page)
    const res = await page.evaluate(() => {
      const api = window.GAME_TEST_API!
      api.startMission('hot_cargo')
      const attempt1 = api.getMissionState().attemptId
      api.forceMissionEvent({ type: 'player_arrested' })
      const afterFail = { active: api.getMissionState().activeMissionId, result: api.getMissionState().result }
      const retried = api.retryMission()
      return { attempt1, afterFail, attempt2: api.getMissionState().attemptId, retried }
    })
    expect(res.afterFail.active).toBeNull()
    expect(res.afterFail.result?.outcome).toBe('failed')
    expect(res.afterFail.result?.reason).toBe('player_arrested')
    expect(res.retried).toBe(true)
    expect(res.attempt2).not.toBe(res.attempt1)
    expect(res.attempt2).toBeTruthy()
  })

  test('9 — cancelling a mission cleans up with no reward and no wanted reset', async ({ page }) => {
    await fresh(page)
    const res = await page.evaluate(() => {
      const api = window.GAME_TEST_API!
      const money0 = api.getStats().money
      api.startMission('hot_cargo')
      const target = api.getMissionTargetVehicle()!
      api.stealVehicle(target)
      const wantedDuring = api.getWantedState().level
      api.cancelMission()
      return {
        active: api.getMissionState().activeMissionId,
        result: api.getMissionState().result?.outcome ?? null,
        wantedStill: api.getWantedState().level,
        wantedDuring,
        moneyDelta: api.getStats().money - money0,
      }
    })
    expect(res.active).toBeNull()
    expect(res.result).toBe('cancelled')
    expect(res.moneyDelta).toBe(0)
    // Cancelling does NOT wipe the crime the player already committed.
    expect(res.wantedStill).toBe(res.wantedDuring)
  })

  test('10 — Coffee for Ravi still works alongside the mission framework', async ({ page }) => {
    await fresh(page)
    const res = await page.evaluate(() => {
      const api = window.GAME_TEST_API!
      api.setQuestState('coffee_for_ravi', 'has_coffee')
      // A mission being active must not corrupt the quest state.
      api.startMission('hot_cargo')
      return { quest: api.getStats().questStates['coffee_for_ravi'] }
    })
    expect(res.quest).toBe('has_coffee')
  })

  test('11 — mission test API is dev-only (sanity: methods exist in dev)', async ({ page }) => {
    await fresh(page)
    const has = await page.evaluate(() => typeof window.GAME_TEST_API!.getMissionState === 'function')
    expect(has).toBe(true)
  })

  test('12 — an objective survives a destination sector unload/reload cycle', async ({ page }) => {
    await fresh(page)
    await page.evaluate(() => window.GAME_TEST_API!.startMission('city_courier'))
    await goToObjective(page, 'courier_depot') // → drop_waterfront (idx 1)
    const before = await objIndex(page)
    expect(before).toBe(1)
    // Cycle the Waterfront destination sector while the objective is pending.
    // Wait on the sector's REAL lifecycle, never a fixed sleep. Two reasons:
    // a hardcoded wait that expires early lets a slow unload silently skip the
    // cycle this test exists to prove (a false pass), and the remount gates the
    // teleport below — teleportCoordinator only commits once the destination
    // reports visuals AND colliders ready.
    // Measured on this machine (isolated): unload 0.9–7.3s (it must wait out an
    // in-flight prewarm load plus the 3s unloadDelayMs), remount→ready 1.5–4.9s.
    // The 20s budgets are ~3× the measured worst case, for full-suite load.
    // Measured on this machine, isolated ×16: unload 5.2s (it waits out an
    // in-flight prewarm load plus the 3s unloadDelayMs), remount→ready 4.0-4.4s.
    // 20s budgets are ~4× the measured worst case, to absorb full-suite load.
    await page.evaluate(() => window.GAME_TEST_API!.forceUnloadSector('s0_-2'))
    await page.waitForFunction(
      () => window.GAME_TEST_API!.getSectorState('s0_-2')?.lifecycle === 'unloaded',
      undefined,
      { timeout: 20_000 },
    )
    const during = await objIndex(page)
    await page.evaluate(() => window.GAME_TEST_API!.forceLoadSector('s0_-2'))
    await page.waitForFunction(
      () => {
        const s = window.GAME_TEST_API!.getSectorState('s0_-2')
        return (
          !!s &&
          s.visualsReady &&
          s.collidersReady &&
          (s.lifecycle === 'warm' || s.lifecycle === 'active' || s.lifecycle === 'cooling')
        )
      },
      undefined,
      { timeout: 20_000 },
    )
    // The objective never reset, double-completed, or lost identity…
    expect(during).toBe(before)
    expect(await objIndex(page)).toBe(before)
    const state = await page.evaluate(() => window.GAME_TEST_API!.getMissionState())
    expect(state.activeMissionId).toBe('city_courier')
    // …and it still completes normally afterwards.
    await goToObjective(page)
    expect(await objIndex(page)).toBe(2)
  })

  test('13 — saving is blocked during Hot Cargo but allowed during City Courier', async ({ page }) => {
    await fresh(page)
    const lawful = await page.evaluate(async () => {
      const api = window.GAME_TEST_API!
      api.startMission('city_courier')
      return api.saveGame()
    })
    expect(lawful).toBe(true)
    const criminal = await page.evaluate(async () => {
      const api = window.GAME_TEST_API!
      api.cancelMission()
      api.startMission('hot_cargo')
      return api.saveGame()
    })
    expect(criminal).toBe(false)
  })

  test('14 — entering the apartment during City Courier keeps the job alive', async ({ page }) => {
    await fresh(page)
    const res = await page.evaluate(() => {
      const api = window.GAME_TEST_API!
      api.startMission('city_courier')
      api.enterApartment()
      return {
        location: api.getLocationMode(),
        active: api.getMissionState().activeMissionId,
        objective: api.getMissionState().objectiveIndex,
      }
    })
    // Lawful work is not a pursuit, so home is allowed and the job persists.
    expect(res.location).toBe('apartment')
    expect(res.active).toBe('city_courier')
    expect(res.objective).toBe(0)
  })

  test('15 — a replacement stolen car cannot complete Hot Cargo (target lost)', async ({ page }) => {
    await fresh(page)
    const target = await page.evaluate(() => {
      const api = window.GAME_TEST_API!
      api.startMission('hot_cargo')
      return api.getMissionTargetVehicle()
    })
    expect(target).toBeTruthy()
    // Boost the REAL marked target through the crime stack.
    await page.evaluate((t) => window.GAME_TEST_API!.stealVehicle(t as string), target)
    await page.waitForTimeout(400)
    expect(await page.evaluate(() => window.GAME_TEST_API!.getMissionState().activeMissionId)).toBe('hot_cargo')
    // Abandon it and boost a DIFFERENT car — the assigned target is now lost.
    const outcome = await page.evaluate((t) => {
      const api = window.GAME_TEST_API!
      const all = ['theft_parked_plaza', 'theft_parked_market', 'theft_occupied_plaza', 'theft_occupied_market']
      const replacement = all.find((id) => id !== t)!
      api.stealVehicle(replacement)
      const s = api.getMissionState()
      return { active: s.activeMissionId, result: s.result }
    }, target)
    // The mission fails deterministically — a decoy can never be delivered.
    expect(outcome.active).toBeNull()
    expect(outcome.result?.outcome).toBe('failed')
    expect(outcome.result?.reason).toBe('target_vehicle_lost')
  })

  test('16 — save/load never duplicates a reward or reuses an attempt id', async ({ page }) => {
    await fresh(page)
    await completeCourier(page) // earns $100 as attempt city_courier#1
    const earnedBefore = await page.evaluate(
      () => window.GAME_TEST_API!.getMissionHistory()['city_courier']?.totalEarned ?? 0,
    )
    expect(earnedBefore).toBe(100)
    // Round-trip the post-completion state through the real save slot.
    await page.evaluate(async () => {
      await window.GAME_TEST_API!.saveGame()
      await window.GAME_TEST_API!.loadGame()
    })
    await page.waitForTimeout(400)
    const earnedAfter = await page.evaluate(
      () => window.GAME_TEST_API!.getMissionHistory()['city_courier']?.totalEarned ?? 0,
    )
    // Loading restored history but did NOT re-pay the completed attempt.
    expect(earnedAfter).toBe(100)
    // A fresh mission after the reload must NOT reuse attempt #1.
    const attemptId = await page.evaluate(() => {
      const api = window.GAME_TEST_API!
      api.setTime(23) // clear the 6h courier cooldown (it completed at 13:00)
      api.startMission('city_courier')
      return api.getMissionState().attemptId
    })
    expect(attemptId).not.toBe('city_courier#1')
    expect(attemptId).toMatch(/^city_courier#\d+$/)
  })
})

// --- helpers ---------------------------------------------------------------

async function objIndex(page: Page): Promise<number> {
  return page.evaluate(() => window.GAME_TEST_API!.getMissionState().objectiveIndex)
}
async function objKind(page: Page): Promise<string | null> {
  await page.waitForTimeout(150)
  return page.evaluate(() => window.GAME_TEST_API!.getMissionState().objectiveKind)
}
async function completeCourier(page: Page): Promise<void> {
  await page.evaluate(() => window.GAME_TEST_API!.startMission('city_courier'))
  await goToObjective(page, 'courier_depot')
  await goToObjective(page)
  await goToObjective(page)
  await goToObjective(page)
  await page.waitForTimeout(400)
}
