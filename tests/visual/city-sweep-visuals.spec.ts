import { expect, test, type Page } from '@playwright/test'
import { waitForSceneSettled } from './visualHelpers'
import { generateVisualSweepFrames } from '../../src/game/world/integrity/citySweep'

/**
 * Generated visual sweep (World Integrity issue §13). One deterministic OVERVIEW
 * frame per authored, map-visible district — the frames come from the compiled
 * district list (`generateVisualSweepFrames`), so a NEW district is photographed
 * automatically. Each frame certifies its district's floor + buildings + props
 * render with valid placement. Representative probes, not hundreds of shots.
 *
 * The world is streamed in around the teleport, then paused (weather snap + actor
 * pause-snap to canonical poses) so frames are deterministic.
 */
const FRAMES = generateVisualSweepFrames()

async function setupDistrictFrame(page: Page, x: number, z: number): Promise<void> {
  await page.goto('/')
  await page.waitForFunction(() => window.GAME_TEST_API?.ready() === true, undefined, { timeout: 45_000 })
  await waitForSceneSettled(page)
  await page.evaluate(
    ([px, pz]) => {
      const api = window.GAME_TEST_API!
      api.resetGame()
      api.setTime(14)
      api.setWeather('clear')
      api.teleportPlayer([px as number, 1.2, pz as number])
    },
    [x, z] as const,
  )
  await page.waitForTimeout(3200) // stream the district in + let citizens/traffic settle
  // The teleport streams a WHOLE district in, which is the largest remount the suite performs;
  // photographing it before its GLB bodies commit is exactly the stale-transient baseline class
  // (issue #46 §4). The sweep is generated, so a new district inherits this automatically.
  await waitForSceneSettled(page)
  await page.evaluate(() => window.GAME_TEST_API!.pauseWorld(true))
  await page.waitForTimeout(1600) // pause-snap to canonical deterministic poses
}

test.describe('city sweep — generated district overviews', () => {
  for (const f of FRAMES) {
    test(`${f.displayName} overview [${f.sectorId}]`, async ({ page }) => {
      await setupDistrictFrame(page, f.x, f.z)
      await expect(page).toHaveScreenshot(`${f.id}.png`, { maxDiffPixelRatio: 0.02 })
    })
  }
})
