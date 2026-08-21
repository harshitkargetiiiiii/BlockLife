import { existsSync } from 'node:fs'
import { test, type Page } from '@playwright/test'

/**
 * Human Visual Gold Standard v1 — H0 Calibration facing + real-movement review (issue #27).
 *
 * Loads the calibration human through the REAL production path (setDebugPlayerCharacter →
 * CHARACTER_ASSETS['human_gold_calibration_01'], the DEV override — not assigned to anyone) and
 * WALKS it with keyboard input in four directions. Confirms it walks forward (front leads, no
 * moonwalk → rotationOffset correct) and yields clean gameplay-accurate front/side/rear facings.
 * Skips when the GLB is absent.
 *
 * Run: npx playwright test tests/human-proof/facingReview.spec.ts --workers=1
 */
type Api = Record<string, (...a: unknown[]) => unknown>
const call = (page: Page, m: string, ...a: unknown[]) =>
  page.evaluate(([mm, aa]) => (window.GAME_TEST_API as unknown as Api)[mm as string](...(aa as unknown[])), [m, a] as const)
const GLB = 'public/assets/models/characters/human_gold_calibration_01.glb'

test.describe('issue #27 H0 Calibration — facing + real movement', () => {
  test.skip(!existsSync(GLB), 'commit human_gold_calibration_01.glb first')
  test('walk the calibration human in 4 directions (forward-facing check)', async ({ page }) => {
    test.setTimeout(180_000)
    const errors: string[] = []
    page.on('pageerror', (e) => errors.push(String(e)))
    await page.goto('/')
    await page.waitForFunction(() => window.GAME_TEST_API?.ready() === true, undefined, { timeout: 45_000 })
    await page.waitForFunction(() => window.GAME_TEST_API?.assetsSettled() === true, undefined, { timeout: 45_000 })
    await call(page, 'resetGame')
    await call(page, 'setTime', 12)
    await call(page, 'setWeather', 'clear')
    await call(page, 'setPlayerCharacterAsset', 'human_gold_calibration_01')
    await call(page, 'teleportPlayer', [12, 1.2, 2])
    await call(page, 'setCameraZoomMul', 2.6)
    await page.waitForFunction(
      () => {
        const s = window.GAME_TEST_API!.getCharacterState('player')
        return s?.modelLoaded === true && s.activeVisual === 'model'
      },
      undefined,
      { timeout: 20_000 },
    )
    await page.locator('canvas').first().click({ position: { x: 400, y: 400 } }) // focus for key input

    for (const key of ['d', 'w', 'a', 's']) {
      await call(page, 'teleportPlayer', [12, 1.2, 2])
      await page.keyboard.down(key)
      await page.waitForTimeout(850)
      await page.screenshot({ path: `asset-archive/human-cal/facing-${key}.png` })
      await page.keyboard.up(key)
      await page.waitForTimeout(400)
    }

    // Close face while walking toward the camera (whichever key that was — reviewed from the set).
    await call(page, 'setCameraZoomMul', 6)
    await call(page, 'teleportPlayer', [12, 1.2, 2])
    await page.keyboard.down('d')
    await page.waitForTimeout(700)
    await page.screenshot({ path: `asset-archive/human-cal/facing-face-d.png` })
    await page.keyboard.up('d')

    await call(page, 'setCameraZoomMul', 1)
    await call(page, 'setPlayerCharacterAsset', null)
    console.log('[facingReview] done; pageerrors:', JSON.stringify(errors))
  })
})
