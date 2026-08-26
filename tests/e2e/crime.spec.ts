import { expect, test, type Page } from '@playwright/test'
import { getStats, gotoGame } from './helpers'

/**
 * Crime & Law Enforcement v1 — end-to-end scenarios covering the connected
 * loop: crime → wanted → police dispatch/pursuit/arrest, firearm hitscan +
 * damage + escalation, vehicle theft, and the save/load + recovery rules.
 * Deterministic via the dev-only test API (crime timing rides the pausable
 * game clock; police spawn at fixed anchors; hits are placed, not organic).
 */

async function freshGame(page: Page): Promise<void> {
  await gotoGame(page)
  await page.evaluate(() => {
    const api = window.GAME_TEST_API!
    api.resetGame()
    api.clearWanted()
  })
}

/** Player world position (x,z) for placing officers/targets nearby. */
async function playerXZ(page: Page): Promise<[number, number]> {
  const s = await getStats(page)
  return [s.position[0], s.position[2]]
}

test.describe('crime & law enforcement', () => {
  test('1 — the handgun equips full and drawn', async ({ page }) => {
    await freshGame(page)
    const w = await page.evaluate(() => {
      window.GAME_TEST_API!.givePlayerWeapon('handgun')
      return window.GAME_TEST_API!.getWeaponState()
    })
    expect(w.equipped).toBe('handgun')
    expect(w.pose).toBe('drawn')
    expect(w.magazine).toBe(12)
    expect(w.reserve).toBe(48)
  })

  test('2 — firing emits a weapon_discharge crime and spends a round', async ({ page }) => {
    await freshGame(page)
    const res = await page.evaluate(() => {
      const api = window.GAME_TEST_API!
      api.givePlayerWeapon('handgun')
      const before = api.getWeaponState().magazine
      api.firePlayerWeaponAt(0, -40) // fire off into the distance
      const after = api.getWeaponState().magazine
      const crimes = api.getCrimeEvents().map((c) => c.type)
      return { before, after, crimes }
    })
    expect(res.after).toBe(res.before - 1)
    expect(res.crimes).toContain('weapon_discharge')
  })

  test('3 — shooting an officer escalates to wanted level 3', async ({ page }) => {
    await freshGame(page)
    const [px, pz] = await playerXZ(page)
    const res = await page.evaluate(
      ([x, z]) => {
        const api = window.GAME_TEST_API!
        api.givePlayerWeapon('handgun')
        api.spawnPoliceResponse(1)
        const officer = api.getPoliceUnits()[0]
        api.teleportPoliceUnit(officer.id, x + 3, z)
        const shot = api.firePlayerWeaponAt(x + 3, z)
        return {
          shot,
          wanted: api.getWantedState().level,
          crimes: api.getCrimeEvents().map((c) => c.type),
          officerHealth: api.getActorHealth(officer.id).health,
        }
      },
      [px, pz],
    )
    expect(res.shot.hit).toBe(true)
    expect(res.wanted).toBe(3)
    expect(res.crimes).toContain('attacking_police')
    expect(res.officerHealth).toBeLessThan(100)
  })

  test('4 — downing an officer files a police_injury crime', async ({ page }) => {
    await freshGame(page)
    const [px, pz] = await playerXZ(page)
    const res = await page.evaluate(
      ([x, z]) => {
        const api = window.GAME_TEST_API!
        api.givePlayerWeapon('handgun')
        api.spawnPoliceResponse(1)
        const officer = api.getPoliceUnits()[0]
        api.teleportPoliceUnit(officer.id, x + 3, z)
        api.setActorHealth(officer.id, 8) // one shot drops them
        const shot = api.firePlayerWeaponAt(x + 3, z)
        return { shot, crimes: api.getCrimeEvents().map((c) => c.type) }
      },
      [px, pz],
    )
    expect(res.shot.incapacitated).toBe(true)
    expect(res.crimes).toContain('police_injury')
  })

  test('5 — dispatch spawns a capped, off-camera response and drains when cleared', async ({
    page,
  }) => {
    await freshGame(page)
    const res = await page.evaluate(() => {
      const api = window.GAME_TEST_API!
      const spawned = api.spawnPoliceResponse(2)
      const units = api.getPoliceUnits()
      api.clearWanted()
      return { spawned, count: units.length }
    })
    expect(res.spawned).toBe(2) // L2 vehicle cap
    expect(res.count).toBe(2)
    // Fleet drains on the next dispatch tick after wanted clears.
    await page.waitForFunction(() => window.GAME_TEST_API!.getPoliceUnits().length === 0, undefined, {
      timeout: 5_000,
    })
  })

  test('6 — police arrest a cornered, stopped suspect', { tag: '@simulation-only' }, async ({ page }) => {
    await freshGame(page)
    const [px, pz] = await playerXZ(page)
    await page.evaluate(
      ([x, z]) => {
        const api = window.GAME_TEST_API!
        api.spawnPoliceResponse(1)
        const officer = api.getPoliceUnits()[0]
        api.teleportPoliceUnit(officer.id, x + 2, z) // point-blank on a stopped player
      },
      [px, pz],
    )
    // The arrest hold elapses, then the recovery flow resolves it (BUSTED).
    await page.waitForFunction(
      () => window.GAME_TEST_API!.getRecoveryState().kind === 'arrest',
      undefined,
      { timeout: 8_000 },
    )
    // Recovery cleared the pursuit and restored full health.
    const state = await page.evaluate(() => ({
      wanted: window.GAME_TEST_API!.getWantedState().level,
      health: window.GAME_TEST_API!.getPlayerHealth().health,
    }))
    expect(state.wanted).toBe(0)
    expect(state.health).toBe(100)
  })

  test('7 — parked vehicle theft enters driving with a theft crime', async ({ page }) => {
    await freshGame(page)
    const res = await page.evaluate(() => {
      const api = window.GAME_TEST_API!
      const ok = api.stealVehicle('theft_parked_plaza')
      return {
        ok,
        car: api.getVehicleCrimeState('vehicle_compact_car_01'),
        crimes: api.getCrimeEvents().map((c) => c.type),
      }
    })
    expect(res.ok).toBe(true)
    expect(res.car.stolen).toBe(true)
    expect(res.car.access).toBe('owned_by_player')
    expect(res.crimes).toContain('vehicle_theft')
    // The stolen car becomes the driven vehicle.
    expect((await getStats(page)).mode).toBe('driving')
  })

  test('8 — carjacking an occupied vehicle ejects the driver and is higher severity', async ({
    page,
  }) => {
    await freshGame(page)
    const res = await page.evaluate(() => {
      const api = window.GAME_TEST_API!
      const id = 'theft_occupied_plaza'
      const occupantBefore = api.getVehicleOccupant(id)
      const ok = api.forceOccupiedVehicleTheft(id)
      return {
        occupantBefore,
        ok,
        crimes: api.getCrimeEvents().map((c) => c.type),
        car: api.getVehicleCrimeState('vehicle_compact_car_01'),
        occupantAfter: api.getVehicleOccupant(id),
        drivers: api.getEjectedDrivers().map((d) => d.id),
        wanted: api.getWantedState().level,
        // A second carjack of the same car must be refused (no duplicate driver).
        secondSteal: api.forceOccupiedVehicleTheft(id),
        driverCount: api.getEjectedDrivers().length,
      }
    })
    expect(res.occupantBefore).toBe('driver_occ_plaza') // occupied before
    expect(res.ok).toBe(true)
    expect(res.crimes).toContain('occupied_vehicle_theft')
    expect(res.car.stolen).toBe(true)
    expect(res.car.access).toBe('owned_by_player')
    expect(res.occupantAfter).toBeNull() // driver no longer the occupant
    expect(res.drivers).toContain('driver_occ_plaza') // ejected + fleeing
    expect(res.wanted).toBeGreaterThan(0) // owner reported the carjack
    expect(res.secondSteal).toBe(false) // can't carjack the same car twice
    expect(res.driverCount).toBe(1) // exactly one ejected driver, no duplicate
    expect((await getStats(page)).mode).toBe('driving')
  })

  test('8b — the carjacked driver flees the scene then despawns', { tag: '@simulation-only' }, async ({ page }) => {
    await freshGame(page)
    // ISSUE #34 PHASE B (temporary diagnostic logging; assertions unchanged).
    await page.evaluate(() =>
      (window.GAME_TEST_API as never as Record<string, () => void>).resetIssue34Events(),
    )
    const start = await page.evaluate(() => {
      const api = window.GAME_TEST_API!
      api.forceOccupiedVehicleTheft('theft_occupied_market')
      const d = api.getEjectedDrivers().find((x) => x.id === 'driver_occ_market')!
      return d.position
    })
    await page.waitForTimeout(2500)
    const moved = await page.evaluate((s) => {
      const api = window.GAME_TEST_API!
      const d = api.getEjectedDrivers().find((x) => x.id === 'driver_occ_market')
      if (!d) return { gone: true, dist: 0 }
      return { gone: false, dist: Math.hypot(d.position[0] - (s as number[])[0], d.position[1] - (s as number[])[1]) }
    }, start)
    // ISSUE #34 PHASE B: dump BEFORE the assertion so evidence survives a failure.
    {
      const ev = await page.evaluate(() =>
        (window.GAME_TEST_API as never as Record<string, () => unknown>).getIssue34Events(),
      )
      console.log(
        'ISSUE34_PHASEB_A ' +
          JSON.stringify({
            sha: process.env.DIAG_SHA ?? 'unknown',
            mode: process.env.VITE_SUPPRESS_AFTER_SETTLE ? 'suppressed' : 'normal',
            rep: process.env.DIAG_REP ?? '0',
            checkpoint: moved,
            existsAtCheckpoint: !moved.gone,
            events: ev,
          }),
      )
    }
    // The driver moved away from the car (fled on foot).
    if (!moved.gone) expect(moved.dist).toBeGreaterThan(1)
    // …and eventually despawns after the flee window.
    await page.waitForFunction(
      () => window.GAME_TEST_API!.getEjectedDrivers().every((d) => d.id !== 'driver_occ_market'),
      undefined,
      { timeout: 12_000 },
    )
  })

  test('9 — a wrecked vehicle is disabled', async ({ page }) => {
    await freshGame(page)
    const car = await page.evaluate(() => {
      const api = window.GAME_TEST_API!
      api.setVehicleHealth('vehicle_compact_car_01', 0)
      return api.getVehicleCrimeState('vehicle_compact_car_01')
    })
    expect(car.disabled).toBe(true)
  })

  test('10 — the phone is blocked during an active pursuit', async ({ page }) => {
    await freshGame(page)
    await page.evaluate(() => window.GAME_TEST_API!.setWantedLevel(2))
    await page.keyboard.press('Tab')
    await page.waitForTimeout(200)
    // Phone must NOT have opened.
    expect((await getStats(page)).uiPanel).not.toBe('phone')
  })

  test('11 — health persists across save/load while wanted + weapon reset', async ({ page }) => {
    await freshGame(page)
    await page.evaluate(() => {
      const api = window.GAME_TEST_API!
      api.setPlayerHealth(55)
      api.givePlayerWeapon('handgun')
    })
    await page.getByTestId('save-btn').click()
    await page.waitForTimeout(300)
    // Mutate everything transient, then load.
    await page.evaluate(() => {
      const api = window.GAME_TEST_API!
      api.setPlayerHealth(100)
      api.setWantedLevel(3)
    })
    await page.getByTestId('load-btn').click()
    await page.waitForTimeout(500)
    const res = await page.evaluate(() => {
      const api = window.GAME_TEST_API!
      return {
        health: api.getPlayerHealth().health,
        wanted: api.getWantedState().level,
        weapon: api.getWeaponState().equipped,
      }
    })
    expect(res.health).toBe(55) // persisted
    expect(res.wanted).toBe(0) // transient
    expect(res.weapon).toBeNull() // transient
  })

  test('12 — arrest & incapacitation recovery restore a safe, full-health player', async ({
    page,
  }) => {
    await freshGame(page)
    // Arrest recovery: bounded penalty, health restored, wanted cleared.
    const arrest = await page.evaluate(() => {
      const api = window.GAME_TEST_API!
      const moneyBefore = api.getStats().money
      api.setWantedLevel(2)
      api.respawnPlayer('arrest')
      return {
        moneyBefore,
        moneyAfter: api.getStats().money,
        health: api.getPlayerHealth().health,
        wanted: api.getWantedState().level,
        recovery: api.getRecoveryState(),
      }
    })
    expect(arrest.health).toBe(100)
    expect(arrest.wanted).toBe(0)
    expect(arrest.moneyAfter).toBeLessThanOrEqual(arrest.moneyBefore)
    expect(arrest.recovery.active).toBe(true)

    // Incapacitation: health 0 → auto-recovers to full.
    await page.evaluate(() => window.GAME_TEST_API!.setPlayerHealth(0))
    await page.waitForFunction(
      () => window.GAME_TEST_API!.getPlayerHealth().health === 100,
      undefined,
      { timeout: 5_000 },
    )
    expect((await page.evaluate(() => window.GAME_TEST_API!.getPlayerHealth())).incapacitated).toBe(
      false,
    )
  })

  test('13 — police pursue a driving suspect over the road graph, not through blocks', async ({
    page,
  }) => {
    await freshGame(page)
    const res = await page.evaluate(async () => {
      const api = window.GAME_TEST_API!
      // Become a driving suspect on a road, then trigger an armed response.
      api.stealVehicle('theft_parked_plaza') // mode → driving, on a road spot
      api.setWantedLevel(3)
      api.spawnPoliceResponse(2)
      const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))
      await sleep(5000) // let cruisers plan road routes + pursue
      const units = api.getPoliceUnits()
      return {
        count: units.length,
        routes: units.map((u) => ({
          route: api.getPoliceRouteState(u.id),
          roadDist: api.getNearestRoadDistance(u.position[0], u.position[1]),
        })),
        metrics: api.getPoliceRouteMetrics(),
      }
    })
    // At least one cruiser planned a real road-graph route toward the suspect.
    const routed = res.routes.filter((r) => r.route && r.route.segmentIds.length > 0)
    expect(routed.length).toBeGreaterThan(0)
    expect(routed[0].route!.mode).toMatch(/intercept|respond|follow/)
    // Cruisers stay on the road network (never cutting straight through blocks).
    for (const r of res.routes) expect(r.roadDist).toBeLessThan(12)
    // Replanning happened but is bounded (event/cadence, not per frame): a few
    // seconds of pursuit yields a small number of replans per unit.
    expect(res.metrics.totalReplans).toBeGreaterThan(0)
    expect(res.metrics.totalReplans).toBeLessThan(60)
  })

  test('14 — a cruiser that reaches an on-foot suspect puts an officer on the street', async ({
    page,
  }) => {
    await freshGame(page)
    const [px, pz] = await playerXZ(page)
    await page.evaluate(
      ([x, z]) => {
        const api = window.GAME_TEST_API!
        api.spawnPoliceResponse(2)
        // Drive a cruiser right up to the on-foot suspect so the live director's
        // dismount pass fires (suspect is on foot in a fresh game).
        const cruiser = api.getPoliceCruisers()[0]
        api.teleportPoliceUnit(cruiser.id, x + 4, z)
      },
      [px, pz],
    )
    // The live PoliceUnits driver runs the dismount pass and spawns an officer.
    await page.waitForFunction(() => window.GAME_TEST_API!.getPoliceCounts().officers >= 1, undefined, {
      timeout: 8_000,
    })
    const res = await page.evaluate(() => {
      const api = window.GAME_TEST_API!
      const officer = api.getPoliceOfficers()[0]
      const cruiser = api.getPoliceCruisers().find((c) => c.id === officer.cruiserId)!
      return {
        officer,
        exitDist: Math.hypot(
          officer.position[0] - cruiser.position[0],
          officer.position[1] - cruiser.position[1],
        ),
        cruiserHasOfficers: cruiser.hasOfficers,
      }
    })
    // A real, separate actor: linked to its cruiser, on foot, full health.
    expect(res.officer.cruiserId).toBeTruthy()
    expect(res.officer.state).toBe('pursuing_on_foot')
    expect(res.officer.health).toBe(100)
    expect(res.cruiserHasOfficers).toBe(true)
    // Stepped out curbside (offset + avoidance nudge), not teleported far.
    expect(res.exitDist).toBeLessThan(8)
  })

  test('15 — officers are one-per-cruiser, capped, and ride down when wanted clears', async ({
    page,
  }) => {
    await freshGame(page)
    const [px, pz] = await playerXZ(page)
    await page.evaluate(
      ([x, z]) => {
        const api = window.GAME_TEST_API!
        api.spawnPoliceResponse(3) // L3 → 3 cruisers, officer cap 6
        // Surround the on-foot suspect with every cruiser so each can dismount.
        api.getPoliceCruisers().forEach((c, i) => {
          api.teleportPoliceUnit(c.id, x + 4 + i, z + (i - 1))
        })
      },
      [px, pz],
    )
    // Each cruiser dismounts exactly one officer → officers === cruisers (3),
    // never more even though the L3 officer cap is 6.
    await page.waitForFunction(() => window.GAME_TEST_API!.getPoliceCounts().officers >= 3, undefined, {
      timeout: 8_000,
    })
    const before = await page.evaluate(() => {
      const api = window.GAME_TEST_API!
      const officers = api.getPoliceOfficers()
      return {
        counts: api.getPoliceCounts(),
        distinctCruisers: new Set(officers.map((o) => o.cruiserId)).size,
      }
    })
    expect(before.counts.officers).toBe(3) // one per cruiser, not the cap of 6
    expect(before.distinctCruisers).toBe(3)
    // Clearing wanted drains the whole fleet — cruisers AND their officers.
    await page.evaluate(() => window.GAME_TEST_API!.clearWanted())
    await page.waitForFunction(
      () => {
        const c = window.GAME_TEST_API!.getPoliceCounts()
        return c.officers === 0 && c.vehicles === 0
      },
      undefined,
      { timeout: 6_000 },
    )
  })

  test('16 — a quest NPC (Ravi) flees gunfire then recovers toward his anchor', { tag: '@simulation-only' }, async ({
    page,
  }) => {
    await freshGame(page)
    const RAVI = 'npc_ravi_01'
    // Fix the hour so Ravi's idle anchor is deterministic ([-8.5,-5] at 08:00),
    // and stand to his SOUTH-WEST so the gunshot makes him flee NORTH-EAST into
    // the open plaza (not into the café/apartment wall). Mark the quest as
    // mid-delivery to prove it survives the crime.
    const anchor = await page.evaluate((id) => {
      const api = window.GAME_TEST_API!
      api.setTime(8)
      api.teleportPlayer([-14, 1.2, -9])
      api.setQuestState('coffee_for_ravi', 'has_coffee')
      return api.getNpcPosition(id)
    }, RAVI)
    expect(anchor).not.toBeNull()

    // Fire near Ravi: he is a bystander (panic) but never a target (invulnerable).
    await page.evaluate((id) => {
      const api = window.GAME_TEST_API!
      api.givePlayerWeapon('handgun')
      const p = api.getNpcPosition(id)!
      api.firePlayerWeaponAt(p[0], p[2])
    }, RAVI)

    // He panics immediately, and the quest state is untouched by the crime.
    const afterShot = await page.evaluate((id) => {
      const api = window.GAME_TEST_API!
      return {
        panicking: api.isNpcPanicking(id),
        quest: api.getStats().questStates['coffee_for_ravi'],
      }
    }, RAVI)
    expect(afterShot.panicking).toBe(true)
    expect(afterShot.quest).toBe('has_coffee')

    // He flees away from the threat (distance from his anchor grows).
    const anchorXZ: [number, number] = [anchor![0], anchor![2]]
    await page.waitForFunction(
      ([id, ax, az]) => {
        const p = window.GAME_TEST_API!.getNpcPosition(id as string)
        if (!p) return false
        return Math.hypot(p[0] - (ax as number), p[2] - (az as number)) > 2
      },
      [RAVI, anchorXZ[0], anchorXZ[1]] as const,
      { timeout: 15_000 },
    )

    // Recovery: the panic window expires on its own (no external reset)…
    await page.waitForFunction(
      (id) => !window.GAME_TEST_API!.isNpcPanicking(id as string),
      RAVI,
      { timeout: 20_000 },
    )
    const fledDist = await page.evaluate(
      ([id, ax, az]) => {
        const p = window.GAME_TEST_API!.getNpcPosition(id as string)!
        return Math.hypot(p[0] - (ax as number), p[2] - (az as number))
      },
      [RAVI, anchorXZ[0], anchorXZ[1]] as const,
    )
    // …and his routine walks him back toward the anchor — quest giver reachable
    // again, so Coffee-for-Ravi stays completable across the crime.
    await page.waitForFunction(
      ([id, ax, az, was]) => {
        const p = window.GAME_TEST_API!.getNpcPosition(id as string)
        if (!p) return false
        return Math.hypot(p[0] - (ax as number), p[2] - (az as number)) < (was as number)
      },
      [RAVI, anchorXZ[0], anchorXZ[1], fledDist] as const,
      { timeout: 20_000 },
    )
    // The quest survived the whole episode intact.
    const finalQuest = await page.evaluate(
      () => window.GAME_TEST_API!.getStats().questStates['coffee_for_ravi'],
    )
    expect(finalQuest).toBe('has_coffee')
  })

  test('17 — you cannot duck into your apartment during a pursuit', async ({ page }) => {
    await freshGame(page)
    const res = await page.evaluate(() => {
      const api = window.GAME_TEST_API!
      api.setWantedLevel(2)
      api.enterApartment()
      const blocked = api.getLocationMode() // still on the street
      api.clearWanted()
      api.enterApartment()
      const allowed = api.getLocationMode() // now home is fine
      return { blocked, allowed }
    })
    expect(res.blocked).toBe('city')
    expect(res.allowed).toBe('apartment')
  })

  test('18 — a pursuit survives crossing sector boundaries (streaming)', async ({ page }) => {
    await freshGame(page)
    const before = await page.evaluate(() => {
      const api = window.GAME_TEST_API!
      api.setWantedLevel(2)
      api.spawnPoliceResponse(2)
      return {
        sector: api.getCurrentSectorId(),
        police: api.getPoliceUnits().length,
        wanted: api.getWantedState().level,
      }
    })
    expect(before.police).toBe(2)
    expect(before.wanted).toBe(2)

    // Teleport to a far district — forces sector stream-out/in around the player.
    await page.evaluate(() => window.GAME_TEST_API!.teleportTo('main_street_north'))
    await page.waitForFunction(
      (prev) => window.GAME_TEST_API!.getCurrentSectorId() !== prev,
      before.sector,
      { timeout: 15_000 },
    )

    // The police runtime is a module singleton mounted at the app root, so the
    // pursuit persists across streaming: units and wanted survive the crossing.
    const after = await page.evaluate(() => {
      const api = window.GAME_TEST_API!
      return {
        sector: api.getCurrentSectorId(),
        police: api.getPoliceUnits().length,
        wanted: api.getWantedState().level,
      }
    })
    expect(after.sector).not.toBe(before.sector)
    expect(after.police).toBe(2)
    expect(after.wanted).toBe(2)
  })
})
