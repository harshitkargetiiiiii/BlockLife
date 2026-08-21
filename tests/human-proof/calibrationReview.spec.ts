import { existsSync } from 'node:fs'
import { test, expect, type Page } from '@playwright/test'

/**
 * Human Visual Gold Standard v1 — H0 Calibration in-engine motion review (issue #27).
 *
 * Loads the assembled 5-clip calibration GLB (gitignored _proof/cand1_calibration_opt.glb) through
 * the REAL AnimatedCharacter path via the DEV setPlayerProofDef hook (each clip aliased in turn),
 * and captures deterministic freeze-frames for human review: the clip gate (Idle/Walk/Run/Turn/
 * Seated distinct + usable), front/side/rear silhouette, day/night/rain, gameplay + close distance.
 * Skips when the GLB is absent (never committed), so it is not part of the standard gate.
 *
 * Run: npx playwright test tests/human-proof/calibrationReview.spec.ts --workers=1
 */
type Api = Record<string, (...a: unknown[]) => unknown>
const call = (page: Page, m: string, ...a: unknown[]) =>
  page.evaluate(([mm, aa]) => (window.GAME_TEST_API as unknown as Api)[mm as string](...(aa as unknown[])), [m, a] as const)

const dir = 'assets/models/characters/_proof/'
const GLB = 'public/' + dir + 'cand1_calibration_opt.glb'
const path = dir + 'cand1_calibration_opt.glb'
const FRONT = (Math.PI * 5) / 4 // faces the (+X,+Z) diorama camera (heading π/4 shows the rear)
const shot = (page: Page, name: string) => page.screenshot({ path: `asset-archive/human-cal/motion-${name}.png` })

async function poseClip(page: Page, clip: string, t: number, heading = FRONT): Promise<void> {
  await page.evaluate(() => window.GAME_TEST_API!.pauseWorld(false))
  await call(page, 'setProofFreezeTime', null)
  await call(page, 'setPlayerProofDef', path, clip) // aliases idle/walk/run → this clip
  await call(page, 'forceCharacterAnimation', 'walk')
  await page.waitForFunction(
    () => {
      const s = window.GAME_TEST_API!.getCharacterState('player')
      return s?.modelLoaded === true && s.activeVisual === 'model'
    },
    undefined,
    { timeout: 20_000 },
  )
  await page.waitForTimeout(500)
  // Set heading LATE (idle drifts it over the play window) and let the controller apply it before
  // pausing — heading rotation is applied in the controller's frame loop, which stops once paused.
  await call(page, 'setPlayerHeading', heading)
  await page.waitForTimeout(250)
  await page.evaluate(() => window.GAME_TEST_API!.pauseWorld(true))
  await call(page, 'setProofFreezeTime', t)
  await page.waitForTimeout(300)
}

test.describe('issue #27 H0 Calibration — 5-clip motion review', () => {
  test.skip(!existsSync(GLB), 'assemble cand1_calibration_opt.glb first (gitignored)')
  test('capture calibration clip-gate + angles + conditions freeze frames', async ({ page }) => {
    test.setTimeout(240_000)
    const errors: string[] = []
    page.on('pageerror', (e) => errors.push(String(e)))
    await page.goto('/')
    await page.waitForFunction(() => window.GAME_TEST_API?.ready() === true, undefined, { timeout: 45_000 })
    await page.waitForFunction(() => window.GAME_TEST_API?.assetsSettled() === true, undefined, { timeout: 45_000 })
    await call(page, 'resetGame')
    await call(page, 'setTime', 12)
    await call(page, 'setWeather', 'clear')
    await call(page, 'teleportPlayer', [12, 1.2, 2])
    await call(page, 'setPlayerHeading', FRONT)
    await call(page, 'setCameraZoomMul', 2.4)

    // Pass 1 — clip gate: each clip at two phases (front), proving distinct + usable motion.
    const CLIPS: [string, number[]][] = [
      ['Idle', [0.0, 1.2]],
      ['Walk', [0.27, 0.8]],
      ['Run', [0.17, 0.5]],
      ['Turn', [0.3, 0.9]],
      ['Seated', [0.9, 0.9]],
    ]
    for (const [clip, ts] of CLIPS) {
      for (let i = 0; i < ts.length; i++) {
        await poseClip(page, clip, ts[i])
        await shot(page, `clip-${clip}-${i}`)
      }
    }

    // Pass 2 — angles: Walk at front / right / rear / left.
    for (const [label, h] of [['front', FRONT], ['right', FRONT + Math.PI / 2], ['rear', FRONT + Math.PI], ['left', FRONT - Math.PI / 2]] as [string, number][]) {
      await poseClip(page, 'Walk', 0.27, h)
      await shot(page, `angle-${label}`)
    }

    // Pass 3 — conditions: Walk front at day / night / rain.
    await call(page, 'setTime', 12); await call(page, 'setWeather', 'clear')
    await poseClip(page, 'Walk', 0.27); await shot(page, 'cond-day')
    await call(page, 'setTime', 22)
    await poseClip(page, 'Walk', 0.27); await shot(page, 'cond-night')
    await call(page, 'setTime', 12); await call(page, 'setWeather', 'rain')
    await poseClip(page, 'Walk', 0.27); await shot(page, 'cond-rain')
    await call(page, 'setWeather', 'clear')

    // Pass 4 — distance: Idle at gameplay zoom vs close face zoom.
    await call(page, 'setCameraZoomMul', 1)
    await poseClip(page, 'Idle', 0.0); await shot(page, 'dist-gameplay')
    await call(page, 'setCameraZoomMul', 7)
    await poseClip(page, 'Idle', 0.0); await shot(page, 'dist-face')

    await call(page, 'setCameraZoomMul', 1)
    await call(page, 'setPlayerProofDef', null, '')
    // No renderer error across all valid clip loads.
    expect(errors, 'no pageerror across calibration clip review').toEqual([])
    console.log('[calibrationReview] done; pageerrors:', JSON.stringify(errors))
  })
})
