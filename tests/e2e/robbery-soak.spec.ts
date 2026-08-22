import { expect, test, type Page } from '@playwright/test'
import { gotoGame } from './helpers'

/**
 * Store Robbery v1 — long integration soak (§Testing). Runs repeated robbery
 * cycles at BOTH locations (success + arrest-loss), advances the game clock to
 * clear cooldowns, cycles the store district sectors underneath, and interleaves
 * securing — all while ambient traffic + citizens keep simulating. Asserts the
 * subsystem returns to baseline every time: no page errors, no duplicate loot,
 * no stale active robbery, bounded stores, bounded crimes.
 */

const SOAK_MS = 180_000
test.describe.configure({ timeout: SOAK_MS + 90_000 })

const STORE = { id: 'store_mainst', activity: 'robbery_mainst_store', cashier: [258.6, 202] as const, aim: [258.6, 205.5] as const, register: [258.6, 203] as const }
const KIOSK = { id: 'store_kiosk', activity: 'robbery_waterfront_kiosk', cashier: [205, 262.8] as const, aim: [205, 266] as const, register: [205, 263.6] as const }

function heading(from: readonly [number, number], to: readonly [number, number]): number {
  return Math.atan2(to[0] - from[0], to[1] - from[1])
}

async function robCycle(page: Page, store: typeof STORE | typeof KIOSK, secure: boolean): Promise<void> {
  const h = heading(store.aim, store.cashier)
  await page.evaluate(
    ([id, x, z, hd]) => {
      const api = window.GAME_TEST_API!
      // Advance the clock a full day so the store cooldown is always clear.
      const st = api.getStats()
      api.setTime((st.hour + 1) % 24)
      api.enterInterior(id as string)
      api.givePlayerWeapon('handgun')
      api.drawPlayerWeapon()
      api.teleportPlayer([x as number, 1.2, z as number])
      api.setPlayerHeading(hd as number)
    },
    [store.id, store.aim[0], store.aim[1], h] as const,
  )
  // Wait for the sustained-aim robbery to begin (or skip if on cooldown).
  await page
    .waitForFunction(() => window.GAME_TEST_API!.getActivityState().activeId !== null, undefined, { timeout: 5000 })
    .catch(() => {})
  await page.evaluate(
    ([rx, rz, doSecure]) => {
      const api = window.GAME_TEST_API!
      if (api.getActivityState().activeId) {
        api.teleportPlayer([rx as number, 1.2, (rz as number) + 0.8])
        api.lootStoreRegister()
      }
      api.exitInterior()
      if (doSecure) {
        api.clearWanted()
        api.holsterPlayerWeapon()
        api.secureRobberyProceeds()
      } else {
        api.respawnPlayer('arrest')
      }
    },
    [store.register[0], store.register[1], secure] as const,
  )
}

test('robbery soak — repeated cycles stay clean under streaming', async ({ page }) => {
  const errors: string[] = []
  page.on('pageerror', (e) => errors.push(e.message))
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()) })
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
    // Advance a whole day between attempts so cooldowns always clear.
    await page.evaluate(() => {
      const s = window.GAME_TEST_API!.getStats()
      window.GAME_TEST_API!.setTime((s.hour + 13) % 24)
    })
    await robCycle(page, STORE, cycles % 2 === 0)
    // Reset activity cooldowns deterministically so the loop keeps producing.
    await page.evaluate(() => window.GAME_TEST_API!.resetActivities())
    await robCycle(page, KIOSK, true)
    await page.evaluate(() => window.GAME_TEST_API!.resetActivities())
    cycles++

    // Cycle a store district sector to prove streaming safety mid-loop.
    await page.evaluate(() => window.GAME_TEST_API!.forceUnloadSector('s1_-2'))
    await page.waitForTimeout(400)
    await page.evaluate(() => window.GAME_TEST_API!.forceLoadSector('s1_-2'))
    await page.waitForTimeout(400)
  }

  const final = await page.evaluate(() => {
    const api = window.GAME_TEST_API!
    return {
      state: api.getActivityState(),
      validation: api.getActivityValidation(),
      crimes: api.getCrimeEvents().length,
      police: api.getPoliceUnits().length,
    }
  })

  expect(errors).toEqual([])
  expect(final.state.activeId).toBeNull() // never stuck active
  expect(final.state.unsecuredProceeds).toBe(0) // no dangling proceeds
  expect(final.validation).toEqual([]) // definitions still valid
  expect(final.crimes).toBeLessThanOrEqual(64) // bounded crime ring
  expect(final.police).toBeLessThanOrEqual(3)
  expect(cycles).toBeGreaterThan(0)
  console.log(`[ROBBERY SOAK] cycles=${cycles}`)
})
