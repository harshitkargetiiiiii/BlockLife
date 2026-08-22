import { test, expect, type Page } from '@playwright/test'

/**
 * Render-suppression guard (branch e2e-ci-telemetry-probe). Runs WITHOUT VITE_SUPPRESS_AFTER_SETTLE
 * (the normal-render context) to prove a normal-render run can never inherit suppression: it is
 * default-off, stays off across resetGame + settle, and is only ever engaged by the explicit DEV
 * control. Lives under tests/diagnostics so it is not in the 8-shard merge gate.
 */
type Api = Record<string, (...a: unknown[]) => unknown>
const call = (page: Page, m: string, ...a: unknown[]) =>
  page.evaluate(([mm, aa]) => (window.GAME_TEST_API as unknown as Api)[mm as string](...(aa as unknown[])), [m, a] as const)

async function boot(page: Page) {
  await page.goto('/')
  await page.waitForFunction(() => window.GAME_TEST_API?.ready() === true, undefined, { timeout: 45_000 })
}

test.describe('render-suppression guard (normal-render context)', () => {
  test('default off, stays off across resetGame + settle (no accidental inheritance)', async ({ page }) => {
    test.setTimeout(90_000)
    await boot(page)
    expect(await call(page, 'isRenderSuppressed'), 'default must be off').toBe(false)
    await call(page, 'resetGame')
    await call(page, 'setTime', 12)
    await call(page, 'teleportPlayer', [12, 1.2, 2])
    await page.waitForFunction(() => window.GAME_TEST_API?.assetsSettled() === true, undefined, { timeout: 45_000 }).catch(() => {})
    await page.waitForTimeout(4_000) // well past the auto-engage warmup — must NOT engage without the env
    expect(await call(page, 'isRenderSuppressed'), 'must not auto-engage in a normal-render run').toBe(false)
  })

  test('explicit enable/disable works and resetGame clears it', async ({ page }) => {
    test.setTimeout(60_000)
    await boot(page)
    await call(page, 'setRenderSuppressed', true)
    expect(await call(page, 'isRenderSuppressed')).toBe(true)
    await call(page, 'setRenderSuppressed', false)
    expect(await call(page, 'isRenderSuppressed')).toBe(false)
    await call(page, 'setRenderSuppressed', true)
    await call(page, 'resetGame')
    expect(await call(page, 'isRenderSuppressed'), 'resetGame must clear suppression').toBe(false)
  })
})
