import { expect, test } from '@playwright/test'
import { acquireDrivableCar, getStats, gotoGame, teleport } from './helpers'

/**
 * Traffic v2 E2E: signal-controlled crossings, vehicle-vs-vehicle following,
 * and no-overlap guarantees. Scenarios are staged through the dev/test API
 * (signal phase control + agent repositioning) for determinism.
 */
test.describe('traffic', () => {
  test('an ambient car brakes for the player instead of driving through them', { tag: '@simulation-only' }, async ({
    page,
  }) => {
    test.slow()
    await gotoGame(page)

    // Deterministic staging (issue #32). This scenario used to teleport the player
    // beside wherever the routed ambient car happened to be after boot: resetGame()
    // does NOT reset ambient route/position, so CI measured an already-adjacent car
    // at sample 0 (0.300-1.799 units) instead of a braking approach. Stage the exact
    // car upstream and place the player in ONE operation, then wait on STATE.
    const CAR = 'vehicle_ambient_car_01' // a crossDistrict RoutedCar on the inner ring
    const LANE_Z = -24.6
    await page.evaluate(
      ([car, z]) => {
        const api = window.GAME_TEST_API!
        api.resetGame()
        api.setSignalPhase('vehicle_green')
        // Routed car: position only - `targetIndex` is loop-car state, unused here.
        api.setAmbientCarPosition(car as string, [-10, z as number])
        api.teleportPlayer([0, 1.2, z as number])
      },
      [CAR, LANE_Z] as const,
    )

    // Preconditions before measuring: the player is on foot at the crossing, the car
    // consumed its override onto the expected eastbound segment and is still safely
    // upstream, and the crossing reads occupied.
    await page.waitForFunction(
      ([car, z]) => {
        const api = window.GAME_TEST_API!
        const stats = api.getStats()
        const traffic = api.getTrafficState()
        const c = traffic.cars.find((x) => x.id === car)
        const route = api.getVehicleRouteState(car as string)
        const cw = traffic.crosswalks.find((x) => x.id === 'crosswalk_north')
        if (!c || !route || !cw) return false
        return (
          stats.mode === 'walking' &&
          Math.hypot(stats.position[0], stats.position[2] - (z as number)) < 0.25 &&
          Math.abs(c.position[1] - (z as number)) < 1.5 &&
          c.position[0] <= -8 &&
          Math.sin(c.heading) > 0.9 &&
          route.currentSegmentId === 'ring_in_n_a' &&
          cw.occupied
        )
      },
      [CAR, LANE_Z] as const,
      { timeout: 20_000 },
    )

    let minDistance = Infinity
    let approached = false
    let yieldedForPlayer = false
    let closest: Record<string, unknown> | null = null
    let yieldSample: Record<string, unknown> | null = null
    for (let i = 0; i < 50; i++) {
      const s = await page.evaluate((car) => {
        const api = window.GAME_TEST_API!
        const stats = api.getStats()
        const me = stats.position
        const pos = api.getAmbientCarPositions()[car]
        const traffic = api.getTrafficState()
        const c = traffic.cars.find((x) => x.id === car)
        return {
          car,
          d: pos ? Math.hypot(pos[0] - me[0], pos[2] - me[2]) : Infinity,
          carPos: pos ? [pos[0], pos[2]] : null,
          heading: c?.heading ?? null,
          speed: c?.speed ?? null,
          targetSpeed: c?.targetSpeed ?? null,
          state: c?.state ?? null,
          reason: c?.reason ?? null,
          segment: api.getVehicleRouteState(car)?.currentSegmentId ?? null,
          playerMode: stats.mode,
          playerPos: [me[0], me[2]],
          crosswalkOccupied:
            traffic.crosswalks.find((x) => x.id === 'crosswalk_north')?.occupied ?? null,
        }
      }, CAR)
      if (s.d < minDistance) {
        minDistance = s.d
        closest = s
      }
      if (s.d < 6) approached = true
      // A stop only counts when it is CAUSED by the on-foot player or the occupied
      // crossing. An unrelated `signal` / `follow` / `stop_sign` stop must never
      // satisfy this scenario. Both causal reasons are legitimate here: depending on
      // exactly where the staged player registers, the decision reports the crossing
      // occupant (`crosswalk`) or the corridor point obstacle (`obstacle`).
      if (
        !yieldedForPlayer &&
        s.speed !== null &&
        s.speed < 0.2 &&
        s.targetSpeed === 0 &&
        (s.reason === 'crosswalk' || s.reason === 'obstacle')
      ) {
        yieldedForPlayer = true
        yieldSample = s
      }
      if (approached && i > 40) break
      await page.waitForTimeout(200)
    }
    // Bounded failure observability: identify the staged car and its decision.
    if (!approached || minDistance <= 1.8 || !yieldedForPlayer) {
      console.log(
        'TRAFFIC_BRAKE_DIAG ' +
          JSON.stringify({ minDistance, approached, yieldedForPlayer, closest, yieldSample }),
      )
    }
    expect(approached, 'the staged car should have approached the player').toBe(true)
    expect(minDistance, 'car overlapped the player').toBeGreaterThan(1.8)
    expect(
      yieldedForPlayer,
      'the staged car must stop/yield BECAUSE of the on-foot player or the occupied crossing ' +
        '(reason crosswalk|obstacle) — an unrelated signal/follow/stop_sign stop does not count',
    ).toBe(true)

    // Step out of the road on a green: the SAME staged car gets moving again.
    const before = await page.evaluate(
      (car) => window.GAME_TEST_API!.getAmbientCarPositions()[car],
      CAR,
    )
    await teleport(page, [0, 1.2, -10])
    // People are solid now, so pedestrians deflected around the player can
    // take a moment to finish crossing - wait for the crosswalk to actually
    // clear (the car correctly keeps yielding until then), then expect motion.
    await page.waitForFunction(
      () =>
        window.GAME_TEST_API!.getTrafficState().crosswalks.find(
          (c) => c.id === 'crosswalk_north',
        )?.occupied === false,
      undefined,
      { timeout: 20_000 },
    )
    await page.evaluate(() => window.GAME_TEST_API!.setSignalPhase('vehicle_green'))
    await page.waitForTimeout(3000)
    const after = await page.evaluate(
      (car) => window.GAME_TEST_API!.getAmbientCarPositions()[car],
      CAR,
    )
    const moved = Math.hypot(after[0] - before[0], after[2] - before[2])
    expect(moved, 'car should resume once the road clears').toBeGreaterThan(2)
  })

  test('ambient car follows the driven car without ever overlapping it', { tag: '@simulation-only' }, async ({ page }) => {
    test.slow()
    const errors: string[] = []
    page.on('pageerror', (err) => errors.push(String(err)))
    await gotoGame(page)
    await page.evaluate(() => window.GAME_TEST_API!.resetGame())
    await acquireDrivableCar(page) // §19: own an active Compact shell (no free car on a new game)

    // Get in the car, park it in the eastbound inner lane, facing east.
    await teleport(page, [13, 1.2, 14])
    await page.waitForFunction(
      () => window.GAME_TEST_API!.getStats().activeInteractableId === 'vehicle_compact_car_01',
    )
    await page.keyboard.press('e')
    await page.waitForTimeout(200)
    expect((await getStats(page)).mode).toBe('driving')
    await page.evaluate(() => {
      const api = window.GAME_TEST_API!
      api.setDrivenCarPosition([6, -24.6], Math.PI / 2)
      api.setSignalPhase('vehicle_green')
      api.setAmbientCarPosition('vehicle_ambient_car_01', [-10, -24.6], 1)
    })

    // The ambient car closes in, then holds behind the parked driven car.
    await page.waitForFunction(
      () => {
        const c = window.GAME_TEST_API!.getTrafficState().cars.find(
          (x) => x.id === 'vehicle_ambient_car_01',
        )!
        return c.reason === 'follow' && c.targetSpeed === 0 && c.speed < 0.35
      },
      undefined,
      { timeout: 20_000 },
    )

    // Poll for a while: never any vehicle-vehicle footprint overlap, and the
    // blocked timer accrues toward a honk while waiting behind the player.
    let maxBlocked = 0
    for (let i = 0; i < 20; i++) {
      const [overlaps, blocked] = await page.evaluate(() => {
        const api = window.GAME_TEST_API!
        return [
          api.assertNoVehicleVehicleOverlaps(),
          api.getTrafficState().cars.find((c) => c.id === 'vehicle_ambient_car_01')!.blockedTime,
        ] as const
      })
      expect(overlaps, 'vehicle footprints overlapped').toEqual([])
      maxBlocked = Math.max(maxBlocked, blocked as number)
      await page.waitForTimeout(200)
    }
    expect(maxBlocked, 'blocked timer should build toward a honk').toBeGreaterThan(2.5)
    expect(errors).toEqual([])
  })

  test('cars stop at red and proceed on green', { tag: '@simulation-only' }, async ({ page }) => {
    test.slow()
    await gotoGame(page)
    await page.evaluate(() => {
      const api = window.GAME_TEST_API!
      api.resetGame()
      api.teleportPlayer([15, 1.2, 15]) // out of the way
      api.setSignalPhase('pedestrian_walk') // vehicles: red
      api.setAmbientCarPosition('vehicle_ambient_car_01', [-12, -24.6], 1)
    })

    // Car halts at the stop line (x = -3.6), before the crosswalk zone.
    await page.waitForFunction(
      () => {
        const c = window.GAME_TEST_API!.getTrafficState().cars.find(
          (x) => x.id === 'vehicle_ambient_car_01',
        )!
        return c.reason === 'signal' && c.speed < 0.35
      },
      undefined,
      { timeout: 15_000 },
    )
    const held = await page.evaluate(
      () =>
        window.GAME_TEST_API!.getTrafficState().cars.find(
          (c) => c.id === 'vehicle_ambient_car_01',
        )!.position,
    )
    expect(held[0], 'car must stop before the crosswalk zone').toBeLessThan(-1.7)

    // Green: it clears the intersection. (Walk lasts 7s; jump straight to green.)
    await page.evaluate(() => window.GAME_TEST_API!.setSignalPhase('vehicle_green'))
    await page.waitForFunction(
      () =>
        window.GAME_TEST_API!.getTrafficState().cars.find(
          (c) => c.id === 'vehicle_ambient_car_01',
        )!.position[0] > 2,
      undefined,
      { timeout: 10_000 },
    )
  })

  test('signalled crossing: NPC waits on dont-walk, crosses on walk, car holds, then resumes', async ({
    page,
  }) => {
    test.slow()
    await gotoGame(page)
    await page.evaluate(() => {
      const api = window.GAME_TEST_API!
      api.resetGame()
      api.teleportPlayer([15, 1.2, 15])
      api.setSignalPhase('vehicle_green') // pedestrians: don't walk
      // Leo at the inner curb of the north crosswalk, aiming for the far side.
      api.setNpcPosition('npc_leo_01', [0, -22.2], 2)
    })

    // 1. Don't-walk holds him at the curb even with no traffic near.
    await page.waitForFunction(
      () => {
        const leo = window.GAME_TEST_API!.getTrafficState().pedestrians.find(
          (p) => p.id === 'npc_leo_01',
        )
        return leo?.state === 'waiting_to_cross' && leo.waitingAtCrosswalkId === 'crosswalk_north'
      },
      undefined,
      { timeout: 10_000 },
    )
    // Hold through a couple more seconds of green: still waiting.
    await page.waitForTimeout(1500)
    expect(
      (await page.evaluate(() => window.GAME_TEST_API!.getTrafficState())).pedestrians.find(
        (p) => p.id === 'npc_leo_01',
      )!.state,
    ).toBe('waiting_to_cross')

    // 2. Walk phase: he commits; an approaching car is held by the red.
    await page.evaluate(() => {
      const api = window.GAME_TEST_API!
      api.setAmbientCarPosition('vehicle_ambient_car_01', [-12, -24.6], 1)
      api.setSignalPhase('pedestrian_walk')
    })
    await page.waitForFunction(
      () =>
        window.GAME_TEST_API!.getTrafficState().pedestrians.find((p) => p.id === 'npc_leo_01')
          ?.state === 'crossing',
      undefined,
      { timeout: 10_000 },
    )
    const during = await page.evaluate(() => window.GAME_TEST_API!.getTrafficState())
    expect(during.crosswalks.find((c) => c.id === 'crosswalk_north')!.occupied).toBe(true)

    // 3. He clears; green returns; the car passes the crosswalk.
    await page.waitForFunction(
      () =>
        window.GAME_TEST_API!.getTrafficState().pedestrians.find((p) => p.id === 'npc_leo_01')
          ?.state !== 'crossing',
      undefined,
      { timeout: 15_000 },
    )
    await page.evaluate(() => window.GAME_TEST_API!.setSignalPhase('vehicle_green'))
    await page.waitForFunction(
      () =>
        window.GAME_TEST_API!.getTrafficState().cars.find(
          (c) => c.id === 'vehicle_ambient_car_01',
        )!.speed > 1.5,
      undefined,
      { timeout: 10_000 },
    )
  })

  test('Officer Kim uses the west crosswalk with signal etiquette', { tag: '@simulation-only' }, async ({ page }) => {
    test.slow()
    await gotoGame(page)
    await page.evaluate(() => {
      const api = window.GAME_TEST_API!
      api.resetGame()
      api.teleportPlayer([15, 1.2, 15])
      api.setSignalPhase('vehicle_green')
      // Kim at the outer curb of the west crosswalk, heading for the inner side
      // (routine index 10 = [-22.2, 0] since the residential leg was added).
      api.setNpcPosition('npc_kim_01', [-29.8, 0], 10)
    })

    await page.waitForFunction(
      () => {
        const kim = window.GAME_TEST_API!.getTrafficState().pedestrians.find(
          (p) => p.id === 'npc_kim_01',
        )
        return kim?.state === 'waiting_to_cross' && kim.waitingAtCrosswalkId === 'crosswalk_west'
      },
      undefined,
      { timeout: 10_000 },
    )

    await page.evaluate(() => window.GAME_TEST_API!.setSignalPhase('pedestrian_walk'))
    await page.waitForFunction(
      () =>
        window.GAME_TEST_API!.getTrafficState().pedestrians.find((p) => p.id === 'npc_kim_01')
          ?.state === 'crossing',
      undefined,
      { timeout: 10_000 },
    )
    // She finishes and resumes her beat; nothing ever overlapped her.
    await page.waitForFunction(
      () =>
        window.GAME_TEST_API!.getTrafficState().pedestrians.find((p) => p.id === 'npc_kim_01')
          ?.state !== 'crossing',
      undefined,
      { timeout: 15_000 },
    )
    const overlaps = await page.evaluate(() =>
      window.GAME_TEST_API!.assertNoVehicleVehicleOverlaps(),
    )
    expect(overlaps).toEqual([])
  })
})
