import { existsSync } from 'node:fs'
import { test, type Page } from '@playwright/test'

/**
 * Human Visual Gold Standard v1 — H0 Calibration candidate review (issue #27).
 *
 * Renders an UN-RIGGED candidate GLB (image_to_3d / remesh output, gitignored under _proof/)
 * statically in the player slot via the DEV `setPlayerStaticGlb` hook and captures all-sides
 * freeze frames (full-body + a zoomed face pass) for deterministic human review — face,
 * anatomy, symmetry, silhouette, hands/feet, grounding. Skips when the candidate GLB is absent
 * (never committed), so it is not part of the standard gate.
 *
 * Run: CAND=cand1_preview npx playwright test tests/human-proof/candidateReview.spec.ts --workers=1
 */
type Api = Record<string, (...a: unknown[]) => unknown>
const call = (page: Page, m: string, ...a: unknown[]) =>
  page.evaluate(([mm, aa]) => (window.GAME_TEST_API as unknown as Api)[mm as string](...(aa as unknown[])), [m, a] as const)

const dir = 'dev-review/_proof/'
const which = process.env.CAND ?? 'cand1_preview'
const GLB = 'dev-review-assets/_proof/' + which + '.glb'
const YAWS = [0, 45, 90, 135, 180, 225, 270, 315]

test.describe('issue #27 H0 Calibration — candidate all-sides review', () => {
  test.skip(!existsSync(GLB), `build ${GLB} first (candidate GLBs are gitignored)`)
  test(`capture ${which} all-sides freeze frames`, async ({ page }) => {
    test.setTimeout(180_000)
    const errors: string[] = []
    page.on('pageerror', (e) => errors.push(String(e)))
    await page.goto('/')
    await page.waitForFunction(() => window.GAME_TEST_API?.ready() === true, undefined, { timeout: 45_000 })
    await page.waitForFunction(() => window.GAME_TEST_API?.assetsSettled() === true, undefined, { timeout: 45_000 })
    await call(page, 'resetGame')
    await call(page, 'setTime', 12)
    await call(page, 'setWeather', 'clear')
    await call(page, 'teleportPlayer', [12, 1.2, 2])
    await page.evaluate(() => window.GAME_TEST_API!.pauseWorld(true))
    const path = dir + which + '.glb'

    // Pass 1 — full body (camera zoom ~2.2×) for silhouette / anatomy / proportions / hands / feet.
    await call(page, 'setCameraZoomMul', 2.2)
    for (const yaw of YAWS) {
      await call(page, 'setPlayerStaticGlb', path, yaw, 1, 0)
      await page.waitForTimeout(450)
      await page.screenshot({ path: `asset-archive/human-cal/${which}-body-yaw${yaw}.png` })
    }

    // Pass 2 — face close-up: camera zoom ~6×, drop the model ~0.6m so the head sits on the target.
    await call(page, 'setCameraZoomMul', 6)
    for (const yaw of YAWS) {
      await call(page, 'setPlayerStaticGlb', path, yaw, 1, -0.6)
      await page.waitForTimeout(450)
      await page.screenshot({ path: `asset-archive/human-cal/${which}-face-yaw${yaw}.png` })
    }

    await call(page, 'setPlayerStaticGlb', null)
    await call(page, 'setCameraZoomMul', 1)
    console.log(`[candidateReview] ${which} pageerrors:`, JSON.stringify(errors))
  })
})
