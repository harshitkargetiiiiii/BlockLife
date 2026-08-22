import { expect, test, type Page } from '@playwright/test'
import { gotoGame } from './helpers'

/**
 * Crossing-Aware Citizen Destinations v1. Trips run on the pedestrian
 * graph; every road crossing goes through a registered CrosswalkZone
 * (Harbor Cross's signalized crossings or the three painted walk-crossings).
 * Trip citizens simulate fully while the player stands near Harbor Cross.
 */

const TRIP_CITIZENS = [
  'cit_g_plaza_stroller',
  'cit_dd_shopper_west',
  'cit_dd_waterfront_gazer',
  'cit_dd_yard_worker',
  'cit_dd_cafe_regular',
  'cit_dd_mart_regular',
  'cit_dd_bench_reader',
]

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
}

test.describe('crossing-aware citizen destinations', { tag: '@simulation-only' }, () => {
  test('boot: graph summary, destination catalog, deterministic trip states', async ({ page }) => {
    const errors: string[] = []
    page.on('pageerror', (err) => errors.push(String(err)))
    await gotoGame(page)
    const snap = await page.evaluate(() => {
      const api = window.GAME_TEST_API!
      return {
        graph: api.getPedestrianGraphSummary(),
        destinations: api.getCitizenDestinations(),
      }
    })
    expect(snap.graph.destinations).toBe(9)
    expect(snap.graph.crossings).toBe(7) // 4 signalized + 3 painted
    expect(snap.graph.nodes).toBeGreaterThanOrEqual(31)
    for (const d of snap.destinations) {
      expect(d.capacity, d.id).toBeGreaterThan(0)
      expect(d.occupancy, d.id).toBeLessThanOrEqual(d.capacity)
    }
    expect(errors).toEqual([])
  })

  test('a shopper is routed across Harbor Cross to a shop and makes progress', async ({ page }) => {
    test.setTimeout(120_000)
    await gotoGame(page)
    await arriveAtHarborCross(page)
    await page.waitForFunction(
      () => window.GAME_TEST_API!.forceCitizenDestination('cit_dd_shopper_west', 'pdest_s1_-2_s1'),
      undefined,
      { timeout: 15_000 },
    )
    const trip = await page.evaluate(
      () => window.GAME_TEST_API!.getCitizenTripState('cit_dd_shopper_west')!,
    )
    expect(trip.destinationId).toBe('pdest_s1_-2_s1')
    // The plan crosses Harbor Cross legally (west arm → east spine takes
    // TWO signalized crossings); the mart stays on the east side, so no
    // painted crossing is needed.
    const harborCrossings = trip.crossingIds.filter((c) => c.includes('harbor_cross'))
    expect(harborCrossings.length).toBeGreaterThanOrEqual(2)
    const startIndex = trip.waypointIndex
    await page.waitForFunction(
      (base) =>
        window.GAME_TEST_API!.getCitizenTripState('cit_dd_shopper_west')!.waypointIndex >
        (base as number),
      startIndex,
      { timeout: 60_000 },
    )
  })

  test('waits at the curb, crosses on all-walk, reaches the destination', async ({ page }) => {
    test.setTimeout(300_000)
    await gotoGame(page)
    await arriveAtHarborCross(page)
    await page.evaluate(() => {
      window.GAME_TEST_API!.setIntersectionElapsed(0.5)
      window.GAME_TEST_API!.forceCitizenDestination('cit_dd_shopper_west', 'pdest_prop_bench_g1')
    })
    // The route's first crossing is signalized: the citizen must QUEUE
    // through the vehicle phases…
    await page.waitForFunction(() => {
      const ped = window.GAME_TEST_API!.getPedestrianCrossingState('cit_dd_shopper_west')
      return ped?.state === 'waiting_to_cross' && (ped.crosswalkId ?? '').includes('harbor_cross')
    }, undefined, { timeout: 90_000 })
    // …never entering on dont_walk for a sustained stretch…
    await page.evaluate(() => window.GAME_TEST_API!.setIntersectionElapsed(0.5))
    for (let i = 0; i < 3; i++) {
      await page.waitForTimeout(1_200)
      const ped = await page.evaluate(
        () => window.GAME_TEST_API!.getPedestrianCrossingState('cit_dd_shopper_west')!,
      )
      expect(ped.state).toBe('waiting_to_cross')
    }
    // …then the all-walk releases the curb.
    await page.evaluate(() => window.GAME_TEST_API!.setIntersectionElapsed(36.5))
    await page.waitForFunction(
      () => window.GAME_TEST_API!.getPedestrianCrossingState('cit_dd_shopper_west')?.state === 'crossing',
      undefined,
      { timeout: 12_000 },
    )
    // And the trip ends AT the bench with the occupancy slot held.
    await page.waitForFunction(
      () =>
        window.GAME_TEST_API!.getCitizenTripState('cit_dd_shopper_west')?.phase ===
        'performing_activity',
      undefined,
      { timeout: 240_000 },
    )
    const occupancy = await page.evaluate(() =>
      window.GAME_TEST_API!.getDestinationOccupancy('pdest_prop_bench_g1'),
    )
    expect(occupancy).toBe(1)
  })

  test('a citizen travels toward the waterfront through the painted drive crossing', async ({
    page,
  }) => {
    test.setTimeout(120_000)
    await gotoGame(page)
    await arriveAtHarborCross(page)
    await page.waitForFunction(
      () =>
        window.GAME_TEST_API!.forceCitizenDestination(
          'cit_dd_waterfront_gazer',
          'pdest_waterfront_view',
        ),
      undefined,
      { timeout: 15_000 },
    )
    const trip = await page.evaluate(
      () => window.GAME_TEST_API!.getCitizenTripState('cit_dd_waterfront_gazer')!,
    )
    expect(trip.crossingIds).toContain('s0_-2_drive_prom_walk')
    // Measured progress south along the spine.
    const startZ = await page.evaluate(
      () => window.GAME_TEST_API!.getPedestrianCrossingState('cit_dd_waterfront_gazer')!.position[1],
    )
    await page.waitForFunction(
      (z0) =>
        window.GAME_TEST_API!.getPedestrianCrossingState('cit_dd_waterfront_gazer')!.position[1] <
        (z0 as number) - 25,
      startZ,
      { timeout: 90_000 },
    )
  })

  test('the yard worker completes a cross-district commute to the warehouse door', async ({
    page,
  }) => {
    test.setTimeout(420_000)
    await gotoGame(page)
    await arriveAtHarborCross(page)
    await page.waitForFunction(
      () => window.GAME_TEST_API!.forceCitizenDestination('cit_dd_yard_worker', 'pdest_s-1_-2_w1'),
      undefined,
      { timeout: 15_000 },
    )
    const trip = await page.evaluate(
      () => window.GAME_TEST_API!.getCitizenTripState('cit_dd_yard_worker')!,
    )
    // East gate → Harbor Cross (signalized) → yard painted crossing → dock.
    expect(trip.crossingIds.some((c) => c.includes('harbor_cross'))).toBe(true)
    expect(trip.crossingIds).toContain('s-1_-2_yard_rd_gate_walk')
    await page.waitForFunction(
      () =>
        window.GAME_TEST_API!.getCitizenTripState('cit_dd_yard_worker')?.phase ===
        'performing_activity',
      undefined,
      { timeout: 380_000 },
    )
    const state = await page.evaluate(
      () => window.GAME_TEST_API!.getCitizenTripState('cit_dd_yard_worker')!,
    )
    expect(state.destinationId).toBe('pdest_s-1_-2_w1')
    expect(state.tripsCompleted).toBeGreaterThanOrEqual(1)
    expect(state.recoveryStage).toBe(0)
  })

  test('destination capacity prevents overcrowding', async ({ page }) => {
    await gotoGame(page)
    await arriveAtHarborCross(page)
    const result = await page.evaluate(() => {
      const api = window.GAME_TEST_API!
      return {
        first: api.forceCitizenDestination('cit_dd_bench_reader', 'pdest_prop_bench_g1'),
        second: api.forceCitizenDestination('cit_dd_waterfront_gazer', 'pdest_prop_bench_g1'),
        occupancy: api.getDestinationOccupancy('pdest_prop_bench_g1'),
      }
    })
    expect(result.first).toBe(true)
    expect(result.second).toBe(false) // bench capacity is 1
    expect(result.occupancy).toBe(1)
  })

  test('rain steers the next selection to an indoor destination', async ({ page }) => {
    test.setTimeout(120_000)
    await gotoGame(page)
    await arriveAtHarborCross(page)
    await page.evaluate(() => {
      const api = window.GAME_TEST_API!
      api.setWeather('rain', { instant: true, intensity: 0.8 })
      api.resetGame() // trips restart → fresh seeded selection under rain
      api.setTime(10)
      api.setWeather('rain', { instant: true, intensity: 0.8 })
      api.teleportTo('harbor_cross')
    })
    const indoor = new Set(['pdest_s0_-2_cafe', 'pdest_s0_-2_shop', 'pdest_s1_-2_s1'])
    for (const id of ['cit_dd_shopper_west', 'cit_dd_cafe_regular']) {
      await page.waitForFunction(
        (cid) => {
          const t = window.GAME_TEST_API!.getCitizenTripState(cid as string)
          return t !== null && t.destinationId !== null
        },
        id,
        { timeout: 30_000 },
      )
      const trip = await page.evaluate(
        (cid) => window.GAME_TEST_API!.getCitizenTripState(cid as string)!,
        id,
      )
      expect(indoor.has(trip.destinationId!), `${id} → ${trip.destinationId}`).toBe(true)
    }
  })

  test('sector unload/reload preserves the trip system: no duplicates, no leaked occupancy', async ({
    page,
  }) => {
    test.setTimeout(180_000)
    await gotoGame(page)
    await arriveAtHarborCross(page)
    await page.waitForFunction(
      () => window.GAME_TEST_API!.forceCitizenDestination('cit_dd_waterfront_gazer', 'pdest_waterfront_view'),
      undefined,
      { timeout: 15_000 },
    )
    await page.evaluate(() => window.GAME_TEST_API!.teleportTo('central_plaza'))
    await page.waitForTimeout(1_500)
    await page.evaluate(() => window.GAME_TEST_API!.forceUnloadSector('s0_-1'))
    await page.waitForFunction(
      () => window.GAME_TEST_API!.getSectorState('s0_-1')?.lifecycle === 'unloaded',
      undefined,
      { timeout: 25_000 },
    )
    // Dormant: the capacity claim is released, the trip preserved.
    const dormant = await page.evaluate(() => ({
      trip: window.GAME_TEST_API!.getCitizenTripState('cit_dd_waterfront_gazer')!,
      occupancy: window.GAME_TEST_API!.getDestinationOccupancy('pdest_waterfront_view'),
    }))
    expect(dormant.trip.suspended).toBe(true)
    expect(dormant.occupancy).toBe(0)
    await page.evaluate(() => {
      window.GAME_TEST_API!.forceLoadSector('s0_-1')
      window.GAME_TEST_API!.clearForcedSectors()
    })
    await arriveAtHarborCross(page)
    const after = await page.evaluate(() => ({
      citizens: window.GAME_TEST_API!.getAmbientCitizens().length,
      trips: window.GAME_TEST_API!
        .getCitizenDestinations()
        .every((d) => d.occupancy <= d.capacity),
    }))
    expect(after.citizens).toBe(90) // no duplicates, no losses
    expect(after.trips).toBe(true)
  })

  test('two citizens use different crossings simultaneously without deadlock', async ({ page }) => {
    test.setTimeout(150_000)
    await gotoGame(page)
    await arriveAtHarborCross(page)
    await page.waitForFunction(() => {
      const api = window.GAME_TEST_API!
      return (
        api.forceCitizenDestination('cit_dd_shopper_west', 'pdest_prop_bench_g1') &&
        api.forceCitizenDestination('cit_dd_yard_worker', 'pdest_s-1_-2_w1')
      )
    }, undefined, { timeout: 15_000 })
    const start = await page.evaluate(() => {
      const api = window.GAME_TEST_API!
      return ['cit_dd_shopper_west', 'cit_dd_yard_worker'].map(
        (id) => api.getPedestrianCrossingState(id)!.position,
      )
    })
    await page.waitForTimeout(25_000)
    const moved = await page.evaluate(() => {
      const api = window.GAME_TEST_API!
      return ['cit_dd_shopper_west', 'cit_dd_yard_worker'].map(
        (id) => api.getPedestrianCrossingState(id)!.position,
      )
    })
    for (let i = 0; i < 2; i++) {
      const d = Math.hypot(moved[i][0] - start[i][0], moved[i][1] - start[i][1])
      expect(d, `citizen ${i} displacement`).toBeGreaterThan(5)
    }
    const overlaps = await page.evaluate(() =>
      window.GAME_TEST_API!.assertNoVehicleVehicleOverlaps(),
    )
    expect(overlaps).toEqual([])
  })

  test('150s mixed soak: trips keep completing, nobody strands, occupancy never leaks', async ({
    page,
  }) => {
    test.setTimeout(300_000)
    const errors: string[] = []
    page.on('pageerror', (err) => errors.push(String(err)))
    await gotoGame(page)
    await arriveAtHarborCross(page)
    const start = Date.now()
    let lastPositions: Record<string, [number, number]> = {}
    const stuckStreak: Record<string, number> = {}
    while (Date.now() - start < 150_000) {
      await page.waitForTimeout(15_000)
      const snap = await page.evaluate((ids) => {
        const api = window.GAME_TEST_API!
        return {
          overlaps: api.assertNoVehicleVehicleOverlaps(),
          destinations: api.getCitizenDestinations(),
          trips: (ids as string[]).map((id) => ({
            id,
            trip: api.getCitizenTripState(id),
            ped: api.getPedestrianCrossingState(id),
          })),
        }
      }, TRIP_CITIZENS)
      expect(snap.overlaps).toEqual([])
      for (const d of snap.destinations) {
        expect(d.occupancy, `${d.id} occupancy`).toBeLessThanOrEqual(d.capacity)
      }
      for (const { id, trip, ped } of snap.trips) {
        expect(trip, id).not.toBeNull()
        expect(ped, id).not.toBeNull()
        // Stranded detector: a WALKING citizen must displace between
        // windows unless legitimately waiting at a crossing or performing.
        const walking = trip!.phase === 'walking_to_destination' && ped!.state !== 'waiting_to_cross'
        const prev = lastPositions[id]
        const movedFar = !prev || Math.hypot(ped!.position[0] - prev[0], ped!.position[1] - prev[1]) > 1.5
        stuckStreak[id] = walking && !movedFar ? (stuckStreak[id] ?? 0) + 1 : 0
        expect(stuckStreak[id], `${id} stranded`).toBeLessThan(3)
        lastPositions[id] = ped!.position
      }
    }
    const totals = await page.evaluate((ids) => {
      const api = window.GAME_TEST_API!
      return (ids as string[]).reduce(
        (sum, id) => sum + (api.getCitizenTripState(id)?.tripsCompleted ?? 0),
        0,
      )
    }, TRIP_CITIZENS)
    expect(totals).toBeGreaterThanOrEqual(2) // trips genuinely complete
    expect(errors).toEqual([])
  })
})
