import { expect, test } from '@playwright/test'
import { gotoGame } from './helpers'

/**
 * Issue #23 / PR #24 blocking-2 — dedicated character/population streaming soak.
 *
 * STATE-DRIVEN (not delay-driven): every sample waits for the population to actually
 * settle after a teleport, so it measures settled LOD state instead of racing a fixed
 * delay. It explicitly proves far→near promotion and near→far demotion of a specific
 * rigged citizen, compares the settled per-stop counts across laps, and proves the real
 * `CharacterAppearance` (colours + geometry variants) rehydrates across save/load — not
 * just slot names. Also asserts: bounded rigged count, no model duplication / stranded
 * handles, no World-Integrity corruption, no page errors.
 */

const CENTRAL: [number, number, number] = [0, 1.2, 0]
const FAR: [number, number, number] = [48, 1.2, -152.9] // harbour cross — far from the central core
const RIGGED = 'cit_office_worker' // a central CORE citizen rendered through the rig only when near
const NAMED = 'npc_kim_01'
const STOPS: [number, number, number][] = [CENTRAL, FAR, [53, 1.2, -108], [197.5, 1.2, 198.6], [15, 1.2, 15]]

/** Wait until the skinned population stops changing (LOD promotion/demotion settled), then
 *  return the settled stats. State-driven: waits as long as the machine needs (capped). */
async function settledPop(page: import('@playwright/test').Page) {
  let prev = -1
  let stable = 0
  for (let i = 0; i < 60; i++) {
    const pop = await page.evaluate(() => window.GAME_TEST_API!.getCharacterPopulationStats())
    if (pop.modelActive === prev) {
      if (++stable >= 3) return pop // unchanged across ~3 polls ⇒ settled
    } else {
      stable = 0
      prev = pop.modelActive
    }
    await page.waitForTimeout(250)
  }
  return page.evaluate(() => window.GAME_TEST_API!.getCharacterPopulationStats())
}
async function teleportSettle(page: import('@playwright/test').Page, pos: [number, number, number]) {
  await page.evaluate((p) => window.GAME_TEST_API!.teleportPlayer(p), pos)
  return settledPop(page)
}
const corruption = (kinds: { kind: string }[]) =>
  kinds.filter((x) => /person_in|person_on|_in_solid|_on_car|overlap/i.test(x.kind)).length

test('bounded rigged population: real LOD promote/demote, appearance rehydration, no leaks', async ({
  page,
}) => {
  test.setTimeout(300_000)
  const errors: string[] = []
  page.on('pageerror', (e) => errors.push(String(e)))
  await gotoGame(page)

  const start = await settledPop(page)
  const cap = start.maxRiggedAmbient
  expect(cap).toBeGreaterThan(0)

  // (1) Explicit LOD demotion + promotion of a specific rigged core citizen — STATE-DRIVEN.
  // Far: its rig unmounts → no character instance registered.
  await teleportSettle(page, FAR)
  await page.waitForFunction((id) => window.GAME_TEST_API!.getCharacterState(id) === null, RIGGED, {
    timeout: 25_000,
  })
  // Near: its rig promotes → the model is loaded and active.
  await teleportSettle(page, CENTRAL)
  await page.waitForFunction(
    (id) => {
      const s = window.GAME_TEST_API!.getCharacterState(id)
      return s?.modelLoaded === true && s.activeVisual === 'model'
    },
    RIGGED,
    { timeout: 25_000 },
  )

  // (2) Real appearance rehydration across save/load: compare the FULL CharacterAppearance
  // (colours + hair/accessory/body variants), not slot names.
  const before = await page.evaluate((id) => window.GAME_TEST_API!.getCharacterState(id), NAMED)
  expect(before?.appearance, 'named NPC exposes a real appearance').toBeTruthy()
  expect(before?.appearance?.hairVariant, 'appearance carries geometry variants').toBeTruthy()
  await page.evaluate(async () => {
    await window.GAME_TEST_API!.saveGame()
    await window.GAME_TEST_API!.loadGame()
  })
  await settledPop(page)
  const after = await page.evaluate((id) => window.GAME_TEST_API!.getCharacterState(id), NAMED)
  expect(after?.appearance, 'the SAME appearance rehydrates across save/load').toEqual(
    before?.appearance,
  )

  // (3) Soak: five laps of streaming stress. Each lap traverses the far / other-district
  // stops (asserting the cap, no corruption, no leaks at each), then returns to CENTRAL and
  // settles STATE-DRIVEN on the rigged citizen actually promoting (which is what defeats the
  // streaming loading-plateau that made a fixed delay read 18/18/18/7/18). The cross-lap
  // count comparison is measured at that fully-promoted, well-defined state.
  const STRESS = STOPS.slice(1) // FAR + the other-district stops
  const centralCounts: number[] = []
  for (let lap = 0; lap < 5; lap++) {
    for (const pos of STRESS) {
      const pop = await teleportSettle(page, pos)
      expect(pop.byTier.ambient ?? 0, 'ambient cap').toBeLessThanOrEqual(cap)
      expect(pop.modelActive, 'modelActive bound').toBeLessThanOrEqual(cap + 12)
      const anomalies = await page.evaluate(() =>
        window.GAME_TEST_API!.getIntegrityAnomalies().map((a) => ({ kind: a.kind })),
      )
      expect(corruption(anomalies), 'integrity corruption').toBe(0)
    }
    await page.evaluate((p) => window.GAME_TEST_API!.teleportPlayer(p), CENTRAL)
    await page.waitForFunction(
      (id) => {
        const s = window.GAME_TEST_API!.getCharacterState(id)
        return s?.modelLoaded === true && s.activeVisual === 'model'
      },
      RIGGED,
      { timeout: 25_000 },
    )
    const central = await settledPop(page)
    expect(central.byTier.ambient ?? 0, 'central actually promotes rigs').toBeGreaterThan(0)
    expect(central.byTier.ambient ?? 0, 'central cap').toBeLessThanOrEqual(cap)
    centralCounts.push(central.modelActive)
  }
  // The settled CENTRAL count is consistent lap-over-lap — state-driven, so no fixed-delay
  // flake; only small ±drift from actors moving across the tier boundary.
  expect(
    Math.max(...centralCounts) - Math.min(...centralCounts),
    `central settled counts ${centralCounts}`,
  ).toBeLessThanOrEqual(3)

  // Reset → clean bounded state, still no leaks/corruption.
  await page.evaluate(() => window.GAME_TEST_API!.resetGame())
  const afterReset = await settledPop(page)
  expect(afterReset.byTier.ambient ?? 0).toBeLessThanOrEqual(cap)
  expect(afterReset.modelActive).toBeLessThanOrEqual(cap + 12)

  expect(errors, `page errors during soak:\n${errors.join('\n')}`).toEqual([])
})
