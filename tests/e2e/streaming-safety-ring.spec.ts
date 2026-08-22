import { expect, test } from '@playwright/test'
import { gotoGame, teleport } from './helpers'

/**
 * Streaming safety ring (World Integrity issue §6) — live checks.
 *
 * The player must never reach an area whose floor/colliders/visuals aren't ready
 * (the "blank city on fast travel / boundary crossing" bug). These run the real
 * runtime (Playwright keeps the tab active, unlike the throttled preview) and
 * assert the coverage invariant plus the delayed-readiness coverage gap, its
 * typed anomaly, and automatic recovery — through the live streaming +
 * safety-ring systems, not test-only state jumps. The soft velocity backstop and
 * the bounded stuck-sector watchdog are proven by the sectorSafetyRing unit
 * tests (pure over the streaming state).
 */

test.describe('streaming safety ring', () => {
  test('coverage invariant holds around the active subject (spawn + a district)', async ({ page }) => {
    await gotoGame(page)
    await page.waitForTimeout(1500)
    const atSpawn = await page.evaluate(() => window.GAME_TEST_API!.getSafetyRing())
    expect(atSpawn).not.toBeNull()
    expect(atSpawn!.covered).toBe(true) // world ready around the player
    expect(atSpawn!.backstops).toBe(0) // the backstop is inert in normal play
    expect(atSpawn!.selfHeals).toBe(0) // nothing wedged

    // A coordinated teleport into another district also lands on ready ground.
    await teleport(page, [48, 1, -160])
    await page.waitForTimeout(1500)
    const atHarbor = await page.evaluate(() => window.GAME_TEST_API!.getSafetyRing())
    expect(atHarbor!.covered).toBe(true)
    expect(atHarbor!.backstops).toBe(0)
  })

  test('delayed readiness opens a coverage gap + typed anomaly, then recovers', async ({ page }) => {
    await gotoGame(page)
    await page.waitForTimeout(1200)
    const result = await page.evaluate(async () => {
      const api = window.GAME_TEST_API!
      const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))
      const current = api.getSafetyRing()!.currentSector

      // Simulate streaming readiness falling behind under the player.
      api.holdSectorReadiness(current)
      await sleep(250) // let the director re-evaluate coverage for a few frames
      const gapCovered = api.getSafetyRing()!.covered
      const stillReady = api.isSectorReady(current)
      // The observe-only integrity scan surfaces it as a typed anomaly.
      api.runIntegrityScan()
      const anomalyCount = api
        .getIntegrityAnomalies()
        .filter((a) => a.type === 'player_outside_coverage').length

      // Recovery once readiness commits.
      api.releaseSectorReadiness(current)
      await sleep(300)
      const recoveredCovered = api.getSafetyRing()!.covered
      return { gapCovered, stillReady, anomalyCount, recoveredCovered, sectorReady: api.isSectorReady(current) }
    })
    expect(result.gapCovered).toBe(false) // coverage gap detected
    expect(result.stillReady).toBe(false) // the held sector reads not-ready
    expect(result.anomalyCount).toBeGreaterThan(0) // player_outside_coverage produced
    expect(result.recoveredCovered).toBe(true) // auto-recovered
    expect(result.sectorReady).toBe(true)
  })
})
