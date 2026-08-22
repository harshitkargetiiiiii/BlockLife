import { expect, test } from '@playwright/test'
import { gotoGame } from './helpers'

/**
 * District Authoring Kit v1: the Main Street East proof sector — compiled
 * entirely from templates — streams, collides, routes, walks and maps like
 * any hand-authored sector.
 */

test.describe('district authoring kit', () => {
  test('kit validates live: templates, compiled counts, source refs, zero errors', async ({
    page,
  }) => {
    const errors: string[] = []
    page.on('pageerror', (err) => errors.push(String(err)))
    await gotoGame(page)
    const snapshot = await page.evaluate(() => {
      const api = window.GAME_TEST_API!
      return {
        templates: api.getAuthoringTemplates(),
        compiled: api.getCompiledSectorContent('s1_-1'),
        validation: api.validateSectorAuthoring('s1_-1'),
        sourceRef: api.getAuthoringSourceRef('s1_-1_n1'),
        ownership: api.validateSectorOwnership(),
      }
    })
    expect(snapshot.templates.roads.length).toBeGreaterThanOrEqual(3)
    expect(snapshot.templates.buildings.length).toBeGreaterThanOrEqual(8)
    expect(snapshot.compiled!.buildings).toBe(5)
    expect(snapshot.compiled!.props).toBeGreaterThanOrEqual(8)
    expect(snapshot.compiled!.citizens).toBe(4) // walkers + polish-pass shop queue
    expect(snapshot.validation).toEqual([])
    expect(snapshot.sourceRef).toEqual({
      sectorId: 's1_-1',
      templateId: 'office_tower',
      localId: 'n1',
    })
    expect(snapshot.ownership).toEqual([])
    expect(errors).toEqual([])
  })

  test('teleport to Main Street East: sector ready, colliders present, citizens alive', async ({
    page,
  }) => {
    test.setTimeout(90_000)
    await gotoGame(page)
    await page.evaluate(() => {
      window.GAME_TEST_API!.resetGame()
      window.GAME_TEST_API!.setTime(11)
      window.GAME_TEST_API!.teleportTo('main_street_east')
    })
    await page.waitForFunction(
      () => {
        const api = window.GAME_TEST_API!
        const p = api.getStats().position
        return Math.abs(p[0] - 94) < 3 && api.getSectorState('s1_-1')?.collidersReady === true
      },
      undefined,
      { timeout: 20_000 },
    )
    const state = await page.evaluate(() => ({
      sector: window.GAME_TEST_API!.getCurrentSectorId(),
      y: window.GAME_TEST_API!.getStats().position[1],
      citizens: window.GAME_TEST_API!
        .getAmbientCitizens()
        .filter((c) => c.id.startsWith('s1_-1_')),
    }))
    expect(state.sector).toBe('s1_-1')
    expect(state.y).toBeGreaterThan(0)
    expect(state.citizens.length).toBeGreaterThanOrEqual(1)
  })

  test('routed traffic drives the compiled road to the kit destination', { tag: '@simulation-only' }, async ({ page }) => {
    test.setTimeout(180_000)
    await gotoGame(page)
    await page.evaluate(() => {
      window.GAME_TEST_API!.resetGame()
      window.GAME_TEST_API!.setTime(10)
      window.GAME_TEST_API!.setTrafficRoutingSeed(1)
    })
    await page.waitForTimeout(600)
    await page.evaluate(() => {
      const api = window.GAME_TEST_API!
      api.teleportAmbientVehicleToSegment('vehicle_ambient_car_01', 'art_nb_a', 0.3)
      api.forceVehicleDestination('vehicle_ambient_car_01', 'dest_s1_-1_main_row')
    })
    await page.waitForFunction(
      () =>
        window.GAME_TEST_API!.getVehicleRouteState('vehicle_ambient_car_01')?.destinationId ===
        'dest_s1_-1_main_row',
      undefined,
      { timeout: 10_000 },
    )
    const plan = await page.evaluate(
      () => window.GAME_TEST_API!.getVehicleRouteState('vehicle_ambient_car_01')!.segmentIds,
    )
    expect(plan).toContain('gate_nb')
    expect(plan[plan.length - 1]).toBe('s1_-1_main_st_fwd')
    const before = await page.evaluate(
      () => window.GAME_TEST_API!.getCompletedTrips('vehicle_ambient_car_01'),
    )
    await page.waitForFunction(
      (b) => window.GAME_TEST_API!.getCompletedTrips('vehicle_ambient_car_01') > (b as number),
      before,
      { timeout: 150_000 },
    )
    const overlaps = await page.evaluate(() =>
      window.GAME_TEST_API!.assertNoVehicleVehicleOverlaps(),
    )
    expect(overlaps).toEqual([])
  })

  test('streaming cycle: unload/reload twice with no duplicate resources', async ({ page }) => {
    test.setTimeout(120_000)
    await gotoGame(page)
    // Far sectors stay UNLOADED at boot since the expansion — wait only for
    // the sectors that are actually mounting, and scope occluder checks to
    // s1_-1's own ids (route prewarm mounts unrelated sectors mid-test).
    await page.waitForFunction(
      () =>
        window.GAME_TEST_API!.getSectorRuntimeStates()
          .filter((s) => s.lifecycle !== 'unloaded')
          .every((s) => s.visualsReady && s.collidersReady),
      undefined,
      { timeout: 25_000 },
    )
    const before = await page.evaluate(() => ({
      graphVersion: window.GAME_TEST_API!.getGlobalRoadGraphVersion(),
    }))
    const sectorOccluders = () =>
      page.evaluate(
        () =>
          window.GAME_TEST_API!.getRegisteredOccluders().filter((o) => o.startsWith('s1_-1_'))
            .length,
      )
    for (let i = 0; i < 2; i++) {
      await page.evaluate(() => window.GAME_TEST_API!.forceUnloadSector('s1_-1'))
      await page.waitForFunction(
        () => window.GAME_TEST_API!.getSectorState('s1_-1')?.lifecycle === 'unloaded',
        undefined,
        { timeout: 20_000 },
      )
      const whileUnloaded = await sectorOccluders()
      expect(whileUnloaded, 'no s1_-1 occluders while unloaded').toBe(0)
      await page.evaluate(() => window.GAME_TEST_API!.forceLoadSector('s1_-1'))
      await page.waitForFunction(
        () => {
          const s = window.GAME_TEST_API!.getSectorState('s1_-1')
          return s?.lifecycle === 'active' && s.visualsReady && s.collidersReady
        },
        undefined,
        { timeout: 20_000 },
      )
      const whileLoaded = await sectorOccluders()
      expect(whileLoaded, 's1_-1 occluders while loaded').toBeGreaterThan(0)
    }
    await page.evaluate(() => window.GAME_TEST_API!.clearForcedSectors())
    const after = await page.evaluate(() => ({
      graphVersion: window.GAME_TEST_API!.getGlobalRoadGraphVersion(),
    }))
    expect(after.graphVersion).toBe(before.graphVersion)
  })
})
