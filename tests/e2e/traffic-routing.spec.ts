import { expect, test, type Page } from '@playwright/test'
import { gotoGame } from './helpers'

/**
 * Cross-District Traffic Routing v1.
 *
 * Ambient cars plan lane-level routes across the six districts over the
 * shared road graph, obey signals/crossings through the existing decision
 * engine, recover from blockages in bounded stages, and never overlap.
 */

const ROUTED_IDS = [
  'vehicle_ambient_car_01',
  'vehicle_ambient_car_03',
  'vehicle_ambient_car_05',
  'vehicle_ambient_car_07',
  'vehicle_ambient_car_08',
]

async function resetTraffic(page: Page) {
  await page.evaluate(() => {
    window.GAME_TEST_API!.resetGame()
    window.GAME_TEST_API!.setTime(10)
    window.GAME_TEST_API!.setTrafficRoutingSeed(1)
  })
  await page.waitForTimeout(600)
}

test.describe('cross-district traffic routing', () => {
  test('boots a mixed fleet: routed cars with plans, loop cars untouched', async ({ page }) => {
    const errors: string[] = []
    page.on('pageerror', (err) => errors.push(String(err)))
    await gotoGame(page)
    const snapshot = await page.evaluate(() => {
      const api = window.GAME_TEST_API!
      return {
        summary: api.getRoadGraphSummary(),
        states: api.getAllVehicleRouteStates(),
        cars: Object.keys(api.getAmbientCarPositions()),
      }
    })
    expect(snapshot.summary.segmentCount).toBeGreaterThan(90)
    expect(snapshot.summary.edgeCount).toBeGreaterThan(110)
    expect(snapshot.summary.destinationCount).toBe(28) // 17 hand-authored + 9 kit-compiled (MSE 1 + expansion pack 8)
    expect(snapshot.states).toHaveLength(ROUTED_IDS.length)
    for (const state of snapshot.states) {
      expect(state.segmentIds.length).toBeGreaterThan(0)
      expect(state.destinationId).not.toBeNull()
      expect(state.graphVersion).toBe(snapshot.summary.version)
    }
    expect(snapshot.cars).toHaveLength(8) // 5 routed + 3 loop
    expect(errors).toEqual([])
  })

  test('central → north freight: connector + arterial T traversal completes a trip', { tag: '@simulation-only' }, async ({
    page,
  }) => {
    test.setTimeout(150_000)
    await gotoGame(page)
    await resetTraffic(page)
    await page.evaluate(() => {
      const api = window.GAME_TEST_API!
      api.teleportAmbientVehicleToSegment('vehicle_ambient_car_01', 'ring_in_n_a', 0.2)
      api.forceVehicleDestination('vehicle_ambient_car_01', 'dest_freight_yard')
    })
    // The forced replan produces a plan through the north connector and the
    // freight arterial T-junction.
    await page.waitForFunction(
      () =>
        window.GAME_TEST_API!.getVehicleRouteState('vehicle_ambient_car_01')?.destinationId ===
        'dest_freight_yard',
      undefined,
      { timeout: 10_000 },
    )
    const plan = await page.evaluate(
      () => window.GAME_TEST_API!.getVehicleRouteState('vehicle_ambient_car_01')!.segmentIds,
    )
    expect(plan).toContain('conn_n_nb')
    expect(plan.some((id) => id.startsWith('jn_res_art'))).toBe(true)
    expect(plan[plan.length - 1]).toBe('art_nb_a')

    const tripsBefore = await page.evaluate(
      () => window.GAME_TEST_API!.getCompletedTrips('vehicle_ambient_car_01'),
    )
    // Drive it: central ring → connector → residential street → T → freight.
    await page.waitForFunction(
      (before) =>
        window.GAME_TEST_API!.getCompletedTrips('vehicle_ambient_car_01') > (before as number),
      tripsBefore,
      { timeout: 120_000 },
    )
    const after = await page.evaluate(() => ({
      state: window.GAME_TEST_API!.getVehicleRouteState('vehicle_ambient_car_01')!,
      overlaps: window.GAME_TEST_API!.assertNoVehicleVehicleOverlaps(),
    }))
    expect(after.state.districtsVisited).toContain('industrial_north')
    expect(after.overlaps).toEqual([])
  })

  test('red signal stops a routed car at the line without replanning; green resumes it', { tag: '@simulation-only' }, async ({
    page,
  }) => {
    test.setTimeout(90_000)
    await gotoGame(page)
    await resetTraffic(page)
    await page.evaluate(() => {
      const api = window.GAME_TEST_API!
      // Approach the signalled north crossing from the east, westbound.
      api.teleportAmbientVehicleToSegment('vehicle_ambient_car_03', 'ring_out_n_b', 0.05)
      api.forceVehicleDestination('vehicle_ambient_car_03', 'dest_westside_lane')
      api.setSignalPhase('pedestrian_walk') // red for vehicles
    })
    // The car must stop for the signal (never classified as a blockage).
    await page.waitForFunction(
      () => {
        const api = window.GAME_TEST_API!
        const car = api.getTrafficState().cars.find((c) => c.id === 'vehicle_ambient_car_03')
        return car !== undefined && car.reason === 'signal' && car.speed < 0.2
      },
      undefined,
      { timeout: 30_000 },
    )
    const during = await page.evaluate(() => {
      const api = window.GAME_TEST_API!
      const state = api.getVehicleRouteState('vehicle_ambient_car_03')!
      const car = api.getTrafficState().cars.find((c) => c.id === 'vehicle_ambient_car_03')!
      return { replans: state.replanCount, stage: state.recoveryStage, pos: car.position }
    })
    expect(during.stage).toBe(0)
    // Stop line for the westbound outer lane sits at x = 3.6 — the car halts
    // before it (heading -x), clear of the crossing at x = 0.
    expect(during.pos[0]).toBeGreaterThan(1.4)

    // Hold red across several checks — no replans while waiting.
    await page.waitForTimeout(3_000)
    const stillWaiting = await page.evaluate(
      () => window.GAME_TEST_API!.getVehicleRouteState('vehicle_ambient_car_03')!,
    )
    expect(stillWaiting.replanCount).toBe(during.replans)

    // Green: the car resumes and progresses across the junction.
    await page.evaluate(() => window.GAME_TEST_API!.setSignalPhase('vehicle_green'))
    await page.waitForFunction(
      () => {
        const car = window.GAME_TEST_API!
          .getTrafficState()
          .cars.find((c) => c.id === 'vehicle_ambient_car_03')
        return car !== undefined && car.speed > 1
      },
      undefined,
      { timeout: 20_000 },
    )
  })

  test('a pedestrian in the connector crossing stops routed traffic and never causes a replan', async ({
    page,
  }) => {
    test.setTimeout(90_000)
    await gotoGame(page)
    await resetTraffic(page)
    await page.evaluate(() => {
      const api = window.GAME_TEST_API!
      // Park a pedestrian inside the north-connector crossing, then send a
      // routed car through it.
      api.setNpcPosition('npc_kim_01', [12, -30])
      api.teleportAmbientVehicleToSegment('vehicle_ambient_car_01', 'conn_n_nb', 0.05)
      api.forceVehicleDestination('vehicle_ambient_car_01', 'dest_residential_homes')
    })
    await page.waitForFunction(
      () => {
        const api = window.GAME_TEST_API!
        const car = api.getTrafficState().cars.find((c) => c.id === 'vehicle_ambient_car_01')
        return (
          car !== undefined &&
          (car.reason === 'crosswalk' || car.reason === 'obstacle') &&
          car.speed < 0.2
        )
      },
      undefined,
      { timeout: 30_000 },
    )
    const state = await page.evaluate(
      () => window.GAME_TEST_API!.getVehicleRouteState('vehicle_ambient_car_01')!,
    )
    expect(state.recoveryStage).toBe(0)
    expect(['pedestrian', 'none']).toContain(state.blockageReason)
  })

  test('a blocked segment diverts new plans while the alternative exists', async ({ page }) => {
    await gotoGame(page)
    await resetTraffic(page)
    const result = await page.evaluate(async () => {
      const api = window.GAME_TEST_API!
      api.teleportAmbientVehicleToSegment('vehicle_ambient_car_05', 'ring_out_s_b', 0.1)
      api.forceVehicleDestination('vehicle_ambient_car_05', 'dest_market_strip')
      await new Promise((r) => setTimeout(r, 800))
      const free = api.getVehicleRouteState('vehicle_ambient_car_05')!.segmentIds
      // Block the outer-ring right turn onto the east connector: the only
      // other legal approach is the inner-ring left turn, via the north loop.
      api.setSegmentBlocked('jn_ring_e_out_right_conn', true)
      api.replanVehicleRoute('vehicle_ambient_car_05')
      await new Promise((r) => setTimeout(r, 800))
      const diverted = api.getVehicleRouteState('vehicle_ambient_car_05')!.segmentIds
      api.setSegmentBlocked('jn_ring_e_out_right_conn', false)
      return { free, diverted }
    })
    expect(result.free).toContain('jn_ring_e_out_right_conn')
    expect(result.diverted).not.toContain('jn_ring_e_out_right_conn')
    expect(result.diverted[result.diverted.length - 1]).toBe('ind_sb_b')
  })

  test('missed turn: a teleported car re-anchors onto the graph and keeps a valid route', async ({
    page,
  }) => {
    await gotoGame(page)
    await resetTraffic(page)
    const result = await page.evaluate(async () => {
      const api = window.GAME_TEST_API!
      api.forceVehicleDestination('vehicle_ambient_car_07', 'dest_central_plaza_east')
      await new Promise((r) => setTimeout(r, 500))
      // Yank the car onto a completely different road mid-route.
      api.teleportAmbientVehicleToSegment('vehicle_ambient_car_07', 'rw_nb_b', 0.4)
      await new Promise((r) => setTimeout(r, 1_000))
      const state = api.getVehicleRouteState('vehicle_ambient_car_07')!
      const car = api.getTrafficState().cars.find((c) => c.id === 'vehicle_ambient_car_07')!
      return { state, pos: car.position, speed: car.speed }
    })
    // Route state re-anchored: current segment is where the car actually is.
    expect(result.state.currentSegmentId).toBe('rw_nb_b')
    expect(result.state.segmentIds).toContain('rw_nb_b')
    // Still targeting the same destination with a fresh, valid plan.
    expect(result.state.destinationId).toBe('dest_central_plaza_east')
    expect(result.state.segmentIds[result.state.segmentIds.length - 1]).toBe('ring_in_e_a')
  })

  test('120-second mixed-fleet soak: motion, trips, zero overlaps, stable registries', { tag: '@simulation-only' }, async ({
    page,
  }) => {
    test.setTimeout(300_000)
    const errors: string[] = []
    page.on('pageerror', (err) => errors.push(String(err)))
    await gotoGame(page)
    await resetTraffic(page)
    const routedIds = [
      'vehicle_ambient_car_01',
      'vehicle_ambient_car_03',
      'vehicle_ambient_car_05',
      'vehicle_ambient_car_07',
      'vehicle_ambient_car_08',
    ]
    const report = await page.evaluate(async () => {
      const api = window.GAME_TEST_API!
      const routed = [
        'vehicle_ambient_car_01',
        'vehicle_ambient_car_03',
        'vehicle_ambient_car_05',
        'vehicle_ambient_car_07',
        'vehicle_ambient_car_08',
      ]
      let overlapTicks = 0
      let invalidStates = 0
      let maxStopped = 0
      const overlapDetails: unknown[] = []
      const speedSamples: number[] = []
      const displacement: Record<string, number> = {}
      const lastPos: Record<string, [number, number, number]> = {}
      const drivenDistricts = new Set<string>()
      const districtOf = (x: number, z: number) => {
        if (x > 36 && z < -20) return 'industrial_north'
        if (x < -36) return 'residential_west'
        if (z > 36) return 'residential_south'
        if (z < -36) return 'residential'
        if (x > 36) return 'industrial'
        return 'central'
      }
      const start = performance.now()
      while (performance.now() - start < 120_000) {
        await new Promise((r) => setTimeout(r, 1_000))
        const overlapping = api.assertNoVehicleVehicleOverlaps()
        overlapTicks += overlapping.length
        for (const [a, b] of overlapping) {
          const cars = api.getTrafficState().cars
          overlapDetails.push({
            pair: [a, b],
            at: Math.round(performance.now() - start),
            cars: cars
              .filter((c) => c.id === a || c.id === b)
              .map((c) => ({ id: c.id, pos: c.position, state: c.state, reason: c.reason })),
            routes: [a, b].map((id) => {
              const s = api.getVehicleRouteState(id)
              return s ? { id, seg: s.currentSegmentId, idx: s.segmentIndex } : { id, seg: 'loop' }
            }),
          })
        }
        const states = api.getAllVehicleRouteStates()
        for (const s of states) {
          if (s.segmentIndex < 0 || s.segmentIndex >= s.segmentIds.length) invalidStates++
          if (s.currentSegmentId === null) invalidStates++
          maxStopped = Math.max(maxStopped, s.stoppedTime)
        }
        const cars = api.getTrafficState().cars
        for (const c of cars) {
          if (!Number.isFinite(c.position[0]) || !Number.isFinite(c.speed)) invalidStates++
          speedSamples.push(c.speed)
        }
        const positions = api.getAmbientCarPositions()
        for (const id of routed) {
          const p = positions[id]
          if (!p) continue
          drivenDistricts.add(districtOf(p[0], p[2]))
          const prev = lastPos[id]
          if (prev) displacement[id] = (displacement[id] ?? 0) + Math.hypot(p[0] - prev[0], p[2] - prev[2])
          lastPos[id] = p
        }
      }
      const states = api.getAllVehicleRouteStates()
      return {
        overlapTicks,
        overlapDetails,
        invalidStates,
        maxStopped,
        totalTrips: routed.reduce((sum, id) => sum + api.getCompletedTrips(id), 0),
        districts: [...drivenDistricts],
        displacement,
        replans: states.reduce((sum, s) => sum + s.replanCount, 0),
        avgSpeed: speedSamples.reduce((a, b) => a + b, 0) / speedSamples.length,
        registrySize: states.length,
      }
    })
    if (report.overlapTicks > 0) console.log('OVERLAPS:', JSON.stringify(report.overlapDetails))
    expect(report.overlapTicks).toBe(0)
    expect(report.invalidStates).toBe(0)
    // Signalized Harbor Cross + a 28-destination city made individual trips
    // legitimately longer (a red can hold an approach up to 38s), and trip
    // counts per WALL time are load-sensitive (heavy CPU stretches frames,
    // so sim time lags wall time). End-to-end arrival is therefore proven
    // by WAITING for the first completed trip instead of counting at an
    // arbitrary cutoff — instant on a healthy run (first trip ~90s in),
    // deterministic under load. Liveness is asserted the strong way below:
    // every routed car must keep covering ground (a frozen or deadlocked
    // car cannot reach 40 units even with ~38s red waits).
    await page.waitForFunction(
      (ids) =>
        (ids as string[]).reduce(
          (sum, id) => sum + window.GAME_TEST_API!.getCompletedTrips(id),
          0,
        ) >= 1,
      routedIds,
      { timeout: 90_000 },
    )
    for (const id of Object.keys(report.displacement)) {
      expect(report.displacement[id], `${id} total displacement`).toBeGreaterThan(40)
    }
    expect(Object.keys(report.displacement)).toHaveLength(5)
    expect(report.districts.length).toBeGreaterThanOrEqual(3)
    expect(report.avgSpeed).toBeGreaterThan(0.5) // traffic keeps flowing
    expect(report.replans).toBeLessThan(30) // no replan storm
    expect(report.registrySize).toBe(5) // no leak, no runaway spawns
    expect(errors).toEqual([])
  })

  test('apartment transition and rain leave routing intact', async ({ page }) => {
    test.setTimeout(90_000)
    await gotoGame(page)
    await resetTraffic(page)
    await page.evaluate(() => {
      window.GAME_TEST_API!.setWeather('rain')
      window.GAME_TEST_API!.enterApartment()
    })
    await page.waitForTimeout(2_500)
    const indoors = await page.evaluate(() => ({
      mode: window.GAME_TEST_API!.getLocationMode(),
      states: window.GAME_TEST_API!.getAllVehicleRouteStates().length,
    }))
    expect(indoors.mode).toBe('apartment')
    expect(indoors.states).toBe(5) // city simulation continues per policy
    await page.evaluate(() => window.GAME_TEST_API!.exitApartment())
    await page.waitForTimeout(1_500)
    const outdoors = await page.evaluate(() => {
      const api = window.GAME_TEST_API!
      const states = api.getAllVehicleRouteStates()
      return {
        states: states.length,
        valid: states.every(
          (s) => s.currentSegmentId !== null && s.segmentIndex < s.segmentIds.length,
        ),
        overlaps: api.assertNoVehicleVehicleOverlaps(),
        rainMoving: api.getTrafficState().cars.some((c) => c.speed > 0.5),
      }
    })
    expect(outdoors.states).toBe(5)
    expect(outdoors.valid).toBe(true)
    expect(outdoors.overlaps).toEqual([])
    expect(outdoors.rainMoving).toBe(true)
  })
})
