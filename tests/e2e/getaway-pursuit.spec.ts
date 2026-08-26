import { expect, test, type Page } from '@playwright/test'
import { gotoGame } from './helpers'

/**
 * Robbery Pursuit & Getaway Polish v1 — live E2E. Runs in Playwright (rAF stays
 * active, unlike the throttled preview), so the deterministic containment phase
 * machine, routed store civilians and the Fast Exit mission are exercised on
 * REAL frames. Vehicle-movement legs a headless test can't auto-drive are stood
 * in with the same typed-event / stealVehicle path Hot Cargo uses, which still
 * flow through the engine's exact-identity + wanted gates.
 */

const STORE = {
  id: 'store_mainst',
  activity: 'robbery_mainst_store',
  cashier: [258.6, 202] as const,
  register: [258.6, 203] as const,
  aimSpot: [258.6, 205.5] as const,
}

async function fresh(page: Page): Promise<void> {
  await gotoGame(page)
  await page.evaluate(() => {
    const api = window.GAME_TEST_API!
    api.resetGame()
    api.resetActivities()
    api.clearWanted()
    api.setTime(13)
  })
  await page.waitForTimeout(700)
}

function headingToward(from: readonly [number, number], to: readonly [number, number]): number {
  return Math.atan2(to[0] - from[0], to[1] - from[1])
}

/** Enter the store, draw, and hold a sustained aim on the cashier. */
async function aimAtCashier(page: Page): Promise<void> {
  const heading = headingToward(STORE.aimSpot, STORE.cashier)
  await page.evaluate(
    ([id, x, z, h]) => {
      const api = window.GAME_TEST_API!
      api.enterInterior(id as string)
      api.givePlayerWeapon('handgun')
      api.drawPlayerWeapon()
      api.teleportPlayer([x as number, 1.2, z as number])
      api.setPlayerHeading(h as number)
    },
    [STORE.id, STORE.aimSpot[0], STORE.aimSpot[1], heading] as const,
  )
}

test.describe('robbery pursuit & getaway', () => {
  test('1 — containment arms and advances while wanted inside a robbed store', { tag: '@simulation-only' }, async ({ page }) => {
    await fresh(page)
    await page.evaluate(() => {
      const api = window.GAME_TEST_API!
      api.enterInterior('store_mainst')
      api.setWantedLevel(2)
    })
    // Responding starts on the first frame with heat inside the store.
    await page.waitForFunction(
      () => window.GAME_TEST_API!.getContainmentState().phase === 'responding',
      undefined,
      { timeout: 6000 },
    )
    // With no responder on scene, the fallback timer contains after ~6s.
    await page.waitForFunction(
      () => window.GAME_TEST_API!.getContainmentState().phase === 'contained',
      undefined,
      { timeout: 12_000 },
    )
    const c = await page.evaluate(() => window.GAME_TEST_API!.getContainmentState())
    expect(c.storeId).toBe('robbery_mainst_store')
  })

  test('2 — a fair breach warning fires, then forces the player out to the street', { tag: '@simulation-only' }, async ({ page }) => {
    await fresh(page)
    await page.evaluate(() => {
      const api = window.GAME_TEST_API!
      api.enterInterior('store_mainst')
      api.setWantedLevel(2)
    })
    // Warning phase must appear BEFORE the breach (readable, not instant).
    await page.waitForFunction(
      () => window.GAME_TEST_API!.getContainmentState().phase === 'warning',
      undefined,
      { timeout: 20_000 },
    )
    const warn = await page.evaluate(() => window.GAME_TEST_API!.getContainmentState())
    expect(warn.breachSeconds).not.toBeNull()
    expect(warn.breachSeconds!).toBeGreaterThan(0)
    // The breach then ejects the player into the contained street.
    await page.waitForFunction(
      () => window.GAME_TEST_API!.getActivityState().location === 'city',
      undefined,
      { timeout: 12_000 },
    )
    const after = await page.evaluate(() => window.GAME_TEST_API!.getContainmentState())
    expect(after.phase).toBe('none') // stood down once outside
  })

  test('3 — store civilians route/react (freeze crouches, flee flees) — no floor sink', async ({ page }) => {
    await fresh(page)
    await aimAtCashier(page)
    await page.waitForFunction(() => window.GAME_TEST_API!.getActivityState().activeId !== null, undefined, {
      timeout: 8000,
    })
    // Give the routed civilians a moment to react to the live threat.
    await page.waitForTimeout(1800)
    const civ = await page.evaluate(() => window.GAME_TEST_API!.getInteriorCivilians('store_mainst'))
    expect(civ).not.toBeNull()
    const freezers = civ!.filter((c) => c.reaction === 'freeze')
    const fleers = civ!.filter((c) => c.reaction === 'flee')
    // A freeze civilian crouches (hands up) in place — a reaction, not a floor sink.
    expect(Math.max(...freezers.map((f) => f.crouch))).toBeGreaterThan(0.3)
    // The bolting customer heads for the door (south, +z, past its home post).
    expect(Math.max(...fleers.map((f) => f.pos[1]))).toBeGreaterThan(207)
  })

  test('4 — a fled civilian raises the alarm even at the no-alarm kiosk (report after safety)', async ({ page }) => {
    await fresh(page)
    // Kiosk alarm policy is "none": only an organic witness can report.
    const heading = Math.atan2(205 - 205, 262.8 - 266)
    await page.evaluate(
      ([h]) => {
        const api = window.GAME_TEST_API!
        api.enterInterior('store_kiosk')
        api.givePlayerWeapon('handgun')
        api.drawPlayerWeapon()
        api.teleportPlayer([205, 1.2, 266])
        api.setPlayerHeading(h as number)
      },
      [heading] as const,
    )
    await page.waitForFunction(() => window.GAME_TEST_API!.getActivityState().activeId !== null, undefined, {
      timeout: 8000,
    })
    // A fleeing/hiding customer reaches safety and the alarm fires (wanted rises).
    await page.waitForFunction(() => window.GAME_TEST_API!.getWantedState().level > 0, undefined, {
      timeout: 12_000,
    })
    expect(await page.evaluate(() => window.GAME_TEST_API!.getActivityState().alarmFired)).toBe(true)
  })

  test('5 — Fast Exit runs end to end and pays the bonus once', async ({ page }) => {
    await fresh(page)
    const money0 = await page.evaluate(() => window.GAME_TEST_API!.getStats().money)
    await page.evaluate(() => window.GAME_TEST_API!.startMission('fast_exit'))
    // brief → getaway
    await page.evaluate(() =>
      window.GAME_TEST_API!.forceMissionEvent({ type: 'interactable_used', interactableId: 'hotcargo_fixer' }),
    )
    expect(await page.evaluate(() => window.GAME_TEST_API!.getMissionState().objectiveKind)).toBe('steal_vehicle')
    // getaway: the selector prefers a PARKED car; boosting the exact target advances.
    const target = await page.evaluate(() => window.GAME_TEST_API!.getMissionTargetVehicle())
    expect(target).toBeTruthy()
    await page.evaluate((t) => window.GAME_TEST_API!.stealVehicle(t as string), target)
    expect(await page.evaluate(() => window.GAME_TEST_API!.getMissionState().objectiveKind)).toBe('drive_vehicle_to_zone')
    // stage (requireClean:false — a still-hot car can be staged)
    await page.evaluate(() =>
      window.GAME_TEST_API!.forceMissionEvent({ type: 'reached_zone', anchorId: 'fastexit_staging' }),
    )
    expect(await page.evaluate(() => window.GAME_TEST_API!.getMissionState().objectiveKind)).toBe('rob_store')
    // Out of the staged getaway car and into the store on foot.
    await page.evaluate(() => window.GAME_TEST_API!.exitPlayerVehicle())
    // rob the marked store for >= the minimum (real robbery path)
    await aimAtCashier(page)
    await page.waitForFunction(() => window.GAME_TEST_API!.getActivityState().activeId !== null, undefined, {
      timeout: 8000,
    })
    await page.evaluate((reg) => {
      const api = window.GAME_TEST_API!
      api.teleportPlayer([reg[0], 1.2, reg[1] + 0.8])
      api.lootStoreRegister()
    }, STORE.register)
    expect(await page.evaluate(() => window.GAME_TEST_API!.getMissionState().objectiveKind)).toBe('enter_vehicle')
    // to_getaway → lose_heat → secure
    const done = await page.evaluate((t) => {
      const api = window.GAME_TEST_API!
      api.exitInterior()
      api.forceMissionEvent({ type: 'vehicle_entered', vehicleId: t as string }) // exact getaway car
      api.forceMissionEvent({ type: 'wanted_changed', previous: 2, current: 0 })
      api.clearWanted()
      api.holsterPlayerWeapon()
      api.secureRobberyProceeds()
      return { mission: api.getMissionState(), money: api.getStats().money }
    }, target)
    expect(done.mission.activeMissionId).toBeNull()
    expect(done.mission.result?.outcome).toBe('completed')
    // Register take (≥$120) + the $250 Fast Exit bonus.
    expect(done.money - money0).toBeGreaterThanOrEqual(120 + 250)
    expect(await page.evaluate(() => window.GAME_TEST_API!.getMissionHistory()['fast_exit']?.completions ?? 0)).toBe(1)
  })

  test('6 — only the EXACT getaway car satisfies the re-entry leg', async ({ page }) => {
    await fresh(page)
    await page.evaluate(() => {
      const api = window.GAME_TEST_API!
      api.startMission('fast_exit')
      api.forceMissionEvent({ type: 'interactable_used', interactableId: 'hotcargo_fixer' })
    })
    const target = await page.evaluate(() => window.GAME_TEST_API!.getMissionTargetVehicle())
    await page.evaluate((t) => window.GAME_TEST_API!.stealVehicle(t as string), target)
    await page.evaluate(() =>
      window.GAME_TEST_API!.forceMissionEvent({ type: 'reached_zone', anchorId: 'fastexit_staging' }),
    )
    // Out of the staged car, then rob to reach the enter_vehicle leg.
    await page.evaluate(() => window.GAME_TEST_API!.exitPlayerVehicle())
    await aimAtCashier(page)
    await page.waitForFunction(() => window.GAME_TEST_API!.getActivityState().activeId !== null, undefined, {
      timeout: 8000,
    })
    await page.evaluate((reg) => {
      const api = window.GAME_TEST_API!
      api.teleportPlayer([reg[0], 1.2, reg[1] + 0.8])
      api.lootStoreRegister()
    }, STORE.register)
    const at = await page.evaluate(() => window.GAME_TEST_API!.getMissionState().objectiveKind)
    expect(at).toBe('enter_vehicle')
    // A WRONG car does not advance; the exact target does.
    const wrong = await page.evaluate(
      (t) => {
        const api = window.GAME_TEST_API!
        const other = ['theft_parked_plaza', 'theft_parked_market', 'theft_occupied_plaza', 'theft_occupied_market'].find(
          (v) => v !== t,
        )!
        api.forceMissionEvent({ type: 'vehicle_entered', vehicleId: other })
        return api.getMissionState().objectiveKind
      },
      target,
    )
    expect(wrong).toBe('enter_vehicle') // unchanged
    const right = await page.evaluate((t) => {
      const api = window.GAME_TEST_API!
      api.forceMissionEvent({ type: 'vehicle_entered', vehicleId: t as string })
      return api.getMissionState().objectiveKind
    }, target)
    expect(right).toBe('lose_wanted') // advanced
  })

  test('7 — saving is blocked while contained inside a robbed store', async ({ page }) => {
    await fresh(page)
    const saved = await page.evaluate(async () => {
      const api = window.GAME_TEST_API!
      api.enterInterior('store_mainst')
      api.setWantedLevel(2) // pursuit + containment
      return api.saveGame()
    })
    expect(saved).toBe(false)
  })

  test('8 — the getaway target is a validly-parked, non-owned civilian car', async ({ page }) => {
    await fresh(page)
    await page.evaluate(() => {
      const api = window.GAME_TEST_API!
      api.startMission('fast_exit')
      api.forceMissionEvent({ type: 'interactable_used', interactableId: 'hotcargo_fixer' })
    })
    const info = await page.evaluate(() => {
      const api = window.GAME_TEST_API!
      const target = api.getMissionTargetVehicle()!
      return { target, crime: api.getVehicleCrimeState(target) }
    })
    expect(info.target).toMatch(/^theft_parked_/) // preferParked selected a parked car
    expect(info.crime.stolen).toBe(false) // not yet taken when assigned
    expect(info.crime.disabled).toBe(false)
  })
})
