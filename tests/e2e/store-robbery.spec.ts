import { expect, test, type Page } from '@playwright/test'
import { gotoGame } from './helpers'

/**
 * Store Robbery & Criminal Activities v1 — live E2E. Robberies are driven
 * through the REAL gameplay path: draw the handgun, stand in range and aim at
 * the cashier for the sustained hold, then the register/secure interactions.
 * The vehicle-movement legs a headless test can't auto-drive (escape to the
 * fixer) are stood in with clearWanted + the secure interaction, which still go
 * through the engine's gates (wanted-0 + out-of-combat securing).
 */

// Interior geometry (from interiorRegistry / activityDefinitions).
const STORE = {
  id: 'store_mainst',
  activity: 'robbery_mainst_store',
  cashier: [258.6, 202] as const,
  register: [258.6, 203] as const,
  aimSpot: [258.6, 205.5] as const,
  shelfSpot: [262.5, 203.5] as const,
}
const KIOSK = {
  id: 'store_kiosk',
  activity: 'robbery_waterfront_kiosk',
  cashier: [205, 262.8] as const,
  register: [205, 263.6] as const,
  aimSpot: [205, 266] as const,
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

/** Enter a store, draw, and aim at its cashier from a spot; returns after settling. */
async function aimAtCashier(
  page: Page,
  store: typeof STORE | typeof KIOSK,
  spot: readonly [number, number],
): Promise<void> {
  const heading = headingToward(spot, store.cashier)
  await page.evaluate(
    ([interiorId, x, z, h]) => {
      const api = window.GAME_TEST_API!
      api.enterInterior(interiorId as string)
      api.givePlayerWeapon('handgun')
      api.drawPlayerWeapon()
      api.teleportPlayer([x as number, 1.2, z as number])
      api.setPlayerHeading(h as number)
    },
    [store.id, spot[0], spot[1], heading] as const,
  )
}

async function activity(page: Page) {
  return page.evaluate(() => window.GAME_TEST_API!.getActivityState())
}

test.describe('store robbery', { tag: '@simulation-only' }, () => {
  test('1 — convenience-store robbery end to end (threat → loot → secure)', async ({ page }) => {
    await fresh(page)
    const money0 = await page.evaluate(() => window.GAME_TEST_API!.getStats().money)
    await aimAtCashier(page, STORE, STORE.aimSpot)
    await page.waitForFunction(() => window.GAME_TEST_API!.getActivityState().activeId !== null, undefined, {
      timeout: 8000,
    })
    const threatened = await activity(page)
    expect(threatened.activeId).toBe(STORE.activity)
    expect(threatened.decision).toBe('comply')
    expect(threatened.phase).toBe('demanding')

    // Loot the register (deterministic take).
    const looted = await page.evaluate((reg) => {
      const api = window.GAME_TEST_API!
      api.teleportPlayer([reg[0], 1.2, reg[1] + 0.8])
      api.lootStoreRegister()
      return api.getActivityState()
    }, STORE.register)
    expect(looted.unsecuredProceeds).toBeGreaterThanOrEqual(120)
    expect(looted.unsecuredProceeds).toBeLessThanOrEqual(260)
    expect(looted.activeId).toBeNull() // robbery resolved; cash unsecured

    // Escape + secure at the fixer.
    const secured = await page.evaluate(() => {
      const api = window.GAME_TEST_API!
      api.exitInterior()
      api.clearWanted()
      api.holsterPlayerWeapon()
      api.secureRobberyProceeds()
      return { state: api.getActivityState(), money: api.getStats().money }
    })
    expect(secured.state.unsecuredProceeds).toBe(0)
    expect(secured.state.result?.outcome).toBe('secured')
    expect(Math.round(secured.money - money0)).toBe(looted.unsecuredProceeds)
  })

  test('2 — a holstered weapon never starts a robbery', async ({ page }) => {
    await fresh(page)
    await page.evaluate(
      ([id, x, z, h]) => {
        const api = window.GAME_TEST_API!
        api.enterInterior(id as string)
        api.givePlayerWeapon('handgun')
        api.holsterPlayerWeapon()
        api.teleportPlayer([x as number, 1.2, z as number])
        api.setPlayerHeading(h as number)
      },
      [STORE.id, STORE.aimSpot[0], STORE.aimSpot[1], headingToward(STORE.aimSpot, STORE.cashier)] as const,
    )
    await page.waitForTimeout(2500)
    expect((await activity(page)).activeId).toBeNull()
  })

  test('3 — aiming from outside the store never starts a robbery', async ({ page }) => {
    await fresh(page)
    // Draw + aim while still in the city (never entered the interior).
    await page.evaluate(() => {
      const api = window.GAME_TEST_API!
      api.givePlayerWeapon('handgun')
      api.drawPlayerWeapon()
      api.setPlayerHeading(0)
    })
    await page.waitForTimeout(2000)
    const s = await activity(page)
    expect(s.location).toBe('city')
    expect(s.activeId).toBeNull()
  })

  test('4 — blocked line of sight (behind a shelf) never starts a robbery', async ({ page }) => {
    await fresh(page)
    await aimAtCashier(page, STORE, STORE.shelfSpot)
    await page.waitForTimeout(2500)
    expect((await activity(page)).activeId).toBeNull()
  })

  test('5 — the register pays exactly once', async ({ page }) => {
    await fresh(page)
    await aimAtCashier(page, STORE, STORE.aimSpot)
    await page.waitForFunction(() => window.GAME_TEST_API!.getActivityState().activeId !== null, undefined, {
      timeout: 8000,
    })
    const amounts = await page.evaluate((reg) => {
      const api = window.GAME_TEST_API!
      api.teleportPlayer([reg[0], 1.2, reg[1] + 0.8])
      api.lootStoreRegister()
      const first = api.getActivityState().unsecuredProceeds
      api.lootStoreRegister() // repeat — must not duplicate
      api.lootStoreRegister()
      return { first, after: api.getActivityState().unsecuredProceeds }
    }, STORE.register)
    expect(amounts.after).toBe(amounts.first)
  })

  test('6 — arrest loses unsecured proceeds', async ({ page }) => {
    await fresh(page)
    await aimAtCashier(page, STORE, STORE.aimSpot)
    await page.waitForFunction(() => window.GAME_TEST_API!.getActivityState().activeId !== null, undefined, {
      timeout: 8000,
    })
    const res = await page.evaluate((reg) => {
      const api = window.GAME_TEST_API!
      api.teleportPlayer([reg[0], 1.2, reg[1] + 0.8])
      api.lootStoreRegister()
      const held = api.getActivityState().unsecuredProceeds
      api.respawnPlayer('arrest')
      return { held, after: api.getActivityState().unsecuredProceeds }
    }, STORE.register)
    expect(res.held).toBeGreaterThan(0)
    expect(res.after).toBe(0)
  })

  test('7 — a robbed store goes on cooldown (register stays empty)', async ({ page }) => {
    await fresh(page)
    await aimAtCashier(page, STORE, STORE.aimSpot)
    await page.waitForFunction(() => window.GAME_TEST_API!.getActivityState().activeId !== null, undefined, {
      timeout: 8000,
    })
    const state = await page.evaluate((reg) => {
      const api = window.GAME_TEST_API!
      api.teleportPlayer([reg[0], 1.2, reg[1] + 0.8])
      api.lootStoreRegister()
      const store = api.getStoreRobberyState('robbery_mainst_store')!
      // Re-aim: a fresh robbery must not begin (register emptied / cooldown).
      const started = api.forceBeginRobbery('robbery_mainst_store')
      return { store, started }
    }, STORE.register)
    expect(state.store.registerEmptied).toBe(true)
    expect(state.store.cooldownReadyAtGameHours).toBeGreaterThan(13)
    expect(state.started).toBe(false)
  })

  test('8 — the store interior is not a wanted-clear exploit', async ({ page }) => {
    await fresh(page)
    // Raise wanted in the city, then duck into the store: wanted must not decay.
    await page.evaluate(() => {
      const api = window.GAME_TEST_API!
      api.setWantedLevel(2)
      api.enterInterior('store_mainst')
    })
    const before = await page.evaluate(() => window.GAME_TEST_API!.getWantedState().level)
    await page.waitForTimeout(4000)
    const after = await page.evaluate(() => window.GAME_TEST_API!.getWantedState().level)
    expect(before).toBe(2)
    expect(after).toBe(2) // held — decay suppressed inside the store
  })

  test('9 — the Waterfront kiosk reuses the same framework', async ({ page }) => {
    await fresh(page)
    await aimAtCashier(page, KIOSK, KIOSK.aimSpot)
    await page.waitForFunction(() => window.GAME_TEST_API!.getActivityState().activeId !== null, undefined, {
      timeout: 8000,
    })
    const s = await activity(page)
    expect(s.activeId).toBe(KIOSK.activity)
    const looted = await page.evaluate((reg) => {
      const api = window.GAME_TEST_API!
      api.teleportPlayer([reg[0], 1.2, reg[1] + 0.8])
      api.lootStoreRegister()
      return api.getActivityState().unsecuredProceeds
    }, KIOSK.register)
    // Kiosk is a smaller payout ($40–$100).
    expect(looted).toBeGreaterThanOrEqual(40)
    expect(looted).toBeLessThanOrEqual(100)
  })

  test('10 — Corner Take wraps the robbery via observed events + pays a bonus', async ({ page }) => {
    await fresh(page)
    const money0 = await page.evaluate(() => window.GAME_TEST_API!.getStats().money)
    // Discover + accept Corner Take (fixer-unlocked phone job).
    const accepted = await page.evaluate(() => {
      const api = window.GAME_TEST_API!
      return api.startMission('corner_take')
    })
    expect(accepted).toBe(true)
    // Rob the marked store for the minimum.
    await aimAtCashier(page, STORE, STORE.aimSpot)
    await page.waitForFunction(() => window.GAME_TEST_API!.getActivityState().activeId !== null, undefined, {
      timeout: 8000,
    })
    const missionAfterLoot = await page.evaluate((reg) => {
      const api = window.GAME_TEST_API!
      api.teleportPlayer([reg[0], 1.2, reg[1] + 0.8])
      api.lootStoreRegister()
      return api.getMissionState().objectiveIndex
    }, STORE.register)
    expect(missionAfterLoot).toBe(1) // advanced to secure_proceeds
    // Secure → mission completes with the bonus.
    const done = await page.evaluate(() => {
      const api = window.GAME_TEST_API!
      api.exitInterior()
      api.clearWanted()
      api.holsterPlayerWeapon()
      api.secureRobberyProceeds()
      return { mission: api.getMissionState(), money: api.getStats().money }
    })
    expect(done.mission.activeMissionId).toBeNull()
    expect(done.mission.result?.outcome).toBe('completed')
    // Player got the register take + the $150 mission bonus.
    expect(done.money - money0).toBeGreaterThanOrEqual(120 + 150)
  })

  test('11 — saving is blocked while carrying unsecured proceeds', async ({ page }) => {
    await fresh(page)
    await aimAtCashier(page, STORE, STORE.aimSpot)
    await page.waitForFunction(() => window.GAME_TEST_API!.getActivityState().activeId !== null, undefined, {
      timeout: 8000,
    })
    const saved = await page.evaluate(async (reg) => {
      const api = window.GAME_TEST_API!
      api.teleportPlayer([reg[0], 1.2, reg[1] + 0.8])
      api.lootStoreRegister()
      api.exitInterior()
      api.clearWanted()
      return api.saveGame() // unsecured proceeds → refused
    }, STORE.register)
    expect(saved).toBe(false)
  })
})
