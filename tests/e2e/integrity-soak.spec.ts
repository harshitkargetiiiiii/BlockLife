import { expect, test } from '@playwright/test'
import { gotoGame } from './helpers'

/**
 * 300-second integrity soak (World Integrity issue §14). Continuously cycles
 * every district, varies time + weather, forces citizen panic/recovery via a
 * police response, cycles the apartment interior, and triggers sector
 * unload/reload through teleports — sampling the observe-only integrity scan the
 * whole time. It OWNS none of those systems; it drives them and watches. The
 * bar: zero SUSTAINED corruption anomalies, no entity-registry duplicate IDs,
 * bounded entity/self-heal growth, and no page/console error across the run.
 */

test('300-second integrity soak: cycle the whole city, zero sustained corruption', async ({ page }) => {
  test.setTimeout(400_000)
  const errors: string[] = []
  page.on('pageerror', (e) => errors.push(String(e)))
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text())
  })

  await gotoGame(page)
  const targets = await page.evaluate(() => window.GAME_TEST_API!.getTraversalTargets())
  const conditions: [number, string][] = [
    [9, 'clear'],
    [14, 'rain'],
    [19, 'clear'],
    [2, 'rain'],
  ]

  const start = Date.now()
  let cycle = 0
  let peakEntities = 0
  let maxSustainedSettled = 0
  while (Date.now() - start < 300_000) {
    const t = targets[cycle % targets.length]
    const [hour, weather] = conditions[cycle % conditions.length]

    await page.evaluate(
      ([x, z, h, w]) => {
        const api = window.GAME_TEST_API!
        api.setTime(h as number)
        api.setWeather(w as string)
        api.teleportPlayer([x as number, 1, z as number])
      },
      [t.x, t.z, hour, weather] as const,
    )

    // Every 5th cycle: a police response (forces citizen panic → flee → recovery
    // states) and an apartment interior cycle (enter → exit).
    if (cycle % 5 === 0) {
      await page.evaluate(() => {
        const api = window.GAME_TEST_API!
        api.setWantedLevel(2)
        api.spawnPoliceResponse(2)
      })
    }
    // Stand the response down two cycles later so officers disperse instead of
    // permanently piling up — the panic → flee → recovery ripple is exercised
    // repeatedly, and the world stays realistic rather than accreting a static
    // cluster of a dozen un-clamped officers over 100+ cycles.
    if (cycle % 5 === 2) {
      await page.evaluate(() => window.GAME_TEST_API!.setWantedLevel(0))
    }
    if (cycle % 7 === 3) {
      await page.evaluate(() => window.GAME_TEST_API!.enterApartment())
      await page.waitForTimeout(600)
      await page.evaluate(() => window.GAME_TEST_API!.exitApartment())
    }

    // Poll until the freshly-streamed district settles (spawn-separation), then
    // assert no SUSTAINED corruption. A transient resolves; real corruption stays.
    let s = await sampleIntegrity(page)
    for (let i = 0; i < 8 && s.sustained > 0; i++) {
      await page.waitForTimeout(400)
      s = await sampleIntegrity(page)
    }
    maxSustainedSettled = Math.max(maxSustainedSettled, s.sustained)
    peakEntities = Math.max(peakEntities, s.entities)

    expect(s.sustained, `sustained corruption at ${t.sectorId} (cycle ${cycle}): ${s.offenders.join(', ')}`).toBe(0)
    expect(s.duplicates, `duplicate registrations (cycle ${cycle})`).toBe(0)
    expect(s.entities, `entity count bounded (cycle ${cycle})`).toBeLessThan(600)
    expect(errors.length, `no page/console errors by cycle ${cycle}: ${errors[0] ?? ''}`).toBe(0)
    cycle++
  }

  // Clear the wanted state so a final settle isn't fighting an active pursuit,
  // then poll until settled — the SAME standard as each cycle (a transient from
  // citizens recovering out of panic as wanted clears must be given the settle
  // window; only a genuinely PERSISTENT overlap is corruption).
  await page.evaluate(() => window.GAME_TEST_API!.setWantedLevel(0))
  await page.waitForTimeout(1500)
  let final = await sampleIntegrity(page)
  for (let i = 0; i < 12 && final.sustained > 0; i++) {
    await page.waitForTimeout(400)
    final = await sampleIntegrity(page)
  }
  expect(cycle, 'ran a meaningful number of cycles').toBeGreaterThan(30)
  expect(final.sustained, `final sustained corruption: ${final.offenders.join(', ')}`).toBe(0)
  expect(final.duplicates).toBe(0)
  expect(final.selfHeals, 'bounded sector self-heal (no runaway churn)').toBeLessThan(60)
  expect(errors, errors.join('\n')).toEqual([])
})

async function sampleIntegrity(page: import('@playwright/test').Page) {
  return page.evaluate(() => {
    const api = window.GAME_TEST_API!
    api.runIntegrityScan()
    const snap = api.getIntegritySnapshot()
    // Sustained corruption among the actors the world-integrity platform actually
    // CLAMPS — citizens, named NPCs, ambient vehicles vs each other and vs solids.
    // Two participants are out of that scope and excluded:
    //   • Police (`police_*`) / ejected-driver / interior movers — a DOCUMENTED
    //     deferred gap (platform §8): DETECTED but not yet clamped; a burst of
    //     officers converging on a suspect can transiently cluster.
    //   • The `player` — a USER-controlled entity the platform never repositions.
    //     The contract is "citizens/NPCs YIELD to the on-foot player" (a soft
    //     push), NOT "the player never overlaps anyone": the player can walk (or,
    //     here, be TELEPORTED by the harness) onto a fixed-routine NPC's spot, and
    //     a stationary player parked there is the player controller's domain, not
    //     this platform's. NPC↔citizen / NPC↔NPC overlaps are still caught.
    // The soak still RUNS + observes all that activity (§14); it only ASSERTS zero
    // sustained corruption for what the platform guarantees.
    const corrupt = api
      .getIntegrityAnomalies()
      .filter(
        (a) =>
          a.durationTicks >= 8 &&
          ['person_person_overlap', 'person_vehicle_overlap', 'person_solid_overlap', 'vehicle_vehicle_overlap'].includes(
            a.type,
          ) &&
          !a.entityIds.some((id) => id.startsWith('police_') || id === 'player'),
      )
    return {
      sustained: corrupt.length,
      offenders: corrupt.slice(0, 4).map((a) => `${a.type}:${a.entityIds.join('+')}@${a.durationTicks}`),
      entities: snap.entityCount,
      duplicates: snap.registry.duplicateRegistrations,
      selfHeals: api.getSafetyRing()?.selfHeals ?? 0,
    }
  })
}
