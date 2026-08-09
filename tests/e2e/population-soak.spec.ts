import { expect, test } from '@playwright/test'
import { gotoGame } from './helpers'

/**
 * Issue #23 / PR #24 blocking-2 — dedicated character/population streaming soak.
 * Repeatedly traverses/streams districts (exercising near↔far LOD promotion/demotion of
 * the rigged ambient crowd + named NPCs), then save/load/reset, and asserts the pipeline
 * stays healthy the whole time:
 *  - the rigged-ambient count stays inside its hard cap (no unbounded skinned growth),
 *  - modelActive stays bounded + STABLE returning to the same spot (no stranded model
 *    handles / mixers, no model duplication across stream cycles),
 *  - identity → appearance rehydrates across save/load (appearance is derived from the id,
 *    never persisted),
 *  - no new World-Integrity corruption and no page errors across the whole run.
 */

// Spread across sectors (coords taken from existing production-path E2E) so each hop
// streams sectors in/out and churns the distance LOD.
const STOPS: [number, number, number][] = [
  [0, 1.2, 0], // central plaza
  [48, 1.2, -152.9], // harbour cross (downtown gateway)
  [53, 1.2, -108], // industrial approach
  [197.5, 1.2, 198.6], // far expansion sector
  [15, 1.2, 15], // back near central
]
const CORRUPTION = /person_in|person_on|_in_solid|_on_car|overlap/i

test('bounded rigged population stays healthy across streaming, LOD churn, save/load', async ({
  page,
}) => {
  test.setTimeout(300_000)
  const errors: string[] = []
  page.on('pageerror', (e) => errors.push(String(e)))

  await gotoGame(page)

  const start = await page.evaluate(() => {
    const a = window.GAME_TEST_API!
    return {
      pop: a.getCharacterPopulationStats(),
      kim: a.getCharacterState('npc_kim_01'),
    }
  })
  const cap = start.pop.maxRiggedAmbient
  expect(cap).toBeGreaterThan(0)
  expect(start.pop.byTier.ambient ?? 0).toBeLessThanOrEqual(cap)

  // Traverse the city several times; sample the population at every stop.
  const samples: { ambient: number; modelActive: number; anomalies: number; where: number }[] = []
  for (let lap = 0; lap < 5; lap++) {
    for (let i = 0; i < STOPS.length; i++) {
      await page.evaluate((pos) => window.GAME_TEST_API!.teleportPlayer(pos), STOPS[i])
      await page.waitForTimeout(1100) // let streaming + LOD promote/demote settle
      samples.push(
        await page.evaluate((where) => {
          const a = window.GAME_TEST_API!
          const pop = a.getCharacterPopulationStats()
          return {
            ambient: pop.byTier.ambient ?? 0,
            modelActive: pop.modelActive,
            anomalies: a.getIntegrityAnomalies().filter((x) => /person_in|person_on|_in_solid|_on_car|overlap/i.test(x.kind)).length,
            where,
          }
        }, i),
      )
    }
  }

  // Every sample obeys the hard rigged-ambient cap; modelActive stays bounded (named cast +
  // player + near rigged ambient) — a leak or duplication would blow past this.
  for (const s of samples) {
    expect(s.ambient, `ambient rigged at stop ${s.where}`).toBeLessThanOrEqual(cap)
    expect(s.modelActive, `modelActive at stop ${s.where}`).toBeLessThanOrEqual(cap + 12)
    expect(s.anomalies, `integrity corruption at stop ${s.where}`).toBe(0)
  }
  // Returning to the SAME location gives a stable count — no accumulation across cycles.
  const central = samples.filter((s) => s.where === 0).map((s) => s.modelActive)
  expect(Math.max(...central) - Math.min(...central)).toBeLessThanOrEqual(4)

  // Save / load: identity + appearance rehydrate (derived from the id, never stored).
  await page.evaluate(() => window.GAME_TEST_API!.teleportPlayer([0, 1.2, 0]))
  await page.waitForTimeout(1000)
  await page.evaluate(async () => {
    await window.GAME_TEST_API!.saveGame()
    await window.GAME_TEST_API!.loadGame()
  })
  await page.waitForTimeout(1600)
  const afterLoad = await page.evaluate(() => {
    const a = window.GAME_TEST_API!
    return { kim: a.getCharacterState('npc_kim_01'), pop: a.getCharacterPopulationStats() }
  })
  expect(afterLoad.kim?.modelLoaded, 'Kim rig rehydrates after load').toBe(true)
  expect(afterLoad.kim?.resolvedSlots.slice().sort()).toEqual(start.kim?.resolvedSlots.slice().sort())
  expect(afterLoad.pop.byTier.ambient ?? 0).toBeLessThanOrEqual(cap)

  // Reset: population returns to a clean bounded state.
  await page.evaluate(() => window.GAME_TEST_API!.resetGame())
  await page.waitForTimeout(1400)
  const afterReset = await page.evaluate(() => window.GAME_TEST_API!.getCharacterPopulationStats())
  expect(afterReset.byTier.ambient ?? 0).toBeLessThanOrEqual(cap)
  expect(afterReset.modelActive).toBeLessThanOrEqual(cap + 12)

  expect(errors, `page errors during soak:\n${errors.join('\n')}`).toEqual([])
})
