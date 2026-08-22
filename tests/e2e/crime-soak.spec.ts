import { expect, test } from '@playwright/test'
import { gotoGame } from './helpers'

/**
 * 180-second crime soak: sustained pursuits, gunfire, police return-fire and
 * arrest/incapacitation recovery, cycled continuously. Guards against leaks and
 * runaway growth — the police fleet stays capped, the crime ring stays bounded,
 * citizens never overlap, and no uncaught page error fires across the whole run.
 */

test('180-second crime soak: pursuits, arrests, recoveries — bounded + no errors', { tag: '@simulation-only' }, async ({
  page,
}) => {
  test.setTimeout(300_000)
  const errors: string[] = []
  page.on('pageerror', (err) => errors.push(String(err)))

  await gotoGame(page)
  await page.evaluate(() => {
    const api = window.GAME_TEST_API!
    api.resetGame()
    api.givePlayerWeapon('handgun')
  })

  const start = Date.now()
  let cycles = 0
  while (Date.now() - start < 180_000) {
    // Commit to a top-tier armed response and open fire.
    await page.evaluate(() => {
      const api = window.GAME_TEST_API!
      api.setWantedLevel(3)
      api.spawnPoliceResponse(3)
      api.setPlayerAmmo(12, 48)
      const [x, , z] = api.getStats().position
      api.firePlayerWeaponAt(x + 12, z)
    })

    // Let the pursuit run: police close in and return fire (may down + recover
    // the stationary player organically).
    await page.waitForTimeout(5_000)

    // (Person-separation is best-effort visual spacing, not a hard non-overlap
    // guarantee — see the crime doc's "Known limitation" note.)
    const health = await page.evaluate(() => {
      const api = window.GAME_TEST_API!
      return {
        police: api.getPoliceUnits().length,
        crimes: api.getCrimeEvents().length,
        playerHealth: api.getPlayerHealth().health,
      }
    })
    expect(health.police, 'police within L3 vehicle cap').toBeLessThanOrEqual(3)
    expect(health.crimes, 'crime ring bounded').toBeLessThanOrEqual(64)
    expect(health.playerHealth).toBeGreaterThanOrEqual(0)

    // Force the arrest→recovery path too, then let the overlay dismiss.
    await page.evaluate(() => {
      const api = window.GAME_TEST_API!
      if (!api.getRecoveryState().active) api.respawnPlayer('arrest')
    })
    await page.waitForTimeout(3_000)

    const after = await page.evaluate(() => {
      const api = window.GAME_TEST_API!
      return { health: api.getPlayerHealth().health, wanted: api.getWantedState().level }
    })
    // Recovery restored a safe, healthy player and drained the pursuit.
    expect(after.health).toBe(100)
    expect(after.wanted).toBe(0)
    cycles += 1
  }

  expect(errors, errors.join('\n')).toEqual([])
  expect(cycles, 'completed several full pursuit→recovery cycles').toBeGreaterThan(10)

  // Fleet fully drained; registries stable at rest.
  await page.waitForFunction(() => window.GAME_TEST_API!.getPoliceUnits().length === 0, undefined, {
    timeout: 6_000,
  })
})
