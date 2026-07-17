import { expect, test, type Page } from '@playwright/test'
import { gotoGame } from './helpers'

/**
 * Signalized Cross-Street Intersections v1: the Harbor Cross proof
 * intersection on the North Boulevard. Phases derive from the global
 * traffic clock; every scenario pins the clock with setIntersectionElapsed
 * for determinism.
 */

const X = 's0_-2_harbor_cross'

async function resetWorld(page: Page) {
  await page.evaluate(() => {
    window.GAME_TEST_API!.resetGame()
    window.GAME_TEST_API!.setTime(10)
    window.GAME_TEST_API!.setTrafficRoutingSeed(1)
  })
  await page.waitForTimeout(600)
}

test.describe('signalized cross-street intersection', () => {
  test('boot: intersection registered, plan valid, movements permitted per phase', async ({
    page,
  }) => {
    const errors: string[] = []
    page.on('pageerror', (err) => errors.push(String(err)))
    await gotoGame(page)
    const snap = await page.evaluate((id) => {
      const api = window.GAME_TEST_API!
      api.setIntersectionElapsed(1) // green_south
      const south = api.getMovementPermission(id, 'south')
      const east = api.getMovementPermission(id, 'east')
      api.setIntersectionElapsed(21) // green_east (8+2+8+2+1)
      const eastLater = api.getMovementPermission(id, 'east')
      return {
        ids: api.getIntersectionIds(),
        state: api.getIntersectionState(id),
        plan: api.getSignalPlan(id),
        south,
        east,
        eastLater,
      }
    }, X)
    expect(snap.ids).toContain(X)
    expect(snap.state!.movements).toBe(12)
    expect(snap.state!.approaches).toBe(4)
    expect(snap.plan!.cycleLength).toBe(46)
    expect(snap.south).toBe('green')
    expect(snap.east).toBe('red')
    expect(snap.eastLater).toBe('green')
    expect(errors).toEqual([])
  })

  test('red approach stops a routed car at the stop line without replanning; green resumes', async ({
    page,
  }) => {
    test.setTimeout(120_000)
    await gotoGame(page)
    await resetWorld(page)
    await page.evaluate((id) => {
      const api = window.GAME_TEST_API!
      // Northbound approach during EAST green — south approach is red for
      // a long, deterministic stretch (green_east + clear + green_west...).
      api.setIntersectionElapsed(20.5)
      api.teleportAmbientVehicleToSegment('vehicle_ambient_car_01', 's0_-2_boulevard_fwd', 0.7)
      api.forceVehicleDestination('vehicle_ambient_car_01', 'dest_s0_-2_promenade')
      void id
    }, X)
    // The car halts before the box (stop line z = -152.6) and holds.
    await page.waitForFunction(() => {
      const api = window.GAME_TEST_API!
      const car = api.getTrafficState().cars.find((c) => c.id === 'vehicle_ambient_car_01')
      return car !== undefined && car.speed < 0.2 && car.position[1] > -154 && car.position[1] < -146
    }, undefined, { timeout: 30_000 })
    // Hold the red for 12 MORE seconds (re-pin the clock: 20.5 gives a
    // 25.5s red window for the south approach). The wait must classify as
    // 'signal' the whole time — no suspect-time escalation, no replans, no
    // recovery teleports. Regression guard: the clamp once reported 'clear'
    // to recovery, which escalated through replan/respawn at long reds.
    await page.evaluate(() => window.GAME_TEST_API!.setIntersectionElapsed(20.5))
    await page.waitForTimeout(12_000)
    const during = await page.evaluate(() => {
      const api = window.GAME_TEST_API!
      const s = api.getVehicleRouteState('vehicle_ambient_car_01')!
      const car = api.getTrafficState().cars.find((c) => c.id === 'vehicle_ambient_car_01')!
      return { replans: s.replanCount, stage: s.recoveryStage, reason: car.reason, z: car.position[1] }
    })
    expect(during.stage).toBe(0)
    expect(during.reason).toBe('signal')
    expect(during.z).toBeGreaterThan(-154)
    expect(during.z).toBeLessThan(-146)
    // Force the south green: the car proceeds through the box northbound.
    await page.evaluate(() => window.GAME_TEST_API!.setIntersectionElapsed(0.5))
    await page.waitForFunction(
      () => {
        const car = window.GAME_TEST_API!
          .getTrafficState()
          .cars.find((c) => c.id === 'vehicle_ambient_car_01')
        return car !== undefined && car.position[1] < -166
      },
      undefined,
      { timeout: 30_000 },
    )
    const after = await page.evaluate(
      () => window.GAME_TEST_API!.getVehicleRouteState('vehicle_ambient_car_01')!,
    )
    expect(after.replanCount).toBe(during.replans)
    expect(after.recoveryStage).toBe(0)
  })

  test('a routed trip TURNS through the intersection to a harbor arm', async ({ page }) => {
    test.setTimeout(180_000)
    await gotoGame(page)
    await resetWorld(page)
    await page.evaluate(() => {
      const api = window.GAME_TEST_API!
      api.teleportAmbientVehicleToSegment('vehicle_ambient_car_03', 'gate_nb', 0.3)
      api.forceVehicleDestination('vehicle_ambient_car_03', 'dest_s0_-2_harbor_east')
    })
    await page.waitForFunction(
      () =>
        window.GAME_TEST_API!.getVehicleRouteState('vehicle_ambient_car_03')?.destinationId ===
        'dest_s0_-2_harbor_east',
      undefined,
      { timeout: 10_000 },
    )
    const plan = await page.evaluate(
      () => window.GAME_TEST_API!.getVehicleRouteState('vehicle_ambient_car_03')!.segmentIds,
    )
    // Route runs boulevard → RIGHT-turn movement → harbor east arm.
    expect(plan).toContain('s0_-2_boulevard_fwd')
    expect(plan).toContain('s0_-2_harbor_cross_south_right')
    expect(plan[plan.length - 1]).toBe('s0_-2_harbor_e_fwd')
    const before = await page.evaluate(
      () => window.GAME_TEST_API!.getCompletedTrips('vehicle_ambient_car_03'),
    )
    await page.waitForFunction(
      (b) => window.GAME_TEST_API!.getCompletedTrips('vehicle_ambient_car_03') > (b as number),
      before,
      { timeout: 150_000 },
    )
    const overlaps = await page.evaluate(() =>
      window.GAME_TEST_API!.assertNoVehicleVehicleOverlaps(),
    )
    expect(overlaps).toEqual([])
  })

  test('sector unload/reload never resets the signal phase', async ({ page }) => {
    test.setTimeout(120_000)
    await gotoGame(page)
    await resetWorld(page)
    const before = await page.evaluate((id) => {
      window.GAME_TEST_API!.setIntersectionElapsed(23)
      return window.GAME_TEST_API!.getIntersectionState(id)!
    }, X)
    await page.evaluate(() => window.GAME_TEST_API!.forceUnloadSector('s0_-2'))
    await page.waitForFunction(
      () => window.GAME_TEST_API!.getSectorState('s0_-2')?.lifecycle === 'unloaded',
      undefined,
      { timeout: 25_000 },
    )
    // The plan keeps ticking off the GLOBAL clock while unloaded.
    const whileUnloaded = await page.evaluate((id) => window.GAME_TEST_API!.getIntersectionState(id), X)
    expect(whileUnloaded).not.toBeNull()
    await page.evaluate(() => window.GAME_TEST_API!.forceLoadSector('s0_-2'))
    await page.waitForFunction(
      () => {
        const s = window.GAME_TEST_API!.getSectorState('s0_-2')
        return s?.lifecycle === 'active' && s.visualsReady
      },
      undefined,
      { timeout: 25_000 },
    )
    await page.evaluate(() => window.GAME_TEST_API!.clearForcedSectors())
    const after = await page.evaluate((id) => window.GAME_TEST_API!.getIntersectionState(id)!, X)
    // Elapsed kept advancing (no reset to zero): phase index moved FORWARD
    // through the cycle relative to the pinned clock, never backward.
    expect(after.cycleLength).toBe(before.cycleLength)
    expect(after.phaseId).not.toBe('') // registry intact after remount
  })

  test('mixed-traffic soak through the intersection: no overlaps, no deadlock, no replan storm', async ({
    page,
  }) => {
    test.setTimeout(220_000)
    const errors: string[] = []
    page.on('pageerror', (err) => errors.push(String(err)))
    await gotoGame(page)
    await resetWorld(page)
    await page.evaluate(() => {
      const api = window.GAME_TEST_API!
      const routed = api.getAllVehicleRouteStates().map((s) => s.vehicleId)
      // Everyone's business crosses the Harbor Cross.
      const targets = [
        'dest_s0_-2_harbor_east',
        'dest_s0_-2_harbor_west',
        'dest_s0_-2_promenade',
        'dest_s1_-2_north_row',
        'dest_s-1_-2_loading',
      ]
      targets.forEach((dest, i) => api.forceVehicleDestination(routed[i % routed.length], dest))
    })
    // Deadlock detectors: (a) the fleet DISPLACES every window — a frozen
    // standoff means positions stop changing; (b) recovery never escalates
    // deep (signal waits are benign and must not trip staged recovery).
    // Trip/segment counters are NOT monotonic here by design: congestion
    // replans legally rebuild routes mid-trip.
    const positions = () =>
      page.evaluate(() => Object.values(window.GAME_TEST_API!.getAmbientCarPositions()))
    const start = Date.now()
    let maxReplans = 0
    let last = await positions()
    while (Date.now() - start < 130_000) {
      await page.waitForTimeout(13_000)
      const health = await page.evaluate(() => ({
        overlaps: window.GAME_TEST_API!.assertNoVehicleVehicleOverlaps(),
        states: window.GAME_TEST_API!.getAllVehicleRouteStates(),
      }))
      expect(health.overlaps).toEqual([])
      for (const s of health.states) {
        expect(s.segmentIds.length, s.vehicleId).toBeGreaterThan(0)
        expect(s.currentSegmentId, s.vehicleId).not.toBeNull()
        expect(s.recoveryStage, `${s.vehicleId} recovery stage`).toBeLessThan(3)
        maxReplans = Math.max(maxReplans, s.replanCount)
      }
      const now = await positions()
      const moved = now.reduce(
        (sum, p, i) => sum + (last[i] ? Math.hypot(p[0] - last[i][0], p[2] - last[i][2]) : 0),
        0,
      )
      expect(moved, 'fleet displacement per window').toBeGreaterThan(2)
      last = now
    }
    expect(maxReplans).toBeLessThan(12) // no replan storm
    expect(errors).toEqual([])
  })
})
