import { expect, test } from '@playwright/test'
import { gotoGame } from './helpers'

/** Weather System v1: deterministic director, effects, reactions, UI. */
test.describe('weather system', { tag: '@simulation-only' }, () => {
  test('day 1 starts clear and the HUD/phone show the weather', async ({ page }) => {
    await gotoGame(page)
    await page.evaluate(() => window.GAME_TEST_API!.resetGame())
    await page.waitForTimeout(300)

    const state = await page.evaluate(() => window.GAME_TEST_API!.getWeatherState())
    expect(state.kind).toBe('clear')
    expect(state.scheduled).toBe('clear')
    expect(state.wetness).toBe(0)

    await expect(page.getByTestId('hud-weather')).toHaveText(/Clear/)

    await page.keyboard.press('Tab')
    await expect(page.getByTestId('phone-weather')).toHaveText(/Clear/)
    await expect(page.getByTestId('phone-weather-flavor')).toContainText('Clear skies')
    await page.keyboard.press('Escape')
  })

  test('forcing rain updates state, UI, wetness and traffic modifiers', async ({ page }) => {
    const errors: string[] = []
    page.on('pageerror', (err) => errors.push(String(err)))
    await gotoGame(page)
    await page.evaluate(() => {
      window.GAME_TEST_API!.resetGame()
      window.GAME_TEST_API!.setWeather('rain')
    })
    await page.waitForTimeout(400)

    const state = await page.evaluate(() => window.GAME_TEST_API!.getWeatherState())
    expect(state.kind).toBe('rain')
    expect(state.wetness).toBe(1)
    expect(state.modifiers.rainStrength).toBeGreaterThan(0.9)
    expect(state.modifiers.trafficSpeedFactor).toBeLessThan(0.9)

    await expect(page.getByTestId('hud-weather')).toHaveText(/Rain/)
    expect(errors).toEqual([])
  })

  test('rain sends avoid_rain citizens indoors and clear brings them back', async ({ page }) => {
    await gotoGame(page)
    await page.evaluate(() => {
      window.GAME_TEST_API!.resetGame()
      window.GAME_TEST_API!.setTime(10)
    })
    // Count only the ALWAYS-LOADED core city: far sectors warm up as the
    // routed fleet drives around (their idlers activate mid-test), so a
    // global count is not weather-deterministic.
    const coreVisible = () =>
      page.evaluate(() => {
        const CORE = new Set([
          'central',
          'residential',
          'industrial',
          'residential_west',
          'residential_south',
          'industrial_north',
        ])
        return window.GAME_TEST_API!.getAmbientCitizens().filter(
          (c) => CORE.has(c.district) && c.state !== 'hidden',
        ).length
      })
    await page.waitForTimeout(1500)
    const clearCount = await coreVisible()

    await page.evaluate(() => window.GAME_TEST_API!.setWeather('rain'))
    await page.waitForTimeout(500)
    const rainCount = await coreVisible()
    expect(rainCount).toBeLessThan(clearCount)

    // Workers stay on the clock in any weather.
    const citizens = await page.evaluate(() => window.GAME_TEST_API!.getAmbientCitizens())
    expect(citizens.find((c) => c.id === 'cit_warehouse_worker')!.state).not.toBe('hidden')
    expect(citizens.find((c) => c.id === 'cit_bench_reader')!.state).toBe('hidden')

    await page.evaluate(() => window.GAME_TEST_API!.setWeather('clear'))
    // Shelterers walk back — the CORE count converges to its pre-rain value.
    await expect
      .poll(async () => coreVisible(), { timeout: 10_000 })
      .toBe(clearCount)
  })

  test('wetness drains gradually after the rain stops', async ({ page }) => {
    await gotoGame(page)
    await page.evaluate(() => {
      window.GAME_TEST_API!.resetGame()
      window.GAME_TEST_API!.setWeather('rain')
      window.GAME_TEST_API!.setWeather('clear')
      window.GAME_TEST_API!.setWetness(1)
      window.GAME_TEST_API!.advanceWeather(20)
    })
    const state = await page.evaluate(() => window.GAME_TEST_API!.getWeatherState())
    expect(state.kind).toBe('clear')
    expect(state.wetness).toBeGreaterThan(0.4)
    expect(state.wetness).toBeLessThan(1)
  })

  test('weather survives save/load and old saves default to clear', async ({ page }) => {
    await gotoGame(page)
    await page.evaluate(async () => {
      window.GAME_TEST_API!.resetGame()
      window.GAME_TEST_API!.setWeather('foggy')
      await window.GAME_TEST_API!.saveGame()
      window.GAME_TEST_API!.setWeather('clear')
    })
    await page.evaluate(() => window.GAME_TEST_API!.loadGame())
    await page.waitForTimeout(400)
    const state = await page.evaluate(() => window.GAME_TEST_API!.getWeatherState())
    expect(state.kind).toBe('foggy')
    await expect(page.getByTestId('hud-weather')).toHaveText(/Fog/)
  })

  test('smooth transitions crossfade instead of snapping', async ({ page }) => {
    await gotoGame(page)
    await page.evaluate(() => {
      window.GAME_TEST_API!.resetGame()
      window.GAME_TEST_API!.setWeather('rain', { instant: false })
    })
    await page.waitForTimeout(250)
    const mid = await page.evaluate(() => window.GAME_TEST_API!.getWeatherState())
    expect(mid.targetKind).toBe('rain')
    expect(mid.transition).toBeGreaterThan(0)
    expect(mid.transition).toBeLessThan(1)

    await page.evaluate(() => window.GAME_TEST_API!.advanceWeather(10))
    const done = await page.evaluate(() => window.GAME_TEST_API!.getWeatherState())
    expect(done.kind).toBe('rain')
    expect(done.transition).toBe(1)
  })
})
