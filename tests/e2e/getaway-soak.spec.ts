import { expect, test, type Page } from '@playwright/test'
import { gotoGame } from './helpers'

/**
 * Robbery Pursuit & Getaway Polish v1 — long integration soak (§Testing). Runs
 * repeated CONTAINMENT cycles (arm → contain → breach forced-exit, and manual
 * early exits), routed-civilian reactions + recovery, and full Fast Exit runs,
 * all while the store-district sectors stream underneath and ambient traffic +
 * citizens keep simulating. Asserts the subsystem returns to baseline every
 * time: no page errors, containment stands down to 'none', civilians recover
 * home, no stale robbery/proceeds, bounded police + crimes + mission history.
 */

const SOAK_MS = 180_000
test.describe.configure({ timeout: SOAK_MS + 120_000 })

const STORE = { id: 'store_mainst', activity: 'robbery_mainst_store', cashier: [258.6, 202] as const, aim: [258.6, 205.5] as const, register: [258.6, 203] as const }

function heading(from: readonly [number, number], to: readonly [number, number]): number {
  return Math.atan2(to[0] - from[0], to[1] - from[1])
}

/** One containment cycle: duck into the store hot, let it escalate, then either
 *  ride the breach out or bail early. Returns the phase reached. */
async function containmentCycle(page: Page, rideBreach: boolean): Promise<void> {
  await page.evaluate((id) => {
    const api = window.GAME_TEST_API!
    api.enterInterior(id as string)
    api.setWantedLevel(2)
  }, STORE.id)
  // Escalate to at least 'contained'.
  await page
    .waitForFunction(() => window.GAME_TEST_API!.getContainmentState().phase === 'contained', undefined, {
      timeout: 16_000,
    })
    .catch(() => {})
  if (rideBreach) {
    // Let the warning → breach fire; the store forces us out to the street.
    await page
      .waitForFunction(() => window.GAME_TEST_API!.getActivityState().location === 'city', undefined, {
        timeout: 18_000,
      })
      .catch(() => {})
  } else {
    await page.evaluate(() => window.GAME_TEST_API!.exitInterior())
  }
  // Clear heat + reset so the next cycle starts clean; containment stands down.
  await page.evaluate(() => {
    const api = window.GAME_TEST_API!
    api.clearWanted()
    api.resetActivities()
  })
}

/** A full Fast Exit run stood in with the same event/steal path the E2E uses. */
async function fastExitRun(page: Page): Promise<void> {
  await page.evaluate(() => {
    const api = window.GAME_TEST_API!
    api.startMission('fast_exit')
    api.forceMissionEvent({ type: 'interactable_used', interactableId: 'hotcargo_fixer' })
    const target = api.getMissionTargetVehicle()
    if (target) api.stealVehicle(target)
    api.forceMissionEvent({ type: 'reached_zone', anchorId: 'fastexit_staging' })
    api.exitPlayerVehicle()
  })
  const h = heading(STORE.aim, STORE.cashier)
  await page.evaluate(
    ([x, z, hd]) => {
      const api = window.GAME_TEST_API!
      api.enterInterior('store_mainst')
      api.givePlayerWeapon('handgun')
      api.drawPlayerWeapon()
      api.teleportPlayer([x as number, 1.2, z as number])
      api.setPlayerHeading(hd as number)
    },
    [STORE.aim[0], STORE.aim[1], h] as const,
  )
  await page
    .waitForFunction(() => window.GAME_TEST_API!.getActivityState().activeId !== null, undefined, { timeout: 6000 })
    .catch(() => {})
  await page.evaluate(
    ([rx, rz]) => {
      const api = window.GAME_TEST_API!
      if (api.getActivityState().activeId) {
        api.teleportPlayer([rx as number, 1.2, (rz as number) + 0.8])
        api.lootStoreRegister()
      }
      const target = api.getMissionTargetVehicle()
      api.exitInterior()
      if (target) api.forceMissionEvent({ type: 'vehicle_entered', vehicleId: target })
      api.forceMissionEvent({ type: 'wanted_changed', previous: 2, current: 0 })
      api.clearWanted()
      api.holsterPlayerWeapon()
      api.secureRobberyProceeds()
      // Mission is repeatable but cooldown-gated; clear per-store cooldown too.
      api.resetActivities()
    },
    [STORE.register[0], STORE.register[1]] as const,
  )
}

test('getaway soak — containment + civilians + Fast Exit stay clean under streaming', { tag: '@simulation-only' }, async ({ page }) => {
  const errors: string[] = []
  page.on('pageerror', (e) => errors.push(e.message))
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text())
  })
  await gotoGame(page)
  await page.evaluate(() => {
    const api = window.GAME_TEST_API!
    api.resetGame()
    api.resetActivities()
    api.clearWanted()
    api.setTime(12)
  })
  await page.waitForTimeout(700)

  const started = Date.now()
  let cycles = 0
  while (Date.now() - started < SOAK_MS) {
    await containmentCycle(page, cycles % 2 === 0)
    // Every third loop, run a full Fast Exit through the getaway car.
    if (cycles % 3 === 2) await fastExitRun(page)
    // Cycle a store-district sector to prove streaming safety mid-loop.
    await page.evaluate(() => window.GAME_TEST_API!.forceUnloadSector('s1_-2'))
    await page.waitForTimeout(300)
    await page.evaluate(() => window.GAME_TEST_API!.forceLoadSector('s1_-2'))
    await page.waitForTimeout(300)
    cycles++
  }

  // Settle, then verify everything returned to baseline.
  await page.evaluate(() => {
    const api = window.GAME_TEST_API!
    api.exitInterior()
    api.clearWanted()
    api.resetActivities()
  })
  await page.waitForTimeout(1500)
  const final = await page.evaluate(() => {
    const api = window.GAME_TEST_API!
    return {
      state: api.getActivityState(),
      containment: api.getContainmentState(),
      civ: api.getInteriorCivilians('store_mainst'),
      validation: api.getActivityValidation(),
      missionValidation: api.getMissionValidation(),
      crimes: api.getCrimeEvents().length,
      police: api.getPoliceUnits().length,
      fastExitCompletions: api.getMissionHistory()['fast_exit']?.completions ?? 0,
    }
  })

  expect(errors).toEqual([])
  expect(final.state.activeId).toBeNull() // never stuck active
  expect(final.state.unsecuredProceeds).toBe(0) // no dangling proceeds
  expect(final.containment.phase).toBe('none') // containment stood down
  expect(final.containment.storeId).toBeNull()
  // Civilians recovered to (near) their homes and stood up.
  expect(final.civ!.every((c) => c.arrived && c.crouch < 0.1)).toBe(true)
  expect(final.validation).toEqual([]) // robbery defs still valid
  expect(final.missionValidation).toEqual([]) // mission defs still valid
  expect(final.crimes).toBeLessThanOrEqual(64) // bounded crime ring
  expect(final.police).toBeLessThanOrEqual(3)
  expect(cycles).toBeGreaterThan(0)
  console.log(`[GETAWAY SOAK] cycles=${cycles} fastExitCompletions=${final.fastExitCompletions}`)
})
