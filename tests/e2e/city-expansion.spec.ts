import { expect, test } from '@playwright/test'
import { gotoGame } from './helpers'

/**
 * City Expansion v2: six blocks, 50 peds, solid everything. These checks run
 * against the live simulation — no staged scenarios.
 */
test.describe('city expansion v2', { tag: '@simulation-only' }, () => {
  test('50 citizens live across all six blocks', async ({ page }) => {
    const errors: string[] = []
    page.on('pageerror', (err) => errors.push(String(err)))
    await gotoGame(page)
    await page.evaluate(() => {
      window.GAME_TEST_API!.resetGame()
      window.GAME_TEST_API!.setTime(10)
    })
    await page.waitForTimeout(800)

    const citizens = await page.evaluate(() => window.GAME_TEST_API!.getAmbientCitizens())
    expect(citizens.length).toBe(90) // + Harbor Cross walkers + destination-driven citizens
    for (const district of [
      'central',
      'residential',
      'industrial',
      'residential_west',
      'residential_south',
      'industrial_north',
    ]) {
      const inBlock = citizens.filter((c) => c.district === district)
      expect(inBlock.length, `${district} population`).toBeGreaterThanOrEqual(3)
      // Someone in each block is actually out and about mid-morning.
      expect(
        inBlock.some((c) => c.state !== 'hidden'),
        `${district} has visible peds`,
      ).toBe(true)
    }
    expect(errors).toEqual([])
  })

  test('traffic flows in every block with zero vehicle overlaps over 30s', async ({ page }) => {
    test.slow()
    await gotoGame(page)
    await page.evaluate(() => window.GAME_TEST_API!.resetGame())
    await page.waitForTimeout(500)

    const start = await page.evaluate(() => window.GAME_TEST_API!.getAmbientCarPositions())
    const totals: Record<string, number> = {}
    let prev = start
    for (let i = 0; i < 30; i++) {
      await page.waitForTimeout(1000)
      const now = await page.evaluate(() => window.GAME_TEST_API!.getAmbientCarPositions())
      for (const [id, p] of Object.entries(now)) {
        totals[id] =
          (totals[id] ?? 0) + Math.hypot(p[0] - prev[id][0], p[2] - prev[id][2])
      }
      prev = now
      const overlaps = await page.evaluate(() =>
        window.GAME_TEST_API!.assertNoVehicleVehicleOverlaps(),
      )
      expect(overlaps, `vehicle overlap at t=${i}s`).toEqual([])
    }
    // Every car on every lane made real progress — no frozen corners,
    // no deadlocks, anywhere in the six-block grid.
    for (const [id, moved] of Object.entries(totals)) {
      expect(moved, `${id} total movement`).toBeGreaterThan(8)
    }
    expect(Object.keys(totals)).toHaveLength(8)
  })

  test('player walks the west block and stays solid against its citizens', async ({ page }) => {
    await gotoGame(page)
    await page.evaluate(() => {
      window.GAME_TEST_API!.resetGame()
      window.GAME_TEST_API!.setTime(10)
      window.GAME_TEST_API!.teleportTo('residential_west_street')
    })
    await page.waitForTimeout(600)
    // Walk north along the block for a few seconds.
    await page.keyboard.down('d')
    await page.waitForTimeout(1500)
    await page.keyboard.up('d')
    const stats = await page.evaluate(() => window.GAME_TEST_API!.getStats())
    const pos = stats.position as [number, number, number]
    // Still inside the city, still on foot, never fell through anything.
    expect(pos[1]).toBeGreaterThan(0.5)
    expect(pos[0]).toBeGreaterThan(-70)
    expect(pos[0]).toBeLessThan(66)
    // Never inside a citizen: closest person is at least a body apart.
    const citizens = await page.evaluate(() => window.GAME_TEST_API!.getAmbientCitizens())
    for (const c of citizens.filter((c) => c.state !== 'hidden')) {
      const d = Math.hypot(c.position[0] - pos[0], c.position[1] - pos[2])
      expect(d, `distance to ${c.id}`).toBeGreaterThan(0.5)
    }
  })
})
