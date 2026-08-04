import { test, expect, type Page } from '@playwright/test'

/**
 * 3D Asset Pipeline v1 (issue #21 §13) production-path E2E — the render/lifecycle
 * behaviours that need a real browser (unit-testable claims live in
 * src/game/assets/round2Contract.test.ts). Deterministic: paused/settled state read
 * through the dev API.
 */
type Api = Record<string, (...a: unknown[]) => unknown>
const call = (page: Page, m: string, ...a: unknown[]) =>
  page.evaluate(([mm, aa]) => (window.GAME_TEST_API as unknown as Api)[mm as string](...(aa as unknown[])), [m, a] as const)

async function boot(page: Page): Promise<void> {
  await page.goto('/')
  await page.waitForFunction(() => window.GAME_TEST_API?.ready() === true, undefined, { timeout: 45_000 })
  await page.waitForFunction(() => window.GAME_TEST_API?.assetsSettled() === true, undefined, { timeout: 45_000 })
}
async function settled(page: Page): Promise<void> {
  await page.waitForFunction(() => window.GAME_TEST_API!.assetsSettled() === true, undefined, { timeout: 30_000 })
}

test.describe('§13 asset pipeline — production render/lifecycle', () => {
  // #5 + #25: the named NPCs and the player render the PRIMARY GLB model, never the
  // primitive fallback (a silent fallback is NOT a passing asset).
  test('named NPCs + player load the primary model, not the fallback', async ({ page }) => {
    await boot(page)
    for (const id of ['npc_maya_01', 'npc_ravi_01', 'player']) {
      const st = (await call(page, 'getCharacterState', id)) as {
        activeVisual: string
        modelLoaded: boolean
        fallbackReason: string | null
      }
      expect(st.activeVisual, `${id}.activeVisual`).toBe('model')
      expect(st.modelLoaded, `${id}.modelLoaded`).toBe(true)
      expect(st.fallbackReason, `${id}.fallbackReason`).toBeNull()
    }
  })

  // #21 + #22: save → reset → load keeps gameplay state AND the visuals rehydrate to the
  // real models (no stuck-on-fallback, no ghost) — asset identity is decoupled from save.
  test('save→reset→load preserves state and rehydrates character models', async ({ page }) => {
    await boot(page)
    await call(page, 'setMoney', 4242)
    await call(page, 'saveGame')
    await call(page, 'resetGame')
    await call(page, 'loadGame')
    await settled(page)
    expect((await call(page, 'getStats')) as { money: number }).toMatchObject({ money: 4242 })
    const maya = (await call(page, 'getCharacterState', 'npc_maya_01')) as { modelLoaded: boolean }
    expect(maya.modelLoaded, 'Maya model rehydrated after load').toBe(true)
  })

  // #9: an ACTIVE owned class drives the ONE physical shell; the projection embodies that
  // class (one-shell physics), and the scene re-settles with its GLB — for all four classes.
  for (const [defId, cls] of [
    ['veh_compact', 'compact'],
    ['veh_scooter', 'scooter'],
    ['veh_van', 'van'],
    ['veh_sports', 'sports'],
  ] as const) {
    test(`active ${cls} projects onto the one shell + its GLB settles`, async ({ page }) => {
      await boot(page)
      await call(page, 'resetGame')
      await call(page, 'setMoney', 200_000)
      await call(page, 'vehicleGrant', defId, { location: 'active' })
      const proj = (await call(page, 'getVehicleProjection')) as { defId: string }
      expect(proj.defId, 'shell embodies the active class').toBe(defId)
      await settled(page) // the freshly-granted class GLB loads without stranding the scene
    })
  }

  // #4: the SAME production character path that draws the player can drive a Meshy humanoid
  // (the representative-player avatar path) — proving the path isn't NPC-only.
  test('representative-player path drives a Meshy humanoid, never the fallback (#4)', async ({ page }) => {
    await boot(page)
    // Default player = the wardrobe rig with correct idle/walk/run.
    const before = (await call(page, 'getCharacterState', 'player')) as { modelLoaded: boolean }
    expect(before.modelLoaded, 'default player model loaded').toBe(true)
    // Override the player asset → the same path renders the Meshy male humanoid.
    await call(page, 'setPlayerCharacterAsset', 'blocklife_male_01')
    await page.waitForTimeout(2000)
    const after = (await call(page, 'getCharacterState', 'player')) as {
      activeVisual: string
      modelLoaded: boolean
      fallbackReason: string | null
    }
    expect(after.activeVisual, 'player renders a model').toBe('model')
    expect(after.modelLoaded, 'the Meshy player model loaded via the production path').toBe(true)
    expect(after.fallbackReason, 'no fallback').toBeNull()
  })

  // #16: drei's useGLTF shares ONE cached scene per URL — a GLB is fetched at most once no
  // matter how many instances render. The office and the backdrop tower reuse Building_Large_2,
  // so a single fetch backs both placements (the reuse the whole §6 story depends on).
  test('each GLB is fetched at most once and shared across instances', async ({ page }) => {
    const hits = new Map<string, number>()
    page.on('request', (req) => {
      const u = req.url()
      if (u.split('?')[0].endsWith('.glb')) hits.set(u, (hits.get(u) ?? 0) + 1)
    })
    await boot(page)
    const large2 = [...hits.entries()].find(([u]) => u.includes('quaternius_building_large_2'))
    expect(large2, 'Building_Large_2 fetched at boot').toBeDefined()
    expect(large2![1], 'shared archetype fetched ONCE for both office + tower').toBe(1)
    for (const [u, n] of hits) expect(n, `${u} fetched at most once`).toBeLessThanOrEqual(1)
  })

  // #17: GLB visuals survive ordinary streaming. Teleport far to unload the central sector, then
  // back; the scene re-settles with its models and never throws — a stale/ghost mesh or a
  // throwing per-frame mount on remount would surface as a pageerror or a stuck settle.
  test('central GLBs survive a sector unload→reload round-trip', async ({ page }) => {
    const errors: string[] = []
    page.on('pageerror', (e) => errors.push(String(e)))
    await boot(page)
    await call(page, 'teleportPlayer', [80, 1.2, -35]) // far east district → central unloads
    await page.waitForTimeout(2500)
    await call(page, 'teleportPlayer', [12, 1.2, -1]) // back to the plaza → central re-mounts
    await settled(page)
    expect(errors, 'no pageerror across streaming').toEqual([])
    expect(await call(page, 'assetsSettled'), 're-settled after reload').toBe(true)
    const stats = (await call(page, 'getRenderStats')) as { drawCalls: number }
    expect(stats.drawCalls, 'the reloaded scene is actually drawing').toBeGreaterThan(0)
  })

  // Regression guard for the "stranded loading overlay" failure mode: the overlay is gated on
  // world-readiness (a GLB can NEVER hang boot — the primitive fallback shows first, the model
  // swaps in under it), so once the world is ready the overlay is detached and assets settle.
  test('the loading overlay is not stranded — it lifts once the world is ready', async ({ page }) => {
    await page.goto('/')
    await page.waitForFunction(() => window.GAME_TEST_API?.ready() === true, undefined, { timeout: 45_000 })
    await expect(page.getByTestId('loading-overlay')).toHaveCount(0)
    await settled(page) // GLBs settle independently, shortly after readiness
  })

  // display==execution: the GLB visual layer — palette slots on 4 archetypes + the tower's live
  // paletteVariant — must not perturb authored placement/collision. Every streamed sector still
  // validates to ZERO placement defects, so what's drawn never diverges from what's collidable.
  test('GLB + palette-variant visuals keep authored placement valid (0 defects)', async ({ page }) => {
    await boot(page)
    const reports = (await call(page, 'getPlacementReport')) as { sectorId: string; failures: unknown[] }[]
    expect(reports.length, 'at least one sector reported').toBeGreaterThan(0)
    for (const r of reports) expect(r.failures, `${r.sectorId} placement failures`).toEqual([])
  })
})
