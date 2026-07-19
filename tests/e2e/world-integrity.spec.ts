import { expect, test } from '@playwright/test'
import { gotoGame, teleport } from './helpers'

/**
 * World Integrity & City Certification Platform v1 — live checks.
 *
 * Runs the game (Playwright keeps the tab active, unlike the throttled preview)
 * and asserts the observe-only integrity scan + universal occupancy hold up:
 * the semantic registry mirrors every live actor, and the citizen crowd —
 * including IDLE / waiting-to-cross people, which the legacy moving-only
 * separator skipped — no longer sustains body overlap (screenshot bug #1).
 */

test.describe('world integrity', () => {
  test('semantic registry mirrors live actors (player + citizens + vehicles)', async ({ page }) => {
    await gotoGame(page)
    await page.waitForTimeout(1500)
    const info = await page.evaluate(() => {
      const api = window.GAME_TEST_API!
      api.runIntegrityScan()
      const entities = api.getWorldEntities()
      const byKind: Record<string, number> = {}
      for (const e of entities) byKind[e.kind] = (byKind[e.kind] ?? 0) + 1
      return { total: entities.length, byKind, snapshot: api.getIntegritySnapshot() }
    })
    expect(info.total).toBeGreaterThan(10)
    expect(info.byKind.player).toBe(1)
    expect(info.byKind.ambient_citizen ?? 0).toBeGreaterThan(5)
    expect(info.snapshot.registry.total).toBe(info.total)
  })

  test('idle + moving citizens do not sustain body overlap (universal occupancy)', async ({ page }) => {
    await gotoGame(page)
    // Let the crowd run: idlers/waiters separate; walkers keep flowing.
    await page.waitForTimeout(6000)
    const result = await page.evaluate(() => {
      const api = window.GAME_TEST_API!
      api.runIntegrityScan()
      const anomalies = api.getIntegrityAnomalies()
      return {
        entities: api.getIntegritySnapshot().entityCount,
        // The issue's invariant: transient contact is tolerated, only SUSTAINED
        // overlap (two bodies stuck co-located past the threshold) is corruption.
        // A walker briefly passing an idler is fine; two idlers stuck is not.
        sustainedPersonPerson: anomalies.filter(
          (a) => a.type === 'person_person_overlap' && a.durationTicks >= 8,
        ).length,
      }
    })
    expect(result.entities).toBeGreaterThan(10)
    expect(result.sustainedPersonPerson).toBe(0)
  })

  test('every district certifies occlusion parity — no qualifying building fails to fade', async ({
    page,
  }) => {
    await gotoGame(page)
    // Pure certification from authored data: every district passes, no gaps.
    const cert = await page.evaluate(() => window.GAME_TEST_API!.getOcclusionParity())
    expect(cert.totalQualifying).toBeGreaterThan(0)
    expect(cert.totalMissing).toBe(0)
    expect(cert.pass).toBe(true)

    // Live cross-check across districts: no registered occluder is missing or
    // phantom (a real render path bypassing <Occludable> would surface here).
    const spots: [number, number, number][] = [
      [0, 1, 0], // central
      [48, 1, -160], // downtown gateway (Harbor Cross)
    ]
    for (const spot of spots) {
      await teleport(page, spot)
      await page.waitForTimeout(1200)
      const live = await page.evaluate(() => window.GAME_TEST_API!.getLiveOcclusionParity())
      expect(live.phantom).toEqual([])
      expect(live.missing).toEqual([])
    }
  })
})
