import { expect, test } from '@playwright/test'
import { acquireDrivableCar, getStats, gotoGame, waitForActiveInteractable } from './helpers'

/**
 * Building Occlusion & Player Visibility v1. The Nook Offices tower
 * (x 13..20, z −4.5..2.5, ~10 tall) sits SE of the Job Board — standing
 * NW of it puts it exactly between the diorama camera and the player.
 */
const BEHIND_OFFICE: [number, number, number] = [11.5, 1.2, -6.5]

test.describe('building occlusion', () => {
  test('walking behind a tall building fades it; the collider stays solid', async ({ page }) => {
    const errors: string[] = []
    page.on('pageerror', (err) => errors.push(String(err)))
    await gotoGame(page)
    await page.evaluate(() => {
      window.GAME_TEST_API!.resetGame()
      window.GAME_TEST_API!.setTime(10)
      // z = −1 is level with the office body (z −4.5..2.5), so walking east
      // ends against its west wall — both the fade AND the collider verify.
      window.GAME_TEST_API!.teleportPlayer([9.5, 1.2, -1])
    })
    await page.waitForTimeout(1800) // camera settles

    // Walk east (d+s = pure +x) toward the tower in short bursts until the
    // fade engages — real walking, so the hysteresis path is exercised.
    for (let i = 0; i < 5; i++) {
      await page.keyboard.down('d')
      await page.keyboard.down('s')
      await page.waitForTimeout(500)
      await page.keyboard.up('d')
      await page.keyboard.up('s')
      const faded = await page.evaluate(
        () => window.GAME_TEST_API!.getVisibilityState().faded.length,
      )
      if (faded > 0) break
    }
    await page.waitForFunction(
      () =>
        window.GAME_TEST_API!.getVisibilityState().faded.some(
          (f) => f.id === 'building_office_01' && f.opacity < 0.5,
        ),
      undefined,
      { timeout: 6000 },
    )
    const vis = await page.evaluate(() => window.GAME_TEST_API!.getVisibilityState())
    expect(vis.faded[0].reason).toContain('occluded')

    // The faded building is still SOLID: keep walking into it — blocked at
    // its west wall (x = 13) despite being nearly invisible.
    await page.keyboard.down('d')
    await page.keyboard.down('s')
    await page.waitForTimeout(1800)
    await page.keyboard.up('d')
    await page.keyboard.up('s')
    const stats = await getStats(page)
    expect(stats.position[0]).toBeLessThan(13.2)
    expect(errors).toEqual([])
  })

  test('walking back into clear view restores the building smoothly', async ({ page }) => {
    await gotoGame(page)
    await page.evaluate((pos) => {
      window.GAME_TEST_API!.resetGame()
      window.GAME_TEST_API!.setTime(10)
      window.GAME_TEST_API!.teleportPlayer(pos)
    }, BEHIND_OFFICE)
    await page.waitForFunction(
      () => window.GAME_TEST_API!.getVisibilityState().faded.length > 0,
      undefined,
      { timeout: 6000 },
    )
    // Walk west out of the shadowed corridor (a+w = pure −x).
    await page.keyboard.down('a')
    await page.keyboard.down('w')
    await page.waitForTimeout(1600)
    await page.keyboard.up('a')
    await page.keyboard.up('w')
    await page.waitForFunction(
      () => window.GAME_TEST_API!.getVisibilityState().faded.length === 0,
      undefined,
      { timeout: 6000 },
    )
    const vis = await page.evaluate(() => window.GAME_TEST_API!.getVisibilityState())
    expect(vis.faded).toEqual([])
  })

  test('driving behind a building fades it for the vehicle', async ({ page }) => {
    await gotoGame(page)
    await page.evaluate(() => {
      window.GAME_TEST_API!.resetGame()
      window.GAME_TEST_API!.setTime(10)
      window.GAME_TEST_API!.teleportTo('parking_lot_test')
    })
    await acquireDrivableCar(page) // §19: own an active Compact shell (no free car on a new game)
    await waitForActiveInteractable(page, 'vehicle_compact_car_01')
    await page.keyboard.press('e')
    await page.waitForFunction(() => window.GAME_TEST_API!.getStats().mode === 'driving')
    // Park the car NW of the Block Gym — the gym sits on the camera line.
    await page.evaluate(() => window.GAME_TEST_API!.setDrivenCarPosition([9, -17.5], 0))
    await page.waitForTimeout(2200)
    const vis = await page.evaluate(() => window.GAME_TEST_API!.getVisibilityState())
    expect(vis.subjectKind).toBe('vehicle')
    expect(vis.faded.map((f) => f.id)).toContain('building_gym_01')
    // Driving still works while the building is faded.
    await page.keyboard.down('s')
    await page.waitForTimeout(700)
    await page.keyboard.up('s')
    const stats = await getStats(page)
    expect(stats.mode).toBe('driving')
  })

  test('teleporting across districts clears stale fades', async ({ page }) => {
    await gotoGame(page)
    await page.evaluate((pos) => {
      window.GAME_TEST_API!.resetGame()
      window.GAME_TEST_API!.setTime(10)
      window.GAME_TEST_API!.teleportPlayer(pos)
    }, BEHIND_OFFICE)
    await page.waitForFunction(
      () => window.GAME_TEST_API!.getVisibilityState().faded.length > 0,
      undefined,
      { timeout: 6000 },
    )
    await page.evaluate(() => window.GAME_TEST_API!.teleportTo('residential_west_street'))
    await page.waitForTimeout(600)
    const vis = await page.evaluate(() => window.GAME_TEST_API!.getVisibilityState())
    // The STALE fade (office, central) is gone; if anything fades now it is
    // a genuine occluder at the NEW location — exactly the spec behavior.
    expect(vis.faded.map((f) => f.id)).not.toContain('building_office_01')
    for (const f of vis.faded) {
      expect(f.id).toMatch(/_w\d|commons_w/)
    }
  })

  test('entering the apartment disables outdoor occlusion; exiting resumes it', async ({
    page,
  }) => {
    await gotoGame(page)
    await page.evaluate((pos) => {
      window.GAME_TEST_API!.resetGame()
      window.GAME_TEST_API!.setTime(10)
      window.GAME_TEST_API!.teleportPlayer(pos)
    }, BEHIND_OFFICE)
    await page.waitForFunction(
      () => window.GAME_TEST_API!.getVisibilityState().faded.length > 0,
      undefined,
      { timeout: 6000 },
    )
    await page.evaluate(() => window.GAME_TEST_API!.enterApartment())
    await page.waitForTimeout(500)
    let vis = await page.evaluate(() => window.GAME_TEST_API!.getVisibilityState())
    expect(vis.subjectId).toBeNull()
    expect(vis.faded).toEqual([])
    await page.evaluate(() => window.GAME_TEST_API!.exitApartment())
    await page.waitForTimeout(500)
    vis = await page.evaluate(() => window.GAME_TEST_API!.getVisibilityState())
    expect(vis.subjectKind).toBe('player')
  })

  test('night + rain: the fade carries the window overlays with the building', async ({
    page,
  }) => {
    const errors: string[] = []
    page.on('pageerror', (err) => errors.push(String(err)))
    await gotoGame(page)
    await page.evaluate((pos) => {
      window.GAME_TEST_API!.resetGame()
      window.GAME_TEST_API!.setTime(21)
      window.GAME_TEST_API!.setWeather('rain')
      window.GAME_TEST_API!.teleportPlayer(pos)
    }, BEHIND_OFFICE)
    await page.waitForFunction(
      () =>
        window.GAME_TEST_API!.getVisibilityState().faded.some(
          (f) => f.id === 'building_office_01',
        ),
      undefined,
      { timeout: 6000 },
    )
    // The occlusion system is registered on the group containing BOTH the
    // GLB and its window overlays — asserted structurally in unit tests;
    // here we just confirm the fade holds under night/weather without
    // errors (visual baseline covers appearance).
    await page.waitForTimeout(1000)
    const vis = await page.evaluate(() => window.GAME_TEST_API!.getVisibilityState())
    expect(vis.faded.length).toBeGreaterThan(0)
    expect(errors).toEqual([])
  })

  test('occlusion can be disabled via the dev API (visual A/B)', async ({ page }) => {
    await gotoGame(page)
    await page.evaluate((pos) => {
      window.GAME_TEST_API!.resetGame()
      window.GAME_TEST_API!.teleportPlayer(pos)
    }, BEHIND_OFFICE)
    await page.waitForFunction(
      () => window.GAME_TEST_API!.getVisibilityState().faded.length > 0,
      undefined,
      { timeout: 6000 },
    )
    await page.evaluate(() => window.GAME_TEST_API!.setOcclusionEnabled(false))
    await page.waitForTimeout(300)
    const vis = await page.evaluate(() => window.GAME_TEST_API!.getVisibilityState())
    expect(vis.enabled).toBe(false)
    expect(vis.faded).toEqual([])
    await page.evaluate(() => window.GAME_TEST_API!.setOcclusionEnabled(true))
  })
})
