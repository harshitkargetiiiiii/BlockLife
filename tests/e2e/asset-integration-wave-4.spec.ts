import { test, expect, type Page } from '@playwright/test'

/**
 * Issue #47 Integration Wave 4 — production render/lifecycle behaviour that needs a real browser.
 *
 * Everything statically checkable lives in `src/game/assets/wave4Contract.test.ts` (the mapping,
 * the projections, the authored data). What only a browser can answer is whether the shipped
 * bodies actually REACH the screen through the production path, whether a real load failure
 * restores the complete pre-wave visual, whether a failure of ONE body leaves the placements that
 * share the other bodies alone, and whether a streaming round-trip strands readiness state.
 *
 * Nothing here is stubbed: the failure cases abort the GLB request at the NETWORK layer before the
 * page loads, which is exactly what a deleted or truncated file does in production.
 */

type Api = Record<string, (...a: unknown[]) => unknown>
const call = (page: Page, m: string, ...a: unknown[]) =>
  page.evaluate(
    ([mm, aa]) => (window.GAME_TEST_API as unknown as Api)[mm as string](...(aa as unknown[])),
    [m, a] as const,
  )

interface CharacterState {
  id: string
  assetId: string
  activeVisual: string
  modelLoaded: boolean
  fallbackReason: string | null
  resolvedSlots: string[]
  appearance: { shirtColor?: string; skinColor?: string; accessoryVariant?: string } | null
}

interface Readiness {
  expected: number
  active: number
  failed: number
  pending: number
  epoch: number
  glbActive: string[]
  glbFailed: string[]
  glbPending: { id: string; pending: number }[]
}

/** The strict 1:1 mapping this wave ships (mirrors WAVE4_NAMED_BODIES). */
const NAMED: [string, string][] = [
  ['npc_ravi_01', 'blocklife_ravi_01'],
  ['npc_maya_01', 'blocklife_maya_01'],
  ['npc_bruno_01', 'blocklife_bruno_01'],
  ['npc_kim_01', 'blocklife_kim_01'],
  ['npc_nisha_01', 'blocklife_nisha_01'],
]

/** Parked-body asset id → shipped file, and how many placements each backs. */
const PARKED: { id: string; file: string; placements: number }[] = [
  { id: 'vehicle_parked_hatchback_01', file: 'parked_hatchback_01.glb', placements: 9 },
  { id: 'vehicle_parked_pickup_01', file: 'parked_pickup_01.glb', placements: 10 },
  { id: 'vehicle_parked_delivery_van_01', file: 'parked_delivery_van_01.glb', placements: 5 },
  { id: 'vehicle_parked_box_truck_01', file: 'parked_box_truck_01.glb', placements: 5 },
]

async function boot(page: Page): Promise<void> {
  await page.goto('/')
  await page.waitForFunction(() => window.GAME_TEST_API?.ready() === true, undefined, { timeout: 45_000 })
  await page.waitForFunction(() => window.GAME_TEST_API?.assetsSettled() === true, undefined, { timeout: 45_000 })
}

/** Every parked placement in one frame's worth of city: the central + industrial spread. */
async function settleAt(page: Page, at: [number, number]): Promise<void> {
  await call(page, 'teleportPlayer', [at[0], 1.2, at[1]])
  await page.waitForFunction(() => window.GAME_TEST_API!.assetsSettled() === true, undefined, { timeout: 45_000 })
}

test.describe('Wave 4 — named residents render their own approved body', () => {
  test('each of the five named residents loads ITS OWN model, never the fallback', async ({ page }) => {
    const errors: string[] = []
    page.on('pageerror', (e) => errors.push(String(e)))
    await boot(page)
    for (const [npc, assetId] of NAMED) {
      const st = (await call(page, 'getCharacterState', npc)) as CharacterState
      expect(st, `${npc} has a character state`).toBeTruthy()
      expect(st.assetId, `${npc} renders its own 1:1 body`).toBe(assetId)
      expect(st.activeVisual, `${npc} activeVisual`).toBe('model')
      expect(st.modelLoaded, `${npc} modelLoaded`).toBe(true)
      expect(st.fallbackReason, `${npc} fallbackReason`).toBeNull()
      // A baked body exposes no recolorable slot — that is WHY it may not be the player.
      expect(st.resolvedSlots, `${npc} exposes no wardrobe slot`).toEqual([])
      // The identity-rig fallback must NOT be mounted while the named body is healthy: the
      // healthy render is exactly ONE rig per NPC, as it was before the wave.
      const idle = await call(page, 'getCharacterState', `${npc}#identity`)
      expect(idle, `${npc} mounts no second rig while healthy`).toBeNull()
    }
    const pop = (await call(page, 'getCharacterPopulationStats')) as { byTier: Record<string, number> }
    expect(pop.byTier.namedNpc, 'six named NPCs, one rig each — no doubling').toBe(6)
    expect(errors, 'no page error while the five bodies mount').toEqual([])
  })

  test('the PLAYER is untouched: still the wardrobe rig, with its slots resolved', async ({ page }) => {
    await boot(page)
    const st = (await call(page, 'getCharacterState', 'player')) as CharacterState
    expect(st.assetId, 'the player rig').toBe('blocklife_person')
    expect(st.activeVisual, 'player activeVisual').toBe('model')
    expect(st.modelLoaded, 'player modelLoaded').toBe(true)
    // The save-backed wardrobe is exactly these slots; a baked body would resolve none of them.
    for (const slot of ['shirt', 'pants', 'hair']) {
      expect(st.resolvedSlots, `player exposes ${slot}`).toContain(slot)
    }
    for (const [, assetId] of NAMED) {
      expect(st.assetId, 'the player never wears a named body').not.toBe(assetId)
    }
  })

  test('Leo keeps the wardrobe rig and his delivery identity', async ({ page }) => {
    await boot(page)
    const st = (await call(page, 'getCharacterState', 'npc_leo_01')) as CharacterState
    expect(st.assetId, 'Leo stays procedural-capable').toBe('blocklife_person')
    expect(st.resolvedSlots.length, 'Leo keeps his recolorable axes').toBeGreaterThan(0)
    expect(st.appearance?.shirtColor, 'Leo keeps his hi-vis green').toBe('#6cc24a')
    expect(st.appearance?.accessoryVariant, 'Leo keeps his delivery bag').toBe('bag')
  })

  test('the player wardrobe survives save → reset → load, and the named bodies rehydrate', async ({ page }) => {
    await boot(page)
    const before = (await call(page, 'getCharacterState', 'player')) as CharacterState
    await call(page, 'setMoney', 4747)
    await call(page, 'saveGame')
    await call(page, 'resetGame')
    await call(page, 'loadGame')
    await page.waitForFunction(() => window.GAME_TEST_API!.assetsSettled() === true, undefined, { timeout: 45_000 })

    expect((await call(page, 'getStats')) as { money: number }).toMatchObject({ money: 4747 })
    const after = (await call(page, 'getCharacterState', 'player')) as CharacterState
    expect(after.assetId, 'the player rig after load').toBe('blocklife_person')
    expect(after.appearance, 'the save-backed appearance round-trips unchanged').toEqual(before.appearance)
    for (const [npc, assetId] of NAMED) {
      const st = (await call(page, 'getCharacterState', npc)) as CharacterState
      expect(st.assetId, `${npc} rehydrated`).toBe(assetId)
      expect(st.modelLoaded, `${npc} model rehydrated`).toBe(true)
    }
  })

  test('an unreachable named GLB restores the PRE-WAVE RIG with her registry identity', async ({ page }) => {
    // Maya's body is aborted at the network layer; nothing in the app is stubbed or disabled.
    //
    // The claim being proved is the strong one: the fallback is not a coloured capsule, it is the
    // wardrobe-capable `blocklife_person` rig wearing Maya's curated identity — i.e. EXACTLY what
    // this NPC rendered before the wave. The chain is
    //   approved named body → blocklife_person + registry identity → the capsule
    // and only the middle step may be on screen here.
    await page.route('**/blocklife_maya_01.glb', (route) => route.abort())
    await boot(page)
    const maya = (await call(page, 'getCharacterState', 'npc_maya_01')) as CharacterState
    expect(maya.activeVisual, 'the named body is NOT what is rendering').toBe('primitive')
    expect(maya.modelLoaded, 'no named model is loaded').toBe(false)
    expect(maya.fallbackReason, 'the failure is recorded, not silent').toBeTruthy()
    // The slot identity is unchanged, so restoring the file brings the same character back.
    expect(maya.assetId, 'the slot still names her own body').toBe('blocklife_maya_01')

    // …and THIS is what the player actually sees.
    const rig = (await call(page, 'getCharacterState', 'npc_maya_01#identity')) as CharacterState
    expect(rig, 'the identity rig mounted as the fallback').toBeTruthy()
    expect(rig.assetId, 'the fallback is the pre-wave wardrobe rig').toBe('blocklife_person')
    expect(rig.activeVisual, 'the rig really is on screen').toBe('model')
    expect(rig.modelLoaded, 'the rig model loaded').toBe(true)
    expect(rig.appearance?.shirtColor, 'Maya keeps her signature pink').toBe('#e0576f')
    expect(rig.appearance?.skinColor, 'Maya keeps her curated skin tone').toBe('#c68642')
    expect(rig.appearance?.accessoryVariant, 'and her curated accessory axis').toBe('none')
    for (const slot of ['shirt', 'pants', 'hair']) {
      expect(rig.resolvedSlots, `the fallback rig exposes ${slot}`).toContain(slot)
    }

    // Failure of ONE named body must not touch the others (they are separate files AND separate
    // manifest entries, so this is the character-class shared-source isolation check).
    for (const [npc, assetId] of NAMED) {
      if (npc === 'npc_maya_01') continue
      const st = (await call(page, 'getCharacterState', npc)) as CharacterState
      expect(st.assetId, `${npc} unaffected`).toBe(assetId)
      expect(st.activeVisual, `${npc} still renders its model`).toBe('model')
    }
  })
})

test.describe('Wave 4 — parked bodies reach the street, and fail safely', () => {
  test('all four parked bodies mount, and every placement is covered', async ({ page }) => {
    const errors: string[] = []
    page.on('pageerror', (e) => errors.push(String(e)))
    await boot(page)
    const r = (await call(page, 'getAssetReadiness')) as Readiness
    for (const { id } of PARKED) {
      expect(r.glbActive, `${id} is on screen`).toContain(id)
      expect(r.glbFailed, `${id} did not fail`).not.toContain(id)
    }
    expect(r.pending, 'nothing left pending').toBe(0)
    expect(errors, 'no page error from the parked bodies').toEqual([])
  })

  test('aborting ONE parked body leaves the placements sharing the others alone', async ({ page }) => {
    // Shared-source isolation: the hatchback backs 9 placements and the pickup 10, from ONE file
    // each. A failure of the hatchback must fail exactly its own placements.
    await page.route('**/parked_hatchback_01.glb', (route) => route.abort())
    await boot(page)
    const r = (await call(page, 'getAssetReadiness')) as Readiness
    expect(r.glbFailed, 'the aborted body is recorded as failed').toContain('vehicle_parked_hatchback_01')
    expect(r.glbActive, 'the aborted body is not also active').not.toContain('vehicle_parked_hatchback_01')
    for (const { id } of PARKED) {
      if (id === 'vehicle_parked_hatchback_01') continue
      expect(r.glbActive, `${id} still rendered`).toContain(id)
      expect(r.glbFailed, `${id} not collaterally failed`).not.toContain(id)
    }
    // …and the rest of the city is unaffected too.
    expect(r.glbActive, 'the building body is unaffected').toContain('building_gate_tower_02')
  })

  test('a streaming unload → reload leaves no stale active/failed state', async ({ page }) => {
    const errors: string[] = []
    page.on('pageerror', (e) => errors.push(String(e)))
    await boot(page)
    // The census is POSITION-dependent (which sectors are streamed in decides how many instances
    // are mounted), so the round-trip is measured from the SAME vantage point at both ends —
    // comparing against the boot position would compare two different cities.
    /**
     * A round trip is measured between two round trips, not against the boot state.
     *
     * The census is POSITION-dependent AND warm-up-dependent: how many GLB instances are mounted
     * depends on which sectors are streamed in, and the set right after boot is still settling
     * toward its steady state. Comparing the post-trip census against the boot census therefore
     * compares two different cities and says nothing about leaking. What a LEAK looks like is
     * accumulation — a stale `active` claim from a torn-down generation that is never released —
     * so the test does the trip TWICE and asserts the census is IDEMPOTENT across them.
     */
    const roundTrip = async (): Promise<Readiness> => {
      await settleAt(page, [260, -100]) // far east: the central sector unloads entirely
      await page.waitForTimeout(2500)
      await settleAt(page, [12, -1]) // back to the plaza
      await page.waitForTimeout(1500)
      await page.waitForFunction(() => window.GAME_TEST_API!.assetsSettled() === true, undefined, { timeout: 45_000 })
      return (await call(page, 'getAssetReadiness')) as Readiness
    }

    const trips = [await roundTrip(), await roundTrip(), await roundTrip()]
    // eslint-disable-next-line no-console
    console.log(
      'WAVE4_STREAMING ' +
        JSON.stringify(trips.map((r) => ({ e: r.expected, a: r.active, f: r.failed, ids: r.glbActive.length }))),
    )

    for (const [i, r] of trips.entries()) {
      // The STRUCTURAL invariant, and the one that actually catches a leaked claim: `expected`
      // and `active` are decremented by the same unmount, so an `active` claim left behind by a
      // torn-down generation shows up as active > expected, i.e. a negative pending.
      expect(r.failed, `trip ${i + 1}: no stranded failure`).toBe(0)
      expect(r.pending, `trip ${i + 1}: nothing stuck pending`).toBe(0)
      expect(r.active, `trip ${i + 1}: no claim outlives its instance`).toBeLessThanOrEqual(r.expected)
      expect(r.expected, `trip ${i + 1}: expected == active + failed, nothing half-claimed`).toBe(
        r.active + r.failed,
      )
      for (const { id } of PARKED) expect(r.glbActive, `trip ${i + 1}: ${id} remounted`).toContain(id)
      expect(r.glbActive, `trip ${i + 1}: the building body remounted`).toContain('building_gate_tower_02')
    }
    // The instance COUNT is position- and prewarm-dependent (how many sectors are streamed in
    // decides how many instances exist), so equality across trips is not an invariant and this
    // does not pretend it is. What a leak looks like is ACCUMULATION, so the check is that the
    // census does not grow monotonically across three identical round trips.
    expect(trips[2].active, 'the census does not accumulate across round trips').toBeLessThanOrEqual(
      Math.max(trips[0].active, trips[1].active),
    )
    // …and the SET of bodies that came back is identical every time.
    const ids = trips.map((r) => [...r.glbActive].sort().join(','))
    expect(ids[1], 'the same bodies remount on every trip').toBe(ids[0])
    expect(ids[2], 'the same bodies remount on every trip').toBe(ids[0])
    expect(errors, 'no page error across the streaming round-trip').toEqual([])
  })

  test('an unreachable parked GLB restores the complete procedural vehicle', async ({ page }) => {
    await page.route('**/parked_delivery_van_01.glb', (route) => route.abort())
    await boot(page)
    const r = (await call(page, 'getAssetReadiness')) as Readiness
    expect(r.glbFailed).toContain('vehicle_parked_delivery_van_01')
    // The placement itself is untouched: colliders, ids and the whole authored city still
    // validate, which is what "a failed model changes only pixels" means.
    const reports = (await call(page, 'getPlacementReport')) as { sectorId: string; failures: unknown[] }[]
    for (const rep of reports) expect(rep.failures, `${rep.sectorId} placement failures`).toEqual([])
  })
})

test.describe('Wave 4 — the building body changes pixels only', () => {
  test('the gateway tower renders its GLB and every district still validates', async ({ page }) => {
    await boot(page)
    await settleAt(page, [34, -94]) // the placement itself
    const r = (await call(page, 'getAssetReadiness')) as Readiness
    expect(r.glbActive, 'the tower body is on screen').toContain('building_gate_tower_02')
    const reports = (await call(page, 'getPlacementReport')) as { sectorId: string; failures: unknown[] }[]
    expect(reports.length, 'at least one sector reported').toBeGreaterThan(0)
    for (const rep of reports) expect(rep.failures, `${rep.sectorId} placement failures`).toEqual([])
  })

  test('the whole city still certifies with the new bodies in place', async ({ page }) => {
    await boot(page)
    const cert = (await call(page, 'getCityCertification')) as { verdict: string; passed: number; totalDistricts: number }
    expect(cert.verdict, 'city certification verdict').toBe('pass')
    expect(cert.passed, 'districts certified').toBe(cert.totalDistricts)
  })

  test('an unreachable tower GLB restores the complete procedural building', async ({ page }) => {
    await page.route('**/arch_apartment_02.glb', (route) => route.abort())
    await boot(page)
    await settleAt(page, [34, -94])
    const r = (await call(page, 'getAssetReadiness')) as Readiness
    expect(r.glbFailed, 'the aborted tower is recorded as failed').toContain('building_gate_tower_02')
    const reports = (await call(page, 'getPlacementReport')) as { sectorId: string; failures: unknown[] }[]
    for (const rep of reports) expect(rep.failures, `${rep.sectorId} placement failures`).toEqual([])
  })
})

test.describe('Wave 4 — measured cost in the four districts the issue names', () => {
  /**
   * The issue asks for frame-time / draw-call / skinned-mesh measurements in dense central,
   * residential, industrial and gateway views. These are DEV-probe readings from the real
   * renderer, logged for the delivery report and asserted against the suite's existing ceilings
   * — the point is the recorded number, not a tighter bound invented here.
   */
  const VIEWS: [string, [number, number]][] = [
    ['central', [0, 0]],
    ['residential', [-6, -54.5]],
    ['industrial', [59.5, 8]],
    ['gateway', [34, -94]],
  ]

  /**
   * GPU texture census ceiling — the gate that keeps a healthy named body from paying for its own
   * fallback.
   *
   * `NpcCharacter` mounts the identity rig only on a real FAILURE of the named body, never while
   * that body is merely loading. An earlier revision conflated the two branches: React renders
   * the Suspense placeholder on every healthy load, so five extra `blocklife_person` clones were
   * instantiated and uploaded on every boot and every sector remount, and this census rose from
   * 274–276 to 329–331 while every other number — draw calls, triangles, materials, the settled
   * instance registry — stayed identical. That is exactly the class of regression a settled-state
   * assertion cannot see, so it is gated on the measurement rather than on the registry.
   *
   * 300 sits above the measured healthy range with real headroom and well below the regressed
   * one; the suite-wide ceiling of 400 stays in force underneath it.
   */
  const HEALTHY_TEXTURE_CEILING = 300
  for (const [name, at] of VIEWS) {
    test(`${name}: draw calls, triangles and skinned population are within budget`, async ({ page }) => {
      await boot(page)
      await call(page, 'resetGame')
      await call(page, 'setTime', 13)
      await call(page, 'setWeather', 'clear')
      await settleAt(page, at)
      await page.waitForTimeout(2500)
      const render = (await call(page, 'getRenderStats')) as Record<string, number>
      const pop = (await call(page, 'getCharacterPopulationStats')) as {
        total: number
        modelActive: number
        maxRiggedAmbient: number
      }
      const materials = (await call(page, 'getMaterialStats')) as { uniqueMaterials: number }
      // eslint-disable-next-line no-console
      console.log(`WAVE4_PERF ${name} ` + JSON.stringify({ render, pop, materials }))
      expect(render.drawCalls, `${name} draw calls`).toBeGreaterThan(0)
      expect(render.drawCalls, `${name} draw calls`).toBeLessThan(2500)
      expect(render.triangles, `${name} triangles`).toBeLessThan(4_000_000)
      expect(render.textures, `${name} textures (suite ceiling)`).toBeLessThan(400)
      // …and the tighter one that catches a fallback mounting on the healthy path.
      expect(
        render.textures,
        `${name}: a healthy named body must not pay its fallback's texture cost`,
      ).toBeLessThan(HEALTHY_TEXTURE_CEILING)
      // The settled registry must agree: no identity rig is mounted anywhere.
      for (const [npc] of NAMED) {
        expect(
          await call(page, 'getCharacterState', `${npc}#identity`),
          `${name}: ${npc} has no identity rig mounted`,
        ).toBeNull()
      }
      // The nearby full-tier skinned count is bounded by the issue #23 cap, which this wave does
      // not raise: five named bodies replace five procedural ones, they do not add a sixth.
      expect(pop.modelActive, `${name} skinned bodies rendering a GLB`).toBeLessThanOrEqual(
        pop.maxRiggedAmbient + 8,
      )
    })
  }
})
