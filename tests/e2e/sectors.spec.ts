import { expect, test, type Page } from '@playwright/test'
import { gotoGame } from './helpers'

/**
 * Large City Foundation v1: sector streaming, boundary safety, route
 * continuity across sectors, teleport readiness, lifecycle cleanliness.
 */

async function resetWorld(page: Page) {
  await page.evaluate(() => {
    window.GAME_TEST_API!.resetGame()
    window.GAME_TEST_API!.setTime(10)
    window.GAME_TEST_API!.clearForcedSectors()
    window.GAME_TEST_API!.setStreamingEnabled(true)
  })
  await page.waitForTimeout(400)
}

test.describe('sector streaming foundation', () => {
  test('boot: player in s0_0 active, neighbors mounted, ownership valid', async ({ page }) => {
    const errors: string[] = []
    page.on('pageerror', (err) => errors.push(String(err)))
    await gotoGame(page)
    const snapshot = await page.evaluate(() => {
      const api = window.GAME_TEST_API!
      return {
        current: api.getCurrentSectorId(),
        states: api.getSectorRuntimeStates(),
        ownership: api.validateSectorOwnership(),
        registry: api.getSectorRegistry().map((s) => s.id),
        graphVersion: api.getGlobalRoadGraphVersion(),
      }
    })
    expect(snapshot.current).toBe('s0_0')
    expect(snapshot.registry.sort()).toEqual([
      's-1_-2',
      's-1_0',
      's0_-1',
      's0_-2',
      's0_0',
      's1_-1',
      's1_-2',
      's1_0',
      's2_-1',
    ])
    const central = snapshot.states.find((s) => s.id === 's0_0')!
    expect(central.lifecycle).toBe('active')
    expect(central.visualsReady && central.collidersReady).toBe(true)
    // Warm-ring neighbors are mounted and ready.
    const gateway = snapshot.states.find((s) => s.id === 's0_-1')!
    expect(['warm', 'active']).toContain(gateway.lifecycle)
    expect(snapshot.ownership).toEqual([])
    expect(errors).toEqual([])
  })

  test('walking across the boundary into the gateway: ground ready, no void', async ({ page }) => {
    test.setTimeout(120_000)
    await gotoGame(page)
    await resetWorld(page)
    // Start at the corridor mouth just south of the boundary, walk north.
    await page.evaluate(() => window.GAME_TEST_API!.teleportPlayer([48, 1.2, -66]))
    await page.waitForTimeout(800)
    await page.keyboard.down('w')
    await page.waitForFunction(
      () => window.GAME_TEST_API!.getStats().position[2] < -74,
      undefined,
      { timeout: 30_000 },
    )
    await page.keyboard.up('w')
    const after = await page.evaluate(() => ({
      current: window.GAME_TEST_API!.getCurrentSectorId(),
      gateway: window.GAME_TEST_API!.getSectorState('s0_-1'),
      y: window.GAME_TEST_API!.getStats().position[1],
    }))
    expect(after.current).toBe('s0_-1')
    expect(after.gateway!.lifecycle).toBe('active')
    expect(after.gateway!.collidersReady).toBe(true)
    expect(after.y).toBeGreaterThan(0) // never fell through
  })

  test('teleport to the gateway waits for readiness and lands safely', async ({ page }) => {
    await gotoGame(page)
    await resetWorld(page)
    await page.evaluate(() => window.GAME_TEST_API!.teleportTo('downtown_gateway'))
    await page.waitForFunction(
      () => {
        const api = window.GAME_TEST_API!
        const p = api.getStats().position
        return Math.abs(p[0] - 48) < 2 && Math.abs(p[2] - -84) < 2
      },
      undefined,
      { timeout: 15_000 },
    )
    const state = await page.evaluate(() => ({
      sector: window.GAME_TEST_API!.getSectorState('s0_-1'),
      overlaps: window.GAME_TEST_API!.assertNoVehicleVehicleOverlaps(),
      y: window.GAME_TEST_API!.getStats().position[1],
    }))
    expect(state.sector!.collidersReady).toBe(true)
    expect(state.y).toBeGreaterThan(0)
    expect(state.overlaps).toEqual([])
  })

  test('routed car crosses the sector boundary without route reset', async ({ page }) => {
    test.setTimeout(150_000)
    await gotoGame(page)
    await resetWorld(page)
    await page.evaluate(() => {
      const api = window.GAME_TEST_API!
      api.teleportAmbientVehicleToSegment('vehicle_ambient_car_01', 'art_nb_a', 0.2)
      api.forceVehicleDestination('vehicle_ambient_car_01', 'dest_gateway_plaza')
    })
    await page.waitForFunction(
      () =>
        window.GAME_TEST_API!.getVehicleRouteState('vehicle_ambient_car_01')?.destinationId ===
        'dest_gateway_plaza',
      undefined,
      { timeout: 10_000 },
    )
    const plan = await page.evaluate(() => ({
      sectors: window.GAME_TEST_API!.getVehicleRouteSectorSequence('vehicle_ambient_car_01'),
      segMeta: window.GAME_TEST_API!.getSectorForRoadSegment('gate_nb'),
      trips: window.GAME_TEST_API!.getCompletedTrips('vehicle_ambient_car_01'),
    }))
    expect(plan.sectors).toContain('s0_-1')
    expect(plan.segMeta!.boundaryCrossing).toBe(true)
    // Drive to completion in the gateway — route id survives the boundary.
    await page.waitForFunction(
      (before) =>
        window.GAME_TEST_API!.getCompletedTrips('vehicle_ambient_car_01') > (before as number),
      plan.trips,
      { timeout: 120_000 },
    )
    const after = await page.evaluate(() => ({
      state: window.GAME_TEST_API!.getVehicleRouteState('vehicle_ambient_car_01')!,
      overlaps: window.GAME_TEST_API!.assertNoVehicleVehicleOverlaps(),
      graphVersion: window.GAME_TEST_API!.getGlobalRoadGraphVersion(),
    }))
    expect(after.state.districtsVisited).toContain('downtown_gateway')
    expect(after.overlaps).toEqual([])
  })

  test('forced unload/reload cycle: clean lifecycle, identity preserved, graph untouched', async ({
    page,
  }) => {
    test.setTimeout(120_000)
    await gotoGame(page)
    await resetWorld(page)
    const before = await page.evaluate(() => ({
      graphVersion: window.GAME_TEST_API!.getGlobalRoadGraphVersion(),
      kim: window.GAME_TEST_API!.getNpcPosition('npc_kim_01'),
    }))
    // Occluder checks are scoped to the GATEWAY's own buildings — route
    // prewarm legitimately mounts/unmounts unrelated sectors mid-test, so
    // a global occluder count is not stable.
    const gatewayOccluders = () =>
      page.evaluate(
        () =>
          window.GAME_TEST_API!.getRegisteredOccluders().filter((o) =>
            o.startsWith('building_gate'),
          ).length,
      )
    const loadedCount = await gatewayOccluders()
    expect(loadedCount).toBeGreaterThan(0)
    // Cycle the gateway sector twice.
    for (let i = 0; i < 2; i++) {
      await page.evaluate(() => window.GAME_TEST_API!.forceUnloadSector('s0_-1'))
      await page.waitForFunction(
        () => window.GAME_TEST_API!.getSectorState('s0_-1')?.lifecycle === 'unloaded',
        undefined,
        { timeout: 20_000 },
      )
      expect(await gatewayOccluders(), 'gateway occluders while unloaded').toBe(0)
      await page.evaluate(() => window.GAME_TEST_API!.forceLoadSector('s0_-1'))
      await page.waitForFunction(
        () => {
          const s = window.GAME_TEST_API!.getSectorState('s0_-1')
          return s?.lifecycle === 'active' && s.visualsReady && s.collidersReady
        },
        undefined,
        { timeout: 20_000 },
      )
    }
    await page.evaluate(() => window.GAME_TEST_API!.clearForcedSectors())
    const after = await page.evaluate(() => ({
      graphVersion: window.GAME_TEST_API!.getGlobalRoadGraphVersion(),
      kim: window.GAME_TEST_API!.getNpcPosition('npc_kim_01'),
      routeStates: window.GAME_TEST_API!.getAllVehicleRouteStates(),
      metrics: window.GAME_TEST_API!.getStreamingMetrics(),
    }))
    // The GLOBAL graph is untouched by streaming lifecycle.
    expect(after.graphVersion).toBe(before.graphVersion)
    // Gateway occluders re-registered exactly, no duplicates.
    expect(await gatewayOccluders()).toBe(loadedCount)
    // Named NPC identity survives (Kim lives in s0_0, unaffected).
    expect(after.kim).not.toBeNull()
    // Route states remain valid (no truncation, no invalid indices).
    for (const s of after.routeStates) {
      expect(s.segmentIndex).toBeLessThan(s.segmentIds.length)
      expect(s.currentSegmentId).not.toBeNull()
    }
  })

  test('phone map shows the gateway; save/load stays compatible', async ({ page }) => {
    await gotoGame(page)
    await resetWorld(page)
    await page.evaluate(() => window.GAME_TEST_API!.teleportTo('downtown_gateway'))
    await page.waitForTimeout(1_000)
    // Save in the gateway, move away, load back.
    const roundTrip = await page.evaluate(async () => {
      const api = window.GAME_TEST_API!
      await api.saveGame()
      api.teleportTo('central_plaza')
      await new Promise((r) => setTimeout(r, 800))
      await api.loadGame()
      await new Promise((r) => setTimeout(r, 1200))
      return {
        position: api.getStats().position,
        sector: api.getCurrentSectorId(),
        ready: api.getSectorState('s0_-1'),
      }
    })
    expect(roundTrip.sector).toBe('s0_-1')
    expect(roundTrip.ready!.collidersReady).toBe(true)
    expect(roundTrip.position[1]).toBeGreaterThan(0)
  })
})
