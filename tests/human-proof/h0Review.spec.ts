import { mkdirSync } from 'node:fs'
import { test, expect, type Page } from '@playwright/test'

/**
 * Human Visual Gold Standard v1 — H0 Calibration runtime review + evidence capture (issue #27).
 *
 * Loads the NOT-YET-APPROVED calibration human through the DEV review path (`setReviewCharacterGlb`
 * → a synthetic def with the real idle/walk/run mapping; the GLB is served dev-only from
 * /dev-review/, absent from the production dist/ bundle) and:
 *   B4 gate — asserts the skinned mesh renders (not the primitive fallback), the semantic gait
 *   mapping selects the mapped clips, and the frame is non-empty.
 *   Evidence — captures curated review frames into docs/review/h0-calibration/img/ using the real
 *   engine materials, lighting and animation path. Angles come from the def's rotationOffset (the
 *   idle controller resets player heading to 0, so we spin the MODEL) against the well-lit default
 *   camera. No baseline replacement, no post-processing.
 *
 * Run: npx playwright test tests/human-proof/h0Review.spec.ts --workers=1
 */
type Api = Record<string, (...a: unknown[]) => unknown>
const call = (page: Page, m: string, ...a: unknown[]) =>
  page.evaluate(([mm, aa]) => (window.GAME_TEST_API as unknown as Api)[mm as string](...(aa as unknown[])), [m, a] as const)

const REVIEW_URL = 'dev-review/human_gold_calibration_01.glb'
const OUT = 'docs/review/h0-calibration/img'
const FR = 225 // front rotationOffset (deg): model faces the well-lit default camera
const rad = (deg: number) => (deg * Math.PI) / 180

async function bootReview(page: Page): Promise<void> {
  await page.goto('/')
  await page.waitForFunction(() => window.GAME_TEST_API?.ready() === true, undefined, { timeout: 45_000 })
  await page.waitForFunction(() => window.GAME_TEST_API?.assetsSettled() === true, undefined, { timeout: 45_000 })
  await call(page, 'resetGame')
  await call(page, 'setTime', 12)
  await call(page, 'setWeather', 'clear')
  await call(page, 'setReviewCharacterGlb', REVIEW_URL)
  await call(page, 'teleportPlayer', [12, 1.2, 2])
  await page.waitForFunction(
    () => {
      const s = window.GAME_TEST_API!.getCharacterState('player')
      return s?.modelLoaded === true && s.activeVisual === 'model'
    },
    undefined,
    { timeout: 20_000 },
  )
}

test.describe('issue #27 H0 Calibration — runtime review', () => {
  test.beforeAll(() => mkdirSync(OUT, { recursive: true }))

  test('B4 gate: renders through the real path (not fallback), gait mapping, non-empty', async ({ page }) => {
    test.setTimeout(120_000)
    const errors: string[] = []
    page.on('pageerror', (e) => errors.push(String(e)))
    await bootReview(page)

    const st = (await call(page, 'getCharacterState', 'player')) as {
      activeVisual: string; modelLoaded: boolean; fallbackReason: string | null
    }
    expect(st.activeVisual, 'skinned model renders, not the primitive fallback').toBe('model')
    expect(st.modelLoaded, 'GLB loaded through the review path').toBe(true)
    expect(st.fallbackReason, 'no fallback reason').toBeFalsy()

    // Semantic gait mapping: forcing a role selects the mapped clip (idle→Idle / walk→Walk / run→Run).
    for (const role of ['walk', 'run', 'idle'] as const) {
      await call(page, 'forceCharacterAnimation', role)
      await page.waitForTimeout(500)
      const s = (await call(page, 'getCharacterState', 'player')) as { animState: string }
      expect(s.animState, `controller selects '${role}'`).toBe(role)
    }
    await call(page, 'forceCharacterAnimation', null)

    // Non-empty frame: the character's screen region must differ from the same region with the
    // subject teleported far away (i.e. it is not rendering as bare background / an empty viewer).
    await call(page, 'setCameraZoomMul', 3)
    await page.waitForTimeout(400)
    const clip = { x: 520, y: 240, width: 240, height: 320 }
    const withModel = await page.screenshot({ clip })
    await call(page, 'teleportPlayer', [400, 1.2, 400]) // off into un-generated space
    await page.waitForTimeout(500)
    const withoutModel = await page.screenshot({ clip })
    expect(Buffer.compare(withModel, withoutModel), 'character region is non-empty').not.toBe(0)

    expect(errors, 'no pageerror across the review load').toEqual([])
    await call(page, 'setCameraZoomMul', 1)
    await call(page, 'setReviewCharacterGlb', null)
  })

  test('capture curated H0 review evidence', async ({ page }) => {
    test.setTimeout(360_000)
    const pause = (p: boolean) => page.evaluate((v) => window.GAME_TEST_API!.pauseWorld(v as boolean), p)
    const zoom = (m: number) => call(page, 'setCameraZoomMul', m)
    const lookY = (m: number) => call(page, 'setCameraLookY', m)
    const settle = () => page.waitForTimeout(350)
    // JPEG is the committed review-package format: docs/review/h0-calibration/README.md
    // references img/*.jpg, so the capture MUST write the same extension or the package
    // would reference files this spec never produces.
    const shot = (n: string) =>
      page.screenshot({ path: `${OUT}/${n}.jpg`, type: 'jpeg', quality: 90 })
    // Load the review model at rotationOffset `deg`, freeze it idle for a still.
    const stand = async (deg: number) => {
      await pause(false)
      await call(page, 'setReviewCharacterGlb', REVIEW_URL, 0, rad(deg))
      await call(page, 'forceCharacterAnimation', 'idle')
      await page.waitForTimeout(750)
      await pause(true)
      await call(page, 'setProofFreezeTime', 0.0)
    }

    await bootReview(page)

    // 1) FACE — interaction distance, aimed at the face.
    await zoom(9); await lookY(0.78)
    for (const [n, d] of [['face-front', FR], ['face-tq-left', FR + 45], ['face-tq-right', FR - 45], ['face-profile', FR + 90]] as [string, number][]) {
      await stand(d); await settle(); await shot(n)
    }

    // 2) BODY — grounded full-body front / side / rear.
    await zoom(2.6); await lookY(0.15)
    for (const [n, d] of [['body-front', FR], ['body-side', FR + 90], ['body-rear', FR + 180]] as [string, number][]) {
      await stand(d); await settle(); await shot(n)
    }

    // 3) COMPARISON — calibration vs the CURRENT primitive human, identical camera / zoom / lighting.
    await stand(FR); await settle(); await shot('compare-calibration')
    await pause(false)
    await call(page, 'setReviewCharacterGlb', null) // → default blocklife_person (what ships today)
    await call(page, 'forceCharacterAnimation', 'idle')
    await page.waitForTimeout(750)
    await pause(true); await call(page, 'setProofFreezeTime', 0.0); await settle()
    await shot('compare-primitive')

    // 4) CONDITIONS — day / night / rain (front).
    await stand(FR)
    for (const [n, t, w] of [['cond-day', 12, 'clear'], ['cond-night', 22, 'clear'], ['cond-rain', 12, 'rain']] as [string, number, string][]) {
      await call(page, 'setTime', t); await call(page, 'setWeather', w); await settle(); await shot(n)
    }
    await call(page, 'setTime', 12); await call(page, 'setWeather', 'clear')

    // 5) MOTION strips — 3 timestamps each. Idle/Walk/Run are CONTROLLER-SELECTED via gait role;
    //    Turn has no production role → forced-clip (documented distinction, per B3).
    const strip = async (label: string, setup: () => Promise<unknown>, times: number[]) => {
      await pause(false); await setup(); await page.waitForTimeout(650); await pause(true)
      for (let i = 0; i < times.length; i++) { await call(page, 'setProofFreezeTime', times[i]); await settle(); await shot(`motion-${label}-${i}`) }
    }
    await pause(false); await call(page, 'setReviewCharacterGlb', REVIEW_URL, 0, rad(FR)); await page.waitForTimeout(500); await pause(true)
    await strip('idle', () => call(page, 'forceCharacterAnimation', 'idle'), [0.0, 0.9, 1.8])
    await strip('walk', () => call(page, 'forceCharacterAnimation', 'walk'), [0.1, 0.45, 0.8])
    await strip('run', () => call(page, 'forceCharacterAnimation', 'run'), [0.1, 0.33, 0.6])
    await strip('turn', async () => { await call(page, 'setPlayerProofDef', REVIEW_URL, 'Turn', 0, rad(FR)); await call(page, 'forceCharacterAnimation', 'walk') }, [0.1, 0.6, 1.1])

    // 6) SEATED — fitted onto an authored bench (prop_bench_01 @ [-7.6, 10.5]); the model is lowered
    //    so the hips rest on the seat and the feet reach the ground (not floating in empty space).
    await pause(false)
    await call(page, 'teleportPlayer', [-7.6, 1.2, 10.5])
    await call(page, 'setPlayerProofDef', REVIEW_URL, 'Seated', -0.45, rad(FR))
    await call(page, 'forceCharacterAnimation', 'walk')
    await page.waitForTimeout(900)
    await pause(true)
    await zoom(3.0); await lookY(0.35)
    for (let i = 0; i < 3; i++) { await call(page, 'setProofFreezeTime', [0.0, 0.5, 0.9][i]); await settle(); await shot(`seated-${i}`) }

    await zoom(1); await lookY(0); await call(page, 'setProofFreezeTime', null)
    await call(page, 'setPlayerProofDef', null, '')
  })
})
