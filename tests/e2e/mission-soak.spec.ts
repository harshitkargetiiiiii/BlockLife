import { expect, test, type Page } from '@playwright/test'
import { gotoGame } from './helpers'

/**
 * Mission & Activity Framework v1 — long integration soak (§30). Runs repeated
 * mission attempts (lawful loop + criminal loop with real theft/wanted), cycles
 * destination sectors underneath them, and mixes in failures/cancels/retries —
 * while ambient traffic and citizen trips keep running. Asserts the framework
 * returns to baseline every time: no page errors, no duplicate rewards, no
 * stale mission ownership, no stuck state, bounded history/police.
 */

const SOAK_MS = 180_000

test.describe.configure({ timeout: SOAK_MS + 90_000 })

async function ready(page: Page): Promise<void> {
  await gotoGame(page)
  await page.evaluate(() => {
    const api = window.GAME_TEST_API!
    api.resetGame()
    api.clearWanted()
    api.setTime(12)
  })
  await page.waitForTimeout(700)
}

test('mission soak — repeated attempts stay clean under streaming', async ({ page }) => {
  const errors: string[] = []
  page.on('pageerror', (e) => errors.push(e.message))
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text())
  })
  await ready(page)

  const started = Date.now()
  let courierRuns = 0
  let hotRuns = 0

  while (Date.now() - started < SOAK_MS) {
    // --- Lawful loop: full City Courier via events + sector cycling ---------
    const accepted = await page.evaluate(() => {
      const api = window.GAME_TEST_API!
      // Cooldown may block it; skip forward in game time when it does.
      if (api.getMissionAvailability('city_courier') === 'cooldown') api.setTime(8)
      return api.startMission('city_courier')
    })
    if (accepted) {
      courierRuns++
      await page.evaluate(() => {
        const api = window.GAME_TEST_API!
        api.forceMissionEvent({ type: 'interactable_used', interactableId: 'courier_depot' })
        api.forceMissionEvent({ type: 'reached_zone', anchorId: 'courier_waterfront' })
      })
      // Cycle the next destination sector mid-mission.
      await page.evaluate(() => window.GAME_TEST_API!.forceUnloadSector('s1_-2'))
      await page.waitForTimeout(500)
      await page.evaluate(() => window.GAME_TEST_API!.forceLoadSector('s1_-2'))
      await page.waitForTimeout(500)
      await page.evaluate(() => {
        const api = window.GAME_TEST_API!
        api.forceMissionEvent({ type: 'reached_zone', anchorId: 'courier_mainstreet' })
        api.forceMissionEvent({ type: 'reached_zone', anchorId: 'courier_return' })
        // Duplicate terminal event must NOT pay twice.
        api.forceMissionEvent({ type: 'reached_zone', anchorId: 'courier_return' })
      })
      const s = await page.evaluate(() => window.GAME_TEST_API!.getMissionState())
      expect(s.activeMissionId).toBeNull() // resolved + cleaned up
    }

    // --- Criminal loop: real theft → wanted → escape/fail -------------------
    const hotOk = await page.evaluate(() => {
      const api = window.GAME_TEST_API!
      if (api.getMissionAvailability('hot_cargo') === 'cooldown') api.setTime(8)
      return api.startMission('hot_cargo')
    })
    if (hotOk) {
      hotRuns++
      const target = await page.evaluate(() => window.GAME_TEST_API!.getMissionTargetVehicle())
      if (target) {
        await page.evaluate((t) => window.GAME_TEST_API!.stealVehicle(t as string), target)
        await page.waitForTimeout(900) // let witnesses/wanted/police react
      }
      // Alternate: half the attempts escape + deliver, half get busted.
      if (hotRuns % 2 === 0) {
        await page.evaluate(() => {
          const api = window.GAME_TEST_API!
          api.clearWanted()
        })
        await page.waitForTimeout(500)
        await page.evaluate(() => {
          const api = window.GAME_TEST_API!
          api.forceMissionEvent({ type: 'reached_zone', anchorId: 'hotcargo_garage' })
          api.forceMissionEvent({ type: 'vehicle_exited', vehicleId: api.getMissionTargetVehicle() ?? '' })
          api.forceMissionEvent({ type: 'interactable_used', interactableId: 'hotcargo_fixer' })
        })
      } else {
        await page.evaluate(() => window.GAME_TEST_API!.forceMissionEvent({ type: 'player_arrested' }))
        await page.evaluate(() => window.GAME_TEST_API!.retryMission())
        await page.evaluate(() => window.GAME_TEST_API!.cancelMission())
      }
      const st = await page.evaluate(() => window.GAME_TEST_API!.getMissionState())
      expect(st.activeMissionId).toBeNull() // never stuck after resolution
      expect(st.ownedEntities).toEqual([]) // mission ownership released
    }

    // Reset the world between rounds so the crime stack returns to baseline.
    await page.evaluate(() => {
      const api = window.GAME_TEST_API!
      api.clearWanted()
      api.setPlayerHealth(100)
    })
    await page.waitForTimeout(600)
  }

  // --- Invariants after the whole soak -------------------------------------
  const final = await page.evaluate(() => {
    const api = window.GAME_TEST_API!
    const hist = api.getMissionHistory()
    return {
      state: api.getMissionState(),
      courier: hist['city_courier'] ?? null,
      hot: hist['hot_cargo'] ?? null,
      police: api.getPoliceUnits().length,
      crimes: api.getCrimeEvents().length,
      validation: api.getMissionValidation(),
    }
  })

  expect(errors).toEqual([]) // no page errors / NaN transforms across the soak
  expect(final.state.activeMissionId).toBeNull()
  expect(final.state.ownedEntities).toEqual([])
  expect(final.validation).toEqual([]) // definitions still valid at the end
  expect(final.police).toBeLessThanOrEqual(3) // L3 fleet cap never exceeded
  expect(final.crimes).toBeLessThanOrEqual(64) // bounded crime ring
  // Rewards are exactly one per completion — never duplicated.
  if (final.courier) expect(final.courier.totalEarned).toBe(final.courier.completions * 100)
  if (final.hot) expect(final.hot.totalEarned).toBe(final.hot.completions * 280)
  expect(courierRuns + hotRuns).toBeGreaterThan(0)
  console.log(`[SOAK] courierRuns=${courierRuns} hotRuns=${hotRuns} history=${JSON.stringify({ c: final.courier, h: final.hot })}`)
})
