import { expect, test, type Page } from '@playwright/test'
import { gotoGame } from './helpers'

/**
 * Live Pedestrian Crossings v1 at Harbor Cross. The signal clock is pinned
 * with setIntersectionElapsed; phases then advance naturally from there.
 * Cycle: greens 0-36 (all dont_walk), walk_all 36-44, clear_walk 44-46.
 */

const X = 's0_-2_harbor_cross'
const HARBOR_CITIZENS = [
  'cit_hc_loop_cw',
  'cit_hc_loop_ccw',
  'cit_hc_south_shuttle',
  'cit_hc_east_shuttle',
  'cit_hc_west_shuttle',
  'cit_hc_north_shuttle',
]

/** Player near the box puts the gateway cell in FULL simulation. */
async function arriveAtHarborCross(page: Page) {
  await page.evaluate(() => {
    const api = window.GAME_TEST_API!
    api.resetGame()
    api.setTime(10)
    api.setTrafficRoutingSeed(1)
    api.teleportTo('harbor_cross')
  })
  await page.waitForFunction(
    () => {
      const s = window.GAME_TEST_API!.getSectorState('s0_-1')
      return s?.lifecycle === 'active' && s.visualsReady && s.collidersReady
    },
    undefined,
    { timeout: 20_000 },
  )
  await page.waitForFunction(
    () => {
      const s = window.GAME_TEST_API!.getSectorState('s0_-2')
      return s !== null && s !== undefined && s.collidersReady
    },
    undefined,
    { timeout: 20_000 },
  )
}

test.describe('live pedestrian crossings at Harbor Cross', () => {
  test('citizens queue at the curb through the vehicle phases and never enter on dont_walk', async ({
    page,
  }) => {
    test.setTimeout(150_000)
    const errors: string[] = []
    page.on('pageerror', (err) => errors.push(String(err)))
    await gotoGame(page)
    await arriveAtHarborCross(page)
    // Pin to the start of the vehicle sequence: 36 straight seconds of
    // dont_walk. Give committed crossers time to clear, then hold.
    await page.evaluate(() => window.GAME_TEST_API!.setIntersectionElapsed(0.5))
    await page.waitForFunction(
      (id) =>
        window.GAME_TEST_API!.getCrossingPedestrians(id as string).every((c) => !c.occupied),
      X,
      { timeout: 25_000 },
    )
    await page.evaluate(() => window.GAME_TEST_API!.setIntersectionElapsed(0.5))
    // Within the dont_walk window at least one curb queues…
    await page.waitForFunction(
      (id) =>
        window.GAME_TEST_API!.getCrossingPedestrians(id as string).some(
          (c) => c.queued.length > 0,
        ),
      X,
      { timeout: 30_000 },
    )
    // …and for a sustained stretch NOBODY starts crossing.
    for (let i = 0; i < 5; i++) {
      await page.waitForTimeout(1_500)
      const view = await page.evaluate(
        (id) => window.GAME_TEST_API!.getCrossingPedestrians(id as string),
        X,
      )
      for (const c of view) {
        expect(c.walkSignal, c.crossingId).toBe('dont_walk')
        expect(c.crossing, `${c.crossingId} entered on dont_walk`).toEqual([])
      }
    }
    const queued = await page.evaluate((id) => {
      const api = window.GAME_TEST_API!
      return api.getCrossingPedestrians(id as string).flatMap((c) => c.queued)
    }, X)
    for (const id of queued) {
      const state = await page.evaluate(
        (cid) => window.GAME_TEST_API!.getPedestrianCrossingState(cid as string),
        id,
      )
      expect(state!.state).toBe('waiting_to_cross')
    }
    expect(errors).toEqual([])
  })

  test('all-walk releases the curbs: citizens cross while every approach holds red', async ({
    page,
  }) => {
    test.setTimeout(150_000)
    await gotoGame(page)
    await arriveAtHarborCross(page)
    // Build queues through the vehicle sequence…
    await page.evaluate(() => window.GAME_TEST_API!.setIntersectionElapsed(20))
    await page.waitForFunction(
      (id) =>
        window.GAME_TEST_API!.getCrossingPedestrians(id as string).reduce(
          (sum, c) => sum + c.queued.length,
          0,
        ) >= 2,
      X,
      { timeout: 30_000 },
    )
    // …then open the walk phase and watch them commit.
    await page.evaluate(() => window.GAME_TEST_API!.setIntersectionElapsed(36.5))
    await page.waitForFunction(
      (id) =>
        window.GAME_TEST_API!.getCrossingPedestrians(id as string).some(
          (c) => c.crossing.length > 0,
        ),
      X,
      { timeout: 8_000 },
    )
    const during = await page.evaluate((id) => {
      const api = window.GAME_TEST_API!
      return {
        crossings: api.getCrossingPedestrians(id as string),
        permissions: (['south', 'north', 'east', 'west'] as const).map((a) =>
          api.getMovementPermission(id as string, a),
        ),
      }
    }, X)
    expect(during.permissions).toEqual(['red', 'red', 'red', 'red'])
    const active = during.crossings.filter((c) => c.crossing.length > 0 || c.occupied)
    expect(active.length).toBeGreaterThanOrEqual(1)
  })

  test('a green-approach car holds for an occupied crossing, then proceeds once it clears', async ({
    page,
  }) => {
    test.setTimeout(180_000)
    await gotoGame(page)
    await arriveAtHarborCross(page)
    await page.evaluate(() => {
      const api = window.GAME_TEST_API!
      // Freeze a pedestrian mid-way across the SOUTH crossing, then give the
      // south approach green: the car's light says go, the occupied zone
      // says stop — crosswalk etiquette must win.
      api.forceCitizenToCrossing('cit_hc_south_shuttle', 's0_-2_harbor_cross_cross_south', 0.5)
      api.setIntersectionElapsed(0.5) // green_south
      api.teleportAmbientVehicleToSegment('vehicle_ambient_car_01', 's0_-2_boulevard_fwd', 0.8)
      api.forceVehicleDestination('vehicle_ambient_car_01', 'dest_s0_-2_promenade')
    })
    // The car halts short of the crossing band (stop line z = -150.6).
    await page.waitForFunction(() => {
      const api = window.GAME_TEST_API!
      const car = api.getTrafficState().cars.find((c) => c.id === 'vehicle_ambient_car_01')
      return car !== undefined && car.speed < 0.2 && car.position[1] > -152.5
    }, undefined, { timeout: 30_000 })
    const held = await page.evaluate(() => {
      const api = window.GAME_TEST_API!
      const car = api.getTrafficState().cars.find((c) => c.id === 'vehicle_ambient_car_01')!
      const route = api.getVehicleRouteState('vehicle_ambient_car_01')!
      return { reason: car.reason, stage: route.recoveryStage, replans: route.replanCount }
    })
    expect(held.reason).toBe('crosswalk')
    expect(held.stage).toBe(0)
    // Walk the pedestrian OFF the crossing (curb anchor), confirm the zone
    // reads clear, then re-green: the car proceeds with its route intact.
    await page.evaluate(() =>
      window.GAME_TEST_API!.forceCitizenToCrossing(
        'cit_hc_south_shuttle',
        's0_-2_harbor_cross_cross_south',
        0,
      ),
    )
    await page.waitForFunction(
      (id) =>
        window.GAME_TEST_API!.getCrossingPedestrians(id as string).every((c) => !c.occupied),
      X,
      { timeout: 20_000 },
    )
    await page.evaluate(() => window.GAME_TEST_API!.setIntersectionElapsed(0.5))
    await page.waitForFunction(
      () => {
        const car = window.GAME_TEST_API!
          .getTrafficState()
          .cars.find((c) => c.id === 'vehicle_ambient_car_01')
        return car !== undefined && car.position[1] < -166
      },
      undefined,
      { timeout: 40_000 },
    )
    const after = await page.evaluate(
      () => window.GAME_TEST_API!.getVehicleRouteState('vehicle_ambient_car_01')!,
    )
    expect(after.replanCount).toBe(held.replans)
    expect(after.recoveryStage).toBe(0)
  })

  test('two crossings operate simultaneously without conflicts', async ({ page }) => {
    test.setTimeout(120_000)
    await gotoGame(page)
    await arriveAtHarborCross(page)
    await page.evaluate(() => {
      const api = window.GAME_TEST_API!
      api.setIntersectionElapsed(37) // walk_all
      api.forceCitizenToCrossing('cit_hc_south_shuttle', 's0_-2_harbor_cross_cross_south', 0.4)
      api.forceCitizenToCrossing('cit_hc_east_shuttle', 's0_-2_harbor_cross_cross_east', 0.6)
    })
    await page.waitForTimeout(800)
    const view = await page.evaluate((id) => {
      const api = window.GAME_TEST_API!
      return {
        crossings: api.getCrossingPedestrians(id as string),
        permissions: (['south', 'north', 'east', 'west'] as const).map((a) =>
          api.getMovementPermission(id as string, a),
        ),
        overlaps: api.assertNoVehicleVehicleOverlaps(),
      }
    }, X)
    const occupied = view.crossings.filter((c) => c.occupied).map((c) => c.crossingId)
    expect(occupied).toContain('s0_-2_harbor_cross_cross_south')
    expect(occupied).toContain('s0_-2_harbor_cross_cross_east')
    expect(view.permissions).toEqual(['red', 'red', 'red', 'red'])
    expect(view.overlaps).toEqual([])
  })

  test('the on-foot player inside a crossing gets the same vehicle yield', async ({ page }) => {
    test.setTimeout(150_000)
    await gotoGame(page)
    await arriveAtHarborCross(page)
    await page.evaluate(() => {
      const api = window.GAME_TEST_API!
      api.setIntersectionElapsed(0.5) // green_south — the light says GO
      api.teleportPlayer([48, 1.2, -152.9]) // standing mid-crossing (south)
      api.teleportAmbientVehicleToSegment('vehicle_ambient_car_01', 's0_-2_boulevard_fwd', 0.8)
      api.forceVehicleDestination('vehicle_ambient_car_01', 'dest_s0_-2_promenade')
    })
    await page.waitForFunction(() => {
      const api = window.GAME_TEST_API!
      const car = api.getTrafficState().cars.find((c) => c.id === 'vehicle_ambient_car_01')
      return car !== undefined && car.speed < 0.2 && car.position[1] > -152.5
    }, undefined, { timeout: 30_000 })
    const held = await page.evaluate(() => {
      const car = window.GAME_TEST_API!
        .getTrafficState()
        .cars.find((c) => c.id === 'vehicle_ambient_car_01')!
      return car.reason
    })
    expect(held).toBe('crosswalk')
    // Step aside: the car passes.
    await page.evaluate(() => {
      window.GAME_TEST_API!.teleportPlayer([55, 1.2, -150])
      window.GAME_TEST_API!.setIntersectionElapsed(0.5)
    })
    await page.waitForFunction(
      () => {
        const car = window.GAME_TEST_API!
          .getTrafficState()
          .cars.find((c) => c.id === 'vehicle_ambient_car_01')
        return car !== undefined && car.position[1] < -166
      },
      undefined,
      { timeout: 40_000 },
    )
  })

  test('sector unload/reload never duplicates, loses, or strands the crossing crowd', async ({
    page,
  }) => {
    test.setTimeout(150_000)
    await gotoGame(page)
    await arriveAtHarborCross(page)
    const before = await page.evaluate((ids) => {
      const api = window.GAME_TEST_API!
      return (ids as string[]).filter((id) => api.getPedestrianCrossingState(id) !== null).length
    }, HARBOR_CITIZENS)
    expect(before).toBe(6)
    // Step out, force the cell down and back up.
    await page.evaluate(() => window.GAME_TEST_API!.teleportTo('central_plaza'))
    await page.waitForTimeout(1_500)
    await page.evaluate(() => window.GAME_TEST_API!.forceUnloadSector('s0_-1'))
    await page.waitForFunction(
      () => window.GAME_TEST_API!.getSectorState('s0_-1')?.lifecycle === 'unloaded',
      undefined,
      { timeout: 25_000 },
    )
    await page.evaluate(() => {
      window.GAME_TEST_API!.forceLoadSector('s0_-1')
      window.GAME_TEST_API!.clearForcedSectors()
    })
    await arriveAtHarborCross(page)
    const after = await page.evaluate((ids) => {
      const api = window.GAME_TEST_API!
      const states = (ids as string[]).map((id) => api.getPedestrianCrossingState(id))
      return {
        present: states.filter((s) => s !== null).length,
        registrySize: api.getAmbientCitizens().length,
        crossings: api.getCrossingPedestrians('s0_-2_harbor_cross').length,
      }
    }, HARBOR_CITIZENS)
    expect(after.present).toBe(6) // no duplicates, no losses
    expect(after.registrySize).toBe(90)
    expect(after.crossings).toBe(4)
  })

  test('130s mixed soak: overlaps zero, nobody stranded, no deadlock, no replan storm', async ({
    page,
  }) => {
    test.setTimeout(260_000)
    const errors: string[] = []
    page.on('pageerror', (err) => errors.push(String(err)))
    await gotoGame(page)
    await arriveAtHarborCross(page)
    await page.evaluate(() => {
      const api = window.GAME_TEST_API!
      const routed = api.getAllVehicleRouteStates().map((s) => s.vehicleId)
      const targets = ['dest_s0_-2_harbor_east', 'dest_s0_-2_harbor_west', 'dest_s0_-2_promenade']
      targets.forEach((dest, i) => api.forceVehicleDestination(routed[i % routed.length], dest))
    })
    const start = Date.now()
    let maxReplans = 0
    // Stranded detector: 'crossing' persisting across 3 samples (39s) is
    // longer than walk+clearance — a pedestrian stuck on the roadway.
    const crossingStreak: Record<string, number> = {}
    let lastCarPos = await page.evaluate(() =>
      Object.values(window.GAME_TEST_API!.getAmbientCarPositions()),
    )
    while (Date.now() - start < 130_000) {
      await page.waitForTimeout(13_000)
      const snap = await page.evaluate(
        ([ids, ix]) => {
          const api = window.GAME_TEST_API!
          return {
            overlaps: api.assertNoVehicleVehicleOverlaps(),
            cars: api.getAllVehicleRouteStates().map((s) => ({
              id: s.vehicleId,
              stage: s.recoveryStage,
              replans: s.replanCount,
            })),
            peds: (ids as string[]).map((id) => ({
              id,
              state: api.getPedestrianCrossingState(id)?.state ?? 'missing',
            })),
            view: api.getCrossingPedestrians(ix as string),
            positions: Object.values(api.getAmbientCarPositions()),
          }
        },
        [HARBOR_CITIZENS, X] as const,
      )
      expect(snap.overlaps).toEqual([])
      for (const car of snap.cars) {
        expect(car.stage, `${car.id} recovery stage`).toBeLessThan(3)
        maxReplans = Math.max(maxReplans, car.replans)
      }
      for (const ped of snap.peds) {
        expect(ped.state, ped.id).not.toBe('missing')
        crossingStreak[ped.id] = ped.state === 'crossing' ? (crossingStreak[ped.id] ?? 0) + 1 : 0
        expect(crossingStreak[ped.id], `${ped.id} stranded mid-crossing`).toBeLessThan(3)
      }
      const moved = snap.positions.reduce(
        (sum, p, i) =>
          sum + (lastCarPos[i] ? Math.hypot(p[0] - lastCarPos[i][0], p[2] - lastCarPos[i][2]) : 0),
        0,
      )
      expect(moved, 'fleet displacement per window').toBeGreaterThan(2)
      lastCarPos = snap.positions
    }
    expect(maxReplans).toBeLessThan(12)
    expect(errors).toEqual([])
  })
})
