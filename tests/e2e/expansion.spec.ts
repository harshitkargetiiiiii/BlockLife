import { expect, test, type Page } from '@playwright/test'
import { gotoGame } from './helpers'

/**
 * City Expansion Content Pack v1: four kit-compiled sectors (Waterfront
 * Gateway, Main Street North, Residential East, Industrial Yard) stream,
 * collide, route, walk, save and map like the hand-authored city.
 */

async function resetWorld(page: Page) {
  await page.evaluate(() => {
    window.GAME_TEST_API!.resetGame()
    window.GAME_TEST_API!.setTime(10)
    window.GAME_TEST_API!.setTrafficRoutingSeed(1)
  })
  await page.waitForTimeout(600)
}

async function waitForSectorReady(page: Page, sectorId: string, timeout = 25_000) {
  await page.waitForFunction(
    (id) => {
      const s = window.GAME_TEST_API!.getSectorState(id as string)
      return s?.lifecycle === 'active' && s.visualsReady && s.collidersReady
    },
    sectorId,
    { timeout },
  )
}

test.describe('city expansion content pack', () => {
  test('boot: expanded graph, all four sectors validate, ownership clean', async ({ page }) => {
    const errors: string[] = []
    page.on('pageerror', (err) => errors.push(String(err)))
    await gotoGame(page)
    const snapshot = await page.evaluate(() => {
      const api = window.GAME_TEST_API!
      return {
        summary: api.getRoadGraphSummary(),
        validations: ['s0_-2', 's1_-2', 's2_-1', 's-1_-2'].map((id) => ({
          id,
          errors: api.validateSectorAuthoring(id),
          compiled: api.getCompiledSectorContent(id),
        })),
        ownership: api.validateSectorOwnership(),
        citizens: api.getAmbientCitizens().length,
      }
    })
    expect(snapshot.summary.segmentCount).toBe(153) // +21: Harbor Cross split + arms + 12 movements
    expect(snapshot.summary.destinationCount).toBe(28) // +2 harbor arm destinations
    for (const v of snapshot.validations) {
      expect(v.errors, v.id).toEqual([])
      expect(v.compiled!.buildings, v.id).toBeGreaterThanOrEqual(3)
      expect(v.compiled!.citizens, v.id).toBeGreaterThanOrEqual(1)
    }
    expect(snapshot.ownership).toEqual([])
    expect(snapshot.citizens).toBe(90) // crossings v1 +6; destination trips v1 +6
    expect(errors).toEqual([])
  })

  test('walking north across the s0_-1 → s0_-2 boundary: ground holds, sector activates', async ({
    page,
  }) => {
    test.setTimeout(180_000)
    await gotoGame(page)
    await resetWorld(page)
    // Start in the gateway (coordinator-prepped ground), wait for the
    // neighbor warm ring to mount the waterfront's colliders — its road
    // corridor carries the boulevard's floor — then WALK the whole
    // boulevard north across the z = -216 grid boundary.
    await page.evaluate(() => window.GAME_TEST_API!.teleportTo('downtown_gateway'))
    await page.waitForFunction(
      () => window.GAME_TEST_API!.getSectorState('s0_-2')?.collidersReady === true,
      undefined,
      { timeout: 30_000 },
    )
    // Walk the boulevard's EAST SIDEWALK (x 53): both wall openings span
    // x 42..54 and the sidewalk keeps the player clear of yielding traffic
    // (standing between the lanes turns the corridor into a parked queue).
    await page.evaluate(() => window.GAME_TEST_API!.teleportPlayer([53, 1.2, -108]))
    await page.waitForTimeout(800)
    // Movement is CAMERA-relative on the isometric camera: 'w' alone walks
    // north-WEST (off the corridor floor); 'w'+'d' walks true north.
    await page.keyboard.down('w')
    await page.keyboard.down('d')
    await page.waitForFunction(
      () => window.GAME_TEST_API!.getStats().position[2] < -224,
      undefined,
      { timeout: 90_000 },
    )
    await page.keyboard.up('w')
    await page.keyboard.up('d')
    const state = await page.evaluate(() => ({
      sector: window.GAME_TEST_API!.getCurrentSectorId(),
      y: window.GAME_TEST_API!.getStats().position[1],
      waterfront: window.GAME_TEST_API!.getSectorState('s0_-2'),
    }))
    expect(state.sector).toBe('s0_-2')
    expect(state.y).toBeGreaterThan(0)
    expect(state.y).toBeLessThan(4)
    expect(state.waterfront!.lifecycle).toBe('active')
    expect(state.waterfront!.collidersReady).toBe(true)
  })

  test('driving east along Main Street into Residential East', async ({ page }) => {
    test.setTimeout(120_000)
    await gotoGame(page)
    await resetWorld(page)
    await page.evaluate(() => window.GAME_TEST_API!.teleportTo('parking_lot_test'))
    await page.waitForFunction(
      () => window.GAME_TEST_API!.getStats().activeInteractableId === 'vehicle_compact_car_01',
    )
    await page.keyboard.press('e')
    await page.waitForFunction(() => window.GAME_TEST_API!.getStats().mode === 'driving')
    // Place the car on the avenue just west of the s2_-1 boundary, heading
    // east. Streaming follows the DRIVEN CAR (the director anchors to the
    // vehicle in driving mode), so the sector's colliders — which carry the
    // floor past the old city's ground slab — warm up before the crossing.
    // The hop is kept short: a long run through live traffic can end with
    // the car bumped off-course (physics, not streaming).
    await page.evaluate(() => window.GAME_TEST_API!.setDrivenCarPosition([200, -96], Math.PI / 2))
    await page.waitForFunction(
      () => window.GAME_TEST_API!.getSectorState('s2_-1')?.collidersReady === true,
      undefined,
      { timeout: 30_000 },
    )
    await page.waitForTimeout(800)
    await page.keyboard.down('w')
    await page.waitForFunction(
      () => window.GAME_TEST_API!.getStats().position[0] > 232,
      undefined,
      { timeout: 45_000 },
    )
    await page.keyboard.up('w')
    const state = await page.evaluate(() => ({
      sector: window.GAME_TEST_API!.getCurrentSectorId(),
      mode: window.GAME_TEST_API!.getStats().mode,
      y: window.GAME_TEST_API!.getStats().position[1],
    }))
    expect(state.sector).toBe('s2_-1')
    expect(state.mode).toBe('driving')
    expect(state.y).toBeGreaterThan(-1)
    expect(state.y).toBeLessThan(4)
  })

  test('routed freight trip completes to the Industrial Yard loading dock', async ({ page }) => {
    // The trip crosses Harbor Cross northbound; split-phase can hold the
    // approach red for up to 38s (measured healthy trip: ~126s sim). Under
    // full-gate CPU load sim time runs at roughly HALF wall speed, so the
    // wall budget is sim worst-case x2 + margin.
    test.setTimeout(360_000)
    await gotoGame(page)
    await resetWorld(page)
    await page.evaluate(() => {
      const api = window.GAME_TEST_API!
      api.teleportAmbientVehicleToSegment('vehicle_ambient_car_01', 'art_nb_a', 0.3)
      api.forceVehicleDestination('vehicle_ambient_car_01', 'dest_s-1_-2_loading')
    })
    await page.waitForFunction(
      () =>
        window.GAME_TEST_API!.getVehicleRouteState('vehicle_ambient_car_01')?.destinationId ===
        'dest_s-1_-2_loading',
      undefined,
      { timeout: 10_000 },
    )
    const plan = await page.evaluate(
      () => window.GAME_TEST_API!.getVehicleRouteState('vehicle_ambient_car_01')!.segmentIds,
    )
    // Through the fork arc the kit emitted for the west spur.
    expect(plan).toContain('s-1_-2_yard_rd_fork')
    expect(plan[plan.length - 1]).toBe('s-1_-2_yard_rd_fwd')
    const before = await page.evaluate(
      () => window.GAME_TEST_API!.getCompletedTrips('vehicle_ambient_car_01'),
    )
    await page.waitForFunction(
      (b) => window.GAME_TEST_API!.getCompletedTrips('vehicle_ambient_car_01') > (b as number),
      before,
      { timeout: 300_000 },
    )
    const overlaps = await page.evaluate(() =>
      window.GAME_TEST_API!.assertNoVehicleVehicleOverlaps(),
    )
    expect(overlaps).toEqual([])
  })

  test('routed trip completes to the Waterfront promenade', async ({ page }) => {
    // Also crosses Harbor Cross — worst-case 38s red hold, doubled for
    // full-gate CPU load (sim time lags wall time).
    test.setTimeout(280_000)
    await gotoGame(page)
    await resetWorld(page)
    await page.evaluate(() => {
      const api = window.GAME_TEST_API!
      api.teleportAmbientVehicleToSegment('vehicle_ambient_car_03', 'gate_nb', 0.2)
      api.forceVehicleDestination('vehicle_ambient_car_03', 'dest_s0_-2_promenade')
    })
    await page.waitForFunction(
      () =>
        window.GAME_TEST_API!.getVehicleRouteState('vehicle_ambient_car_03')?.destinationId ===
        'dest_s0_-2_promenade',
      undefined,
      { timeout: 10_000 },
    )
    const before = await page.evaluate(
      () => window.GAME_TEST_API!.getCompletedTrips('vehicle_ambient_car_03'),
    )
    await page.waitForFunction(
      (b) => window.GAME_TEST_API!.getCompletedTrips('vehicle_ambient_car_03') > (b as number),
      before,
      { timeout: 240_000 },
    )
    const overlaps = await page.evaluate(() =>
      window.GAME_TEST_API!.assertNoVehicleVehicleOverlaps(),
    )
    expect(overlaps).toEqual([])
  })

  test('phone map shows the expanded city: new labels + water band', async ({ page }) => {
    await gotoGame(page)
    await page.evaluate(() => {
      window.GAME_TEST_API!.resetGame()
      window.GAME_TEST_API!.teleportTo('central_plaza')
      window.GAME_TEST_API!.pauseWorld(true)
    })
    await page.waitForTimeout(600)
    await page.keyboard.press('Tab')
    await page.getByText('Map', { exact: true }).click()
    await expect(page.getByTestId('phone-map')).toBeVisible()
    await expect(page.getByTestId('map-water-s0_-2')).toBeVisible()
    for (const id of ['s0_-2', 's1_-2', 's2_-1', 's-1_-2']) {
      await expect(page.getByTestId(`map-district-sector_${id}`)).toBeVisible()
    }
    await expect(page.getByTestId('map-marker-player')).toBeVisible()
  })

  test('save/load round-trips inside a new sector', async ({ page }) => {
    test.setTimeout(90_000)
    await gotoGame(page)
    await resetWorld(page)
    await page.evaluate(() => window.GAME_TEST_API!.teleportTo('waterfront'))
    await waitForSectorReady(page, 's0_-2')
    const saved = await page.evaluate(() => window.GAME_TEST_API!.saveGame())
    expect(saved).toBe(true)
    // Leave, then load back: position and sector restore, ground holds.
    await page.evaluate(() => window.GAME_TEST_API!.teleportTo('central_plaza'))
    await page.waitForTimeout(1200)
    const loaded = await page.evaluate(() => window.GAME_TEST_API!.loadGame())
    expect(loaded).toBe(true)
    await waitForSectorReady(page, 's0_-2')
    await page.waitForTimeout(1500)
    const state = await page.evaluate(() => ({
      sector: window.GAME_TEST_API!.getCurrentSectorId(),
      pos: window.GAME_TEST_API!.getStats().position,
    }))
    expect(state.sector).toBe('s0_-2')
    expect(state.pos[1]).toBeGreaterThan(0)
    expect(state.pos[1]).toBeLessThan(4)
  })

  test('streaming cycles on two new sectors: no duplicate resources', async ({ page }) => {
    test.setTimeout(150_000)
    await gotoGame(page)
    const before = await page.evaluate(() => ({
      graphVersion: window.GAME_TEST_API!.getGlobalRoadGraphVersion(),
      citizens: window.GAME_TEST_API!.getAmbientCitizens().length,
    }))
    // Occluder assertions are SCOPED to each cycled sector's own id prefix:
    // unrelated sectors legitimately mount/unmount meanwhile (route prewarm
    // follows the ambient fleet), so a global count is not stable.
    for (const sector of ['s0_-2', 's-1_-2']) {
      const perLoad: number[] = []
      for (let i = 0; i < 2; i++) {
        await page.evaluate((id) => void window.GAME_TEST_API!.forceLoadSector(id), sector)
        await page.waitForFunction(
          (id) => {
            const s = window.GAME_TEST_API!.getSectorState(id as string)
            return s?.lifecycle === 'active' && s.visualsReady && s.collidersReady
          },
          sector,
          { timeout: 25_000 },
        )
        const loaded = await page.evaluate(
          (id) =>
            window.GAME_TEST_API!.getRegisteredOccluders().filter((o) => o.startsWith(`${id}_`))
              .length,
          sector,
        )
        expect(loaded, `${sector} occluders while loaded`).toBeGreaterThan(0)
        perLoad.push(loaded)
        await page.evaluate((id) => void window.GAME_TEST_API!.forceUnloadSector(id), sector)
        await page.waitForFunction(
          (id) => window.GAME_TEST_API!.getSectorState(id as string)?.lifecycle === 'unloaded',
          sector,
          { timeout: 25_000 },
        )
        const afterUnload = await page.evaluate(
          (id) =>
            window.GAME_TEST_API!.getRegisteredOccluders().filter((o) => o.startsWith(`${id}_`))
              .length,
          sector,
        )
        expect(afterUnload, `${sector} occluders after unload`).toBe(0)
      }
      // Same registration count on every load — no duplicates, no leaks.
      expect(perLoad[1], `${sector} stable across reloads`).toBe(perLoad[0])
    }
    await page.evaluate(() => window.GAME_TEST_API!.clearForcedSectors())
    await page.waitForTimeout(1500)
    const after = await page.evaluate(() => ({
      graphVersion: window.GAME_TEST_API!.getGlobalRoadGraphVersion(),
      citizens: window.GAME_TEST_API!.getAmbientCitizens().length,
    }))
    expect(after.graphVersion).toBe(before.graphVersion)
    expect(after.citizens).toBe(before.citizens)
  })

  test('rainy night on the waterfront: weather applies, no errors', async ({ page }) => {
    test.setTimeout(90_000)
    const errors: string[] = []
    page.on('pageerror', (err) => errors.push(String(err)))
    await gotoGame(page)
    await resetWorld(page)
    await page.evaluate(() => window.GAME_TEST_API!.teleportTo('waterfront'))
    await waitForSectorReady(page, 's0_-2')
    await page.evaluate(() => {
      window.GAME_TEST_API!.setTime(22)
      window.GAME_TEST_API!.setWeather('rain', { instant: true, intensity: 0.8 })
      window.GAME_TEST_API!.setWetness(0.7)
    })
    await page.waitForTimeout(2500)
    const state = await page.evaluate(() => ({
      weather: window.GAME_TEST_API!.getWeatherState(),
      sector: window.GAME_TEST_API!.getCurrentSectorId(),
    }))
    expect(state.weather.kind).toBe('rain')
    expect(state.weather.wetness).toBeGreaterThan(0.5)
    expect(state.sector).toBe('s0_-2')
    expect(errors).toEqual([])
  })

  test('large-world soak: routed trips to every new sector while streaming churns', async ({
    page,
  }) => {
    test.setTimeout(240_000)
    const errors: string[] = []
    page.on('pageerror', (err) => errors.push(String(err)))
    await gotoGame(page)
    await resetWorld(page)
    await page.evaluate(() => {
      const api = window.GAME_TEST_API!
      const routed = api.getAllVehicleRouteStates().map((s) => s.vehicleId)
      const targets = [
        'dest_s-1_-2_loading',
        'dest_s1_-2_north_row',
        'dest_s2_-1_homes',
        'dest_s0_-2_promenade',
      ]
      targets.forEach((dest, i) => api.forceVehicleDestination(routed[i], dest))
      api.setTimeScale(1)
    })
    // Tour the expansion while trips run: exercises load/unload + prewarm.
    const tour = ['main_street_north', 'industrial_yard', 'residential_east', 'waterfront']
    const start = Date.now()
    let stop = 0
    while (Date.now() - start < 150_000) {
      await page.evaluate((loc) => void window.GAME_TEST_API!.teleportTo(loc), tour[stop % 4])
      stop += 1
      await page.waitForTimeout(18_000)
      const health = await page.evaluate(() => ({
        overlaps: window.GAME_TEST_API!.assertNoVehicleVehicleOverlaps(),
        states: window.GAME_TEST_API!.getAllVehicleRouteStates(),
        version: window.GAME_TEST_API!.getGlobalRoadGraphVersion(),
      }))
      expect(health.overlaps).toEqual([])
      for (const s of health.states) {
        expect(s.segmentIds.length, s.vehicleId).toBeGreaterThan(0)
        expect(s.currentSegmentId, s.vehicleId).not.toBeNull()
      }
    }
    const report = await page.evaluate(() => {
      const api = window.GAME_TEST_API!
      return {
        trips: api
          .getAllVehicleRouteStates()
          .reduce((n, s) => n + s.tripsCompleted, 0),
        citizens: api.getAmbientCitizens().length,
        ownership: api.validateSectorOwnership(),
        metrics: api.getStreamingMetrics(),
        cars: Object.keys(api.getAmbientCarPositions()).length,
      }
    })
    expect(report.trips).toBeGreaterThan(0)
    expect(report.citizens).toBe(90)
    expect(report.ownership).toEqual([])
    expect(report.cars).toBe(8)
    expect(errors).toEqual([])
  })
})
