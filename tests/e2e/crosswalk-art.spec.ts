import { expect, test, type Page } from '@playwright/test'
import { gotoGame } from './helpers'

/**
 * Crosswalk Surface Art & Curb Furniture v1: the art layer is generated
 * from the crossing registries and must never change behavior — these
 * scenarios check coverage, alignment, furniture safety, and lifecycle.
 * (Rainy-night readability is pinned by visual baselines; the mixed soaks
 * of the crossing + destination suites run in the same gate.)
 */

const X = 's0_-2_harbor_cross'

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
    () => window.GAME_TEST_API!.getSectorState('s0_-2')?.visualsReady === true,
    undefined,
    { timeout: 20_000 },
  )
}

test.describe('crosswalk surface art', () => {
  test('every registered crossing has validated art: 4 signalized + 3 painted', async ({
    page,
  }) => {
    const errors: string[] = []
    page.on('pageerror', (err) => errors.push(String(err)))
    await gotoGame(page)
    const snap = await page.evaluate(() => {
      const api = window.GAME_TEST_API!
      const ids = api.getCrosswalkVisualIds()
      return {
        ids,
        validation: api.validateCrosswalkVisuals(),
        specs: ids.map((id) => api.getCrosswalkVisualSpec(id)!),
      }
    })
    expect(snap.ids).toHaveLength(7)
    expect(snap.validation).toEqual([])
    expect(snap.specs.filter((s) => s.kind === 'signalized')).toHaveLength(4)
    expect(snap.specs.filter((s) => s.kind === 'unsignalized')).toHaveLength(3)
    for (const spec of snap.specs) {
      expect(spec.stripeCount, spec.crossingId).toBeGreaterThanOrEqual(3)
      expect(spec.padPositions, spec.crossingId).toHaveLength(4)
      expect(spec.furniture, spec.crossingId).toHaveLength(2)
    }
    expect(errors).toEqual([])
  })

  test('curb furniture never blocks queued citizens', async ({ page }) => {
    test.setTimeout(150_000)
    await gotoGame(page)
    await arriveAtHarborCross(page)
    await page.evaluate(() => window.GAME_TEST_API!.setIntersectionElapsed(0.5))
    await page.waitForFunction(
      (id) =>
        window.GAME_TEST_API!.getCrossingPedestrians(id as string).some(
          (c) => c.queued.length > 0,
        ),
      X,
      { timeout: 40_000 },
    )
    const clearance = await page.evaluate((id) => {
      const api = window.GAME_TEST_API!
      const out: { citizen: string; post: string; distance: number }[] = []
      for (const c of api.getCrossingPedestrians(id as string)) {
        const furniture = api.getCrosswalkFurniture(c.crossingId)
        for (const cid of [...c.queued, ...c.crossing]) {
          const ped = api.getPedestrianCrossingState(cid)!
          for (const f of furniture) {
            out.push({
              citizen: cid,
              post: f.id,
              distance: Math.hypot(ped.position[0] - f.position[0], ped.position[1] - f.position[1]),
            })
          }
        }
      }
      return out
    }, X)
    expect(clearance.length).toBeGreaterThan(0)
    for (const c of clearance) {
      expect(c.distance, `${c.citizen} vs ${c.post}`).toBeGreaterThan(0.7)
    }
  })

  test('a crossing citizen stays inside the painted band', async ({ page }) => {
    await gotoGame(page)
    await arriveAtHarborCross(page)
    const check = await page.evaluate(() => {
      const api = window.GAME_TEST_API!
      api.setIntersectionElapsed(37)
      api.forceCitizenToCrossing('cit_hc_south_shuttle', 's0_-2_harbor_cross_cross_south', 0.5)
      const ped = api.getPedestrianCrossingState('cit_hc_south_shuttle')!
      const spec = api.getCrosswalkVisualSpec('s0_-2_harbor_cross_cross_south')!
      return { ped: ped.position, spec }
    })
    // Mid-crossing pose sits between the two tactile pads (the walking
    // line) — squarely on the painted band.
    const [a, b] = check.spec.padPositions.filter((p) => p.kind === 'tactile')
    expect(check.ped[0]).toBeGreaterThanOrEqual(Math.min(a.x, b.x))
    expect(check.ped[0]).toBeLessThanOrEqual(Math.max(a.x, b.x))
    expect(Math.abs(check.ped[1] - a.z)).toBeLessThan(1.2)
  })

  test('a red-holding car stops BEHIND the zebra band, never on it', async ({ page }) => {
    test.setTimeout(150_000)
    await gotoGame(page)
    await arriveAtHarborCross(page)
    await page.evaluate(() => {
      const api = window.GAME_TEST_API!
      api.setIntersectionElapsed(20.5) // long red for the south approach
      api.teleportAmbientVehicleToSegment('vehicle_ambient_car_01', 's0_-2_boulevard_fwd', 0.7)
      api.forceVehicleDestination('vehicle_ambient_car_01', 'dest_s0_-2_promenade')
    })
    await page.waitForFunction(() => {
      const car = window.GAME_TEST_API!
        .getTrafficState()
        .cars.find((c) => c.id === 'vehicle_ambient_car_01')
      return car !== undefined && car.speed < 0.2 && car.position[1] > -154
    }, undefined, { timeout: 30_000 })
    const carZ = await page.evaluate(
      () =>
        window.GAME_TEST_API!.getTrafficState().cars.find(
          (c) => c.id === 'vehicle_ambient_car_01',
        )!.position[1],
    )
    // South band spans z -154..-151.8; the stop line holds the car's
    // CENTER at -150.6 — with a half-car nose (~1.1) it stays clear of
    // the painted area.
    expect(carZ).toBeGreaterThan(-150.75)
  })

  test('painted crossings render specs and stay functional', async ({ page }) => {
    await gotoGame(page)
    await arriveAtHarborCross(page)
    const yard = await page.evaluate(() => {
      const api = window.GAME_TEST_API!
      const spec = api.getCrosswalkVisualSpec('s-1_-2_yard_rd_gate_walk')!
      api.forceCitizenToCrossing('cit_dd_yard_worker', 's-1_-2_yard_rd_gate_walk', 0.5)
      const ped = api.getPedestrianCrossingState('cit_dd_yard_worker')!
      return { spec, ped }
    })
    expect(yard.spec.kind).toBe('unsignalized')
    expect(yard.spec.furniture.every((f) => f.kind === 'unsignaledPost')).toBe(true)
    expect(yard.ped.crosswalkId).toBe('s-1_-2_yard_rd_gate_walk')
  })

  test('unload/reload keeps art valid with no duplicates and live signal heads', async ({
    page,
  }) => {
    test.setTimeout(150_000)
    const errors: string[] = []
    page.on('pageerror', (err) => errors.push(String(err)))
    await gotoGame(page)
    await arriveAtHarborCross(page)
    await page.evaluate(() => {
      window.GAME_TEST_API!.setIntersectionElapsed(21)
      window.GAME_TEST_API!.teleportTo('central_plaza')
    })
    await page.waitForTimeout(1_500)
    for (const cycle of [1, 2]) {
      await page.evaluate(() => window.GAME_TEST_API!.forceUnloadSector('s0_-2'))
      await page.waitForFunction(
        () => window.GAME_TEST_API!.getSectorState('s0_-2')?.lifecycle === 'unloaded',
        undefined,
        { timeout: 25_000 },
      )
      await page.evaluate(() => {
        window.GAME_TEST_API!.forceLoadSector('s0_-2')
      })
      await page.waitForFunction(
        () => window.GAME_TEST_API!.getSectorState('s0_-2')?.visualsReady === true,
        undefined,
        { timeout: 25_000 },
      )
      void cycle
    }
    await page.evaluate(() => window.GAME_TEST_API!.clearForcedSectors())
    const after = await page.evaluate(() => ({
      ids: window.GAME_TEST_API!.getCrosswalkVisualIds(),
      validation: window.GAME_TEST_API!.validateCrosswalkVisuals(),
      state: window.GAME_TEST_API!.getIntersectionState('s0_-2_harbor_cross'),
    }))
    expect(after.ids).toHaveLength(7) // registry-driven: reload adds nothing
    expect(after.validation).toEqual([])
    expect(after.state!.cycleLength).toBe(46) // heads read the same clock
    expect(errors).toEqual([])
  })
})
