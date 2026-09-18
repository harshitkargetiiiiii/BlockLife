import { expect, test, type Page } from '@playwright/test'

/**
 * Integration Wave 5 — the approved police car body on the LIVE police cruiser pool.
 *
 * Purely visual: the police director, dispatch caps, routing and arrests never read which body
 * renders. These checks drive the real dispatch path (a wanted response), then prove the two
 * branches a player can actually see: the approved body on every cruiser, and — when its GLB
 * cannot load — the complete procedural cruiser with its flashing light bar, exactly as before.
 */

const BODY = 'vehicle_police_cruiser_01'

type Readiness = { glbActive: string[]; glbFailed: string[]; pending: number }

async function boot(page: Page): Promise<void> {
  await page.goto('/')
  await page.waitForFunction(() => window.GAME_TEST_API?.ready() === true, undefined, { timeout: 45_000 })
  await page.waitForFunction(() => window.GAME_TEST_API?.assetsSettled() === true, undefined, { timeout: 45_000 })
}

/** Dispatch a level-2 response and stage both cruisers on the lane in front of the player. */
async function stageCruisers(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const api = window.GAME_TEST_API!
    api.resetGame()
    api.setTime(10)
    api.teleportPlayer([0, 1.2, -20.5])
    api.spawnPoliceResponse(2)
    const cars = api.getPoliceUnits().filter((u) => u.kind === 'vehicle')
    const spots: [number, number][] = [[-5, -24.6], [4.5, -24.6]]
    cars.forEach((c, i) => spots[i] && api.teleportPoliceUnit(c.id, spots[i][0], spots[i][1]))
    return cars.map((c) => c.id)
  })
}

/** The light bar on each visible cruiser: which variant is mounted, and how many lamps are lit. */
async function sirenState(page: Page): Promise<{ bars: number; variants: string[]; litPerBar: number[] }> {
  return page.evaluate(() => window.GAME_TEST_API!.getPoliceSirenState())
}

test.describe('police cruiser body (Integration Wave 5)', () => {
  test('dispatched cruisers render the approved body, and the siren still flashes', async ({ page }) => {
    const errors: string[] = []
    page.on('pageerror', (e) => errors.push(String(e)))
    await boot(page)
    const ids = await stageCruisers(page)
    expect(ids.length, 'a level-2 response dispatches two cruisers').toBe(2)
    await page.waitForFunction(() => window.GAME_TEST_API!.assetsSettled() === true, undefined, { timeout: 45_000 })

    const r = (await page.evaluate(() => window.GAME_TEST_API!.getAssetReadiness())) as Readiness
    expect(r.glbActive, 'the police body is on screen').toContain(BODY)
    expect(r.glbFailed, 'and nothing fell back').not.toContain(BODY)
    expect(r.pending).toBe(0)

    const siren = await sirenState(page)
    expect(siren.bars, 'one light bar per visible cruiser').toBe(2)
    expect(siren.variants, 'the bar mounted is the one fitted to the approved body').toEqual(['body', 'body'])
    for (const lit of siren.litPerBar) expect(lit, 'exactly one lamp lit per bar').toBe(1)
    // Purely visual: the dispatched units are still the police director's units.
    const units = await page.evaluate(() => window.GAME_TEST_API!.getPoliceUnits().filter((u) => u.kind === 'vehicle').length)
    expect(units).toBe(2)
    expect(errors, 'no page error').toEqual([])
  })

  test('an unreachable police GLB leaves the complete procedural cruiser, siren included', async ({ page }) => {
    await page.route('**/police_cruiser_01.glb', (route) => route.abort())
    await boot(page)
    await stageCruisers(page)
    await page.waitForFunction(() => window.GAME_TEST_API!.assetsSettled() === true, undefined, { timeout: 45_000 })

    const r = (await page.evaluate(() => window.GAME_TEST_API!.getAssetReadiness())) as Readiness
    expect(r.glbFailed, 'the aborted body is recorded as failed').toContain(BODY)
    expect(r.glbActive, 'and is not claimed as rendered').not.toContain(BODY)
    expect(r.pending).toBe(0)

    const siren = await sirenState(page)
    expect(siren.bars, 'the fallback cruisers keep their light bars').toBe(2)
    expect(siren.variants, 'on the procedural cruiser, at its original spot').toEqual(['procedural', 'procedural'])
    for (const lit of siren.litPerBar) expect(lit, 'exactly one lamp lit per bar').toBe(1)
    // The pursuit itself is unaffected by which body renders.
    const units = await page.evaluate(() => window.GAME_TEST_API!.getPoliceUnits().filter((u) => u.kind === 'vehicle').length)
    expect(units).toBe(2)
  })
})
