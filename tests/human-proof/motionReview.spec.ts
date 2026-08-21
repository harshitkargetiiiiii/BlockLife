import { existsSync } from 'node:fs'
import { test, expect, type Page } from '@playwright/test'

/**
 * Human Visual Gold Standard v1 — H0 technical proof, step 3: in-engine motion review (issue #27).
 *
 * Loads each DIAGNOSTIC body (built by scripts/human-proof/retargetBake.mjs → gitignored _proof/)
 * through the REAL AnimatedCharacter / CharacterAnimationController path (the DEV setPlayerProofDef
 * hook — NOT the production manifest) and captures deterministic freeze-frames for human review:
 *  - <body>_proof.glb   : the male walk RETARGETED (three retargetClip) + authored diagnostics.
 *  - <body>_control.glb : the body's OWN embedded meshy walk, NO retarget (the A/B control).
 * Skips cleanly when the diagnostic GLBs are absent (they are never committed), so it is not part
 * of the standard gate. Longer per-test budget: this is a manual diagnostic that swaps the whole
 * character def + reloads a GLB many times (each swap re-clones the skinned scene).
 *
 * Run: node scripts/human-proof/retargetBake.mjs && npx playwright test tests/human-proof --workers=1
 */
type Api = Record<string, (...a: unknown[]) => unknown>
const call = (page: Page, m: string, ...a: unknown[]) =>
  page.evaluate(([mm, aa]) => (window.GAME_TEST_API as unknown as Api)[mm as string](...(aa as unknown[])), [m, a] as const)

const dir = 'assets/models/characters/_proof/'
const PROOF = 'public/' + dir + 'male_proof.glb'
// [body label, glb, [clip, freeze-time(s)]...]
const REVIEW: [string, string, [string, number][]][] = [
  ['male_proof', dir + 'male_proof.glb', [['Walk', 0.62], ['Run', 0.2], ['ElbowKnee', 1.0], ['Seated', 0.0]]],
  ['female_proof', dir + 'female_proof.glb', [['Walk', 0.3], ['ElbowKnee', 1.0], ['Seated', 0.0]]],
  ['male_control', dir + 'male_control.glb', [['Walk', 0.62]]],
  ['female_control', dir + 'female_control.glb', [['Walk', 0.3], ['Walk', 0.62]]],
]

async function boot(page: Page): Promise<void> {
  await page.goto('/')
  await page.waitForFunction(() => window.GAME_TEST_API?.ready() === true, undefined, { timeout: 45_000 })
  await page.waitForFunction(() => window.GAME_TEST_API?.assetsSettled() === true, undefined, { timeout: 45_000 })
}

test.describe('issue #27 H0 — proof-body motion review', () => {
  test.skip(!existsSync(PROOF), 'run scripts/human-proof/retargetBake.mjs first (diagnostic GLBs are gitignored)')
  test('proof bodies load through the real path; capture proof/control A/B freeze frames', async ({ page }) => {
    test.setTimeout(240_000) // manual diagnostic: many full character-def swaps + GLB reloads
    const errors: string[] = []
    page.on('pageerror', (e) => errors.push(String(e)))
    await boot(page)
    await call(page, 'resetGame')
    await call(page, 'setTime', 12)
    await call(page, 'setWeather', 'clear')
    await call(page, 'teleportPlayer', [12, 1.2, 2])

    for (const [label, path, shots] of REVIEW) {
      for (const [clip, t] of shots) {
        await page.evaluate(() => window.GAME_TEST_API!.pauseWorld(false))
        await call(page, 'setProofFreezeTime', null)
        await call(page, 'setPlayerProofDef', path, clip)
        await call(page, 'forceCharacterAnimation', 'walk') // all roles alias `clip`
        await page.waitForFunction(
          () => {
            const s = window.GAME_TEST_API!.getCharacterState('player')
            return s?.modelLoaded === true && s.activeVisual === 'model'
          },
          undefined,
          { timeout: 20_000 },
        )
        await page.waitForTimeout(1300)
        await page.evaluate(() => window.GAME_TEST_API!.pauseWorld(true))
        await call(page, 'setProofFreezeTime', t)
        await page.waitForTimeout(400)
        await page.screenshot({ path: `asset-archive/human-proof/${label}-${clip}-${t}.png` })
      }
    }
    // No renderer error across the VALID proof/control loads.
    expect(errors, 'no pageerror across valid proof loads').toEqual([])

    // Fallback safety: a missing proof GLB must resolve to the primitive, never crash the app.
    // (The 404 load itself logs an expected loader error — the point is the app stays alive and
    // the character falls back cleanly, which the ModelErrorBoundary guarantees.)
    await page.evaluate(() => window.GAME_TEST_API!.pauseWorld(false))
    await call(page, 'setProofFreezeTime', null)
    await call(page, 'setPlayerProofDef', dir + 'does_not_exist.glb', 'Walk')
    await page.waitForTimeout(1500)
    const st = (await call(page, 'getCharacterState', 'player')) as { activeVisual: string }
    expect(st.activeVisual, 'missing GLB → primitive fallback').toBe('primitive')
    // App still responsive after the failed load.
    expect(await call(page, 'ready')).toBe(true)
    await call(page, 'setPlayerProofDef', null, '')
  })
})
