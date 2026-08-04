import { test, expect, type Page } from '@playwright/test'

/**
 * Performance capture (issue #21 §12). Reads the renderer's per-frame stats (via the
 * PerfProbe → getRenderStats) on a deterministic city scene, prints them for the
 * delivery report, and asserts regression BOUNDS so a future draw-call / triangle /
 * texture explosion fails the gate. Numbers are logged (PERF_STATS:) rather than
 * baked into brittle equality — the browser regression budget is a ceiling, not a hash.
 */
type Api = Record<string, (...a: unknown[]) => unknown>
const call = (page: Page, m: string, ...a: unknown[]) =>
  page.evaluate(([mm, aa]) => (window.GAME_TEST_API as unknown as Api)[mm as string](...(aa as unknown[])), [m, a] as const)

async function boot(page: Page): Promise<void> {
  await page.goto('/')
  await page.waitForFunction(() => window.GAME_TEST_API?.ready() === true, undefined, { timeout: 45_000 })
  await page.waitForFunction(() => window.GAME_TEST_API?.assetsSettled() === true, undefined, { timeout: 45_000 })
}

interface Stats {
  drawCalls: number
  triangles: number
  geometries: number
  textures: number
  programs: number
  frameMs: number
  fps: number
  samples: number
  jsHeapMB: number | null
}

test.describe('§12 GLB scene performance', () => {
  test('central city scene (GLB buildings + character NPCs) stays within the browser budget', async ({ page }) => {
    await boot(page)
    await call(page, 'resetGame')
    await call(page, 'setTime', 13)
    await call(page, 'setWeather', 'clear')
    await call(page, 'teleportPlayer', [0, 1.2, 0])
    await page.waitForTimeout(2500) // let frames accumulate for a stable draw-call/FPS sample
    const s = (await call(page, 'getRenderStats')) as Stats
    console.log('PERF_STATS_city:' + JSON.stringify(s))

    expect(s.samples, 'the probe ran').toBeGreaterThan(20)
    expect(s.drawCalls, 'draw calls > 0').toBeGreaterThan(0)
    // An orthographic low-poly city with GLB assets stays modest — a regression trips these.
    expect(s.drawCalls, 'draw-call ceiling').toBeLessThan(2500)
    expect(s.triangles, 'triangle ceiling').toBeLessThan(4_000_000)
    expect(s.textures, 'texture ceiling').toBeLessThan(400)
  })

  test('driving a GLB vehicle adds one shell, not a runaway (traversal is bounded)', async ({ page }) => {
    await boot(page)
    await call(page, 'resetGame')
    await call(page, 'setMoney', 200_000)
    await call(page, 'vehicleGrant', 'veh_van', { location: 'active' })
    await call(page, 'teleportPlayer', [0, 1.2, 0])
    await page.waitForTimeout(2500)
    const s = (await call(page, 'getRenderStats')) as Stats
    console.log('PERF_STATS_driving:' + JSON.stringify(s))
    expect(s.drawCalls).toBeLessThan(2500)
    expect(s.triangles).toBeLessThan(4_000_000)
  })
})
