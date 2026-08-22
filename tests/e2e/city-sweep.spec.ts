import { expect, test } from '@playwright/test'
import { gotoGame, teleport } from './helpers'

/**
 * Automated City Sweeper (World Integrity issue §13) — a GENERATED full-city
 * traversal. Targets come from the compiled sector + anchor data
 * (`generateTraversalTargets`), so a new district is visited automatically with
 * no hand-listed probes. At every target the sweeper asserts, through the live
 * runtime: floor/collider coverage, no sustained corruption anomaly, a clean
 * placement report, no page/console errors, and bounded self-heal — the classes
 * of bug that "a human accidentally seeing the right camera angle" used to find.
 */

test.describe('automated city sweeper', { tag: '@simulation-only' }, () => {
  test('traverses every district with continuous integrity assertions', async ({ page }) => {
    const pageErrors: string[] = []
    page.on('pageerror', (e) => pageErrors.push(String(e)))
    page.on('console', (m) => {
      if (m.type() === 'error') pageErrors.push(m.text())
    })

    await gotoGame(page)
    const targets = await page.evaluate(() => window.GAME_TEST_API!.getTraversalTargets())
    expect(targets.length).toBeGreaterThan(8) // every district + anchors

    const sample = () =>
      page.evaluate(() => {
        const api = window.GAME_TEST_API!
        api.runIntegrityScan()
        const ring = api.getSafetyRing()
        const sustained = api
          .getIntegrityAnomalies()
          .filter(
            (a) =>
              a.durationTicks >= 8 &&
              ['person_person_overlap', 'person_vehicle_overlap', 'person_solid_overlap', 'vehicle_vehicle_overlap'].includes(
                a.type,
              ),
          ).length
        const placement = api
          .getIntegrityAnomalies()
          .filter((a) => ['prop_floating', 'prop_clipping', 'anchor_invalid'].includes(a.type)).length
        return { covered: ring ? ring.covered : false, sustained, placement }
      })

    const samples: { target: string; covered: boolean; settleMs: number }[] = []
    for (const t of targets) {
      await teleport(page, [t.x, 1, t.z])
      // POLL until the freshly-streamed district reaches steady state. A whole
      // district's idle citizens spawn at once and the CAPPED separation nudge
      // takes a few seconds to open any small spawn overlap — a transient that
      // teleporting far faster than real gameplay creates. Polling passes the
      // instant it settles (clean districts: ~one tick) and only a TRULY
      // persistent overlap (real corruption) survives the whole window.
      let s = await sample()
      let settleMs = 0
      for (let i = 0; i < 12 && s.sustained > 0; i++) {
        await page.waitForTimeout(500)
        settleMs += 500
        s = await sample()
      }
      samples.push({ target: `${t.sectorId}:${t.kind}`, covered: s.covered, settleMs })
      expect(s.sustained, `sustained overlap at ${t.sectorId} (${settleMs}ms settle)`).toBe(0)
      expect(s.placement, `placement anomaly at ${t.sectorId}`).toBe(0)
    }

    // The subject ended every teleport on ready coverage for the vast majority of
    // targets (a rare 1-frame post-teleport lag is tolerated, never corruption).
    const coveredCount = samples.filter((s) => s.covered).length
    expect(coveredCount).toBeGreaterThanOrEqual(targets.length - 2)

    const final = await page.evaluate(() => {
      const api = window.GAME_TEST_API!
      return { snapshot: api.getIntegritySnapshot(), selfHeals: api.getSafetyRing()?.selfHeals ?? 0 }
    })
    expect(pageErrors, pageErrors.join('\n')).toEqual([])
    expect(final.snapshot.sustainedAnomalies).toBe(0)
    expect(final.selfHeals).toBeLessThan(20) // bounded — no runaway sector churn
  })
})
