import { expect, test } from '@playwright/test'
import { gotoGame } from './helpers'

/**
 * Character Identity & Population Visual Upgrade v1 (issue #23), through the
 * public test API + DOM against a real boot:
 *  - the whole named cast + a bounded rigged ambient crowd run on the ONE rig,
 *  - the rig exposes the new accessory identity axis,
 *
 * Issue #47 Wave 4 narrowed ONE claim here, deliberately (CONVENTIONS #39). Five named residents
 * now render an owner-approved 1:1 body instead of the wardrobe rig, and those bodies are a single
 * BAKED atlas — windows of identity like shirt/hair/accessory are painted into one texture, so they
 * expose no recolorable slot at all. The accessory axis is unchanged on the rig itself (the player
 * and the ambient crowd still resolve all six slots, asserted below), and each moved NPC is held to
 * a STRICTER statement than the old `toContain('accessory')`: it must render its OWN 1:1 body and
 * expose EXACTLY no wardrobe slot. Their registry identity is not lost — it still drives the
 * fallback rig, which `tests/e2e/asset-integration-wave-4.spec.ts` proves by failing the body.
 *  - the skinned-character population stays inside its hard cap (no hidden perf
 *    regression from routing the crowd through the pipeline),
 *  - the dialogue panel shows the speaker's registry identity + relationship.
 */

async function bootSettled(page: import('@playwright/test').Page) {
  await gotoGame(page)
  await page.evaluate(() => {
    window.GAME_TEST_API!.resetGame()
    window.GAME_TEST_API!.setTime(10) // daytime: the crowd is out
  })
  await page.waitForFunction(() => window.GAME_TEST_API?.assetsSettled() === true, undefined, {
    timeout: 45_000,
  })
  await page.waitForFunction(
    () => window.GAME_TEST_API!.getCharacterState('player')?.modelLoaded === true,
    undefined,
    { timeout: 15_000 },
  )
}

test.describe('character identity & population (issue #23)', () => {
  test('the named cast + a bounded rigged ambient crowd all run on the rig', async ({ page }) => {
    const errors: string[] = []
    page.on('pageerror', (err) => errors.push(String(err)))
    await bootSettled(page)

    const stats = await page.evaluate(() => window.GAME_TEST_API!.getCharacterPopulationStats())
    // Player (hero) + the six named residents are always rigged.
    expect(stats.byTier.hero).toBe(1)
    expect(stats.byTier.namedNpc).toBe(6)
    // The ambient crowd is now represented in the pipeline, but STRICTLY bounded —
    // the hard cap is the "no hidden perf regression from routing the crowd through
    // the rig" guarantee.
    expect(stats.byTier.ambient).toBeGreaterThan(0)
    expect(stats.byTier.ambient).toBeLessThanOrEqual(stats.maxRiggedAmbient)
    expect(errors).toEqual([])
  })

  test('every named NPC renders the model with a distinct registry identity', async ({ page }) => {
    await bootSettled(page)
    // NPC -> the owner-approved 1:1 body it renders since issue #47 Wave 4. Leo is absent on
    // purpose: his approved source is a construction worker against a delivery role, so he was
    // rejected and keeps the wardrobe rig — which is why he still carries the full axis below.
    const WAVE4_BODIES: Record<string, string> = {
      npc_ravi_01: 'blocklife_ravi_01',
      npc_maya_01: 'blocklife_maya_01',
      npc_kim_01: 'blocklife_kim_01',
      npc_bruno_01: 'blocklife_bruno_01',
      npc_nisha_01: 'blocklife_nisha_01',
    }
    const ids = ['npc_ravi_01', 'npc_maya_01', 'npc_kim_01', 'npc_bruno_01', 'npc_leo_01', 'npc_nisha_01']
    for (const id of ids) {
      await page.waitForFunction(
        (nid) => window.GAME_TEST_API!.getCharacterState(nid)?.modelLoaded === true,
        id,
        { timeout: 15_000 },
      )
      const state = await page.evaluate((nid) => window.GAME_TEST_API!.getCharacterState(nid)!, id)
      expect(state.activeVisual, `${id} on the model`).toBe('model')
      const body = WAVE4_BODIES[id]
      if (body) {
        // Stricter than the original claim: the exact body, and EXACTLY no wardrobe slot.
        expect(state.assetId, `${id} renders its own 1:1 approved body`).toBe(body)
        expect(state.resolvedSlots, `${id} baked body exposes no wardrobe slot`).toEqual([])
      } else {
        // Still on the wardrobe rig: the accessory axis claim is unchanged and unweakened.
        expect(state.assetId, `${id} stays on the wardrobe rig`).toBe('blocklife_person')
        expect(state.resolvedSlots, `${id} accessory slot`).toContain('accessory')
      }
    }
    // The axis itself is intact on the rig, for every NPC that still uses it.
    const leo = await page.evaluate(() => window.GAME_TEST_API!.getCharacterState('npc_leo_01')!)
    expect(leo.resolvedSlots).toEqual(
      expect.arrayContaining(['shirt', 'pants', 'hair', 'skin', 'shoes', 'accessory']),
    )
  })

  test('an ambient core citizen is promoted to the rigged model', async ({ page }) => {
    await bootSettled(page)
    // cit_office_worker is a central, always-out idle citizen in the rigged subset.
    await page.waitForFunction(
      () => window.GAME_TEST_API!.getCharacterState('cit_office_worker')?.modelLoaded === true,
      undefined,
      { timeout: 15_000 },
    )
    const c = await page.evaluate(() => window.GAME_TEST_API!.getCharacterState('cit_office_worker')!)
    expect(c.activeVisual).toBe('model')
    expect(c.resolvedSlots).toEqual(expect.arrayContaining(['shirt', 'skin', 'accessory']))
  })

  test('the player rig also resolves the full identity axis set', async ({ page }) => {
    await bootSettled(page)
    const player = await page.evaluate(() => window.GAME_TEST_API!.getCharacterState('player')!)
    expect(player.activeVisual).toBe('model')
    expect(player.resolvedSlots).toEqual(
      expect.arrayContaining(['shirt', 'pants', 'hair', 'skin', 'shoes', 'accessory']),
    )
  })

  test('dialogue shows the speaker identity avatar, and a tier badge once known', async ({ page }) => {
    await bootSettled(page)
    // Open a conversation with Ravi (a first-meeting contact) through the real UI path.
    await page.evaluate(() => window.GAME_TEST_API!.openDialogueWith('npc_ravi_01'))
    await expect(page.getByTestId('dialogue-panel')).toBeVisible()
    // The identity avatar (hair / skin / shirt swatches) is present.
    await expect(page.getByTestId('dialogue-avatar')).toBeVisible()
    // Meeting unlocked Ravi as a contact → his relationship tier shows by his name.
    await expect(page.getByTestId('dialogue-tier-badge')).toBeVisible()
  })
})
