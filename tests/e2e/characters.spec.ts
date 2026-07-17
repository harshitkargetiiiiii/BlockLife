import { expect, test } from '@playwright/test'
import { gotoGame, getStats } from './helpers'

/**
 * Character Model + Animation Pipeline v1.
 *
 * The rigged player model, semantic locomotion states, playback-rate
 * clamps, wardrobe-on-model, the named-NPC conversion (Officer Kim), the
 * driving policy and the primitive fallback switch — all through the public
 * test API against real gameplay input.
 */

test.describe('character pipeline', () => {
  test('player boots into the rigged model with all wardrobe slots resolved', async ({ page }) => {
    const errors: string[] = []
    page.on('pageerror', (err) => errors.push(String(err)))
    await gotoGame(page)
    await page.waitForFunction(
      () => window.GAME_TEST_API!.getCharacterState('player')?.modelLoaded === true,
      undefined,
      { timeout: 15_000 },
    )
    const state = await page.evaluate(() => window.GAME_TEST_API!.getCharacterState('player')!)
    expect(state.activeVisual).toBe('model')
    expect(state.animState).toBe('idle')
    expect(state.fallbackReason).toBeNull()
    expect(state.resolvedSlots).toEqual(expect.arrayContaining(['shirt', 'pants', 'hair']))
    const asset = await page.evaluate(() => window.GAME_TEST_API!.getCharacterAssetInfo())
    expect(asset.id).toBe('blocklife_person')
    expect(asset.clips).toEqual(expect.arrayContaining(['idle', 'walk', 'run']))
    expect(errors).toEqual([])
  })

  test('real movement drives idle→walk→run→idle with clamped playback rates', async ({ page }) => {
    await gotoGame(page)
    await page.evaluate(() => {
      window.GAME_TEST_API!.resetGame()
      window.GAME_TEST_API!.setTime(10)
      window.GAME_TEST_API!.teleportTo('long_road_test')
    })
    await page.waitForTimeout(1200) // camera + speed smoothing settle

    await page.keyboard.down('w')
    await page.waitForFunction(
      () => window.GAME_TEST_API!.getCharacterState('player')?.animState === 'walk',
      undefined,
      { timeout: 5_000 },
    )
    const walk = await page.evaluate(() => window.GAME_TEST_API!.getCharacterState('player')!)
    expect(walk.playbackRate).toBeGreaterThanOrEqual(0.75)
    expect(walk.playbackRate).toBeLessThanOrEqual(1.25)

    await page.keyboard.down('Shift')
    await page.waitForFunction(
      () => window.GAME_TEST_API!.getCharacterState('player')?.animState === 'run',
      undefined,
      { timeout: 5_000 },
    )
    const run = await page.evaluate(() => window.GAME_TEST_API!.getCharacterState('player')!)
    expect(run.playbackRate).toBeGreaterThanOrEqual(0.85)
    expect(run.playbackRate).toBeLessThanOrEqual(1.2)
    expect(run.previousAnimState).toBe('walk')

    await page.keyboard.up('Shift')
    await page.keyboard.up('w')
    await page.waitForFunction(
      () => window.GAME_TEST_API!.getCharacterState('player')?.animState === 'idle',
      undefined,
      { timeout: 5_000 },
    )
  })

  test('a teleport never bursts the character into a run', async ({ page }) => {
    await gotoGame(page)
    await page.evaluate(() => {
      window.GAME_TEST_API!.resetGame()
      window.GAME_TEST_API!.teleportTo('industrial_strip')
    })
    // Sample the anim state for the following second — it must stay idle.
    const states = await page.evaluate(async () => {
      const out: string[] = []
      for (let i = 0; i < 10; i++) {
        out.push(window.GAME_TEST_API!.getCharacterState('player')!.animState)
        await new Promise((r) => setTimeout(r, 100))
      }
      return out
    })
    expect(states.every((s) => s === 'idle')).toBe(true)
  })

  test('wardrobe recolors the model instance and keeps it on the model', async ({ page }) => {
    await gotoGame(page)
    await page.evaluate(() => {
      window.GAME_TEST_API!.resetGame()
      window.GAME_TEST_API!.setAppearance({ shirtColor: '#e01818', pantsColor: '#f5d90a' })
    })
    await page.waitForTimeout(300)
    const after = await page.evaluate(() => ({
      appearance: window.GAME_TEST_API!.getAppearance(),
      state: window.GAME_TEST_API!.getCharacterState('player')!,
    }))
    expect(after.appearance.shirtColor).toBe('#e01818')
    expect(after.state.activeVisual).toBe('model')
    expect(after.state.fallbackReason).toBeNull()
  })

  test('Officer Kim runs on the same rigged asset and animates while patrolling', async ({ page }) => {
    await gotoGame(page)
    await page.evaluate(() => {
      window.GAME_TEST_API!.resetGame()
      window.GAME_TEST_API!.setTime(10) // patrol hours
    })
    await page.waitForFunction(
      () => window.GAME_TEST_API!.getCharacterState('npc_kim_01')?.modelLoaded === true,
      undefined,
      { timeout: 15_000 },
    )
    // Kim patrols on a loop — she must hit a walking animation within a few
    // seconds of simulated daytime.
    await page.waitForFunction(
      () => window.GAME_TEST_API!.getCharacterState('npc_kim_01')?.animState === 'walk',
      undefined,
      { timeout: 20_000 },
    )
    const kim = await page.evaluate(() => window.GAME_TEST_API!.getCharacterState('npc_kim_01')!)
    expect(kim.activeVisual).toBe('model')
    expect(kim.playbackRate).toBeGreaterThanOrEqual(0.75)
    expect(kim.playbackRate).toBeLessThanOrEqual(1.25)
  })

  test('driving parks the character in the driving state and restores after exit', async ({ page }) => {
    await gotoGame(page)
    await page.evaluate(() => window.GAME_TEST_API!.resetGame())
    // Park next to the compact car and enter it.
    await page.evaluate(() => {
      const cars = window.GAME_TEST_API!.getVehiclePositions()
      const pos = Object.values(cars)[0]
      window.GAME_TEST_API!.teleportPlayer([pos[0] + 1.2, 0.8, pos[1] + 1.2])
    })
    await page.waitForTimeout(600)
    await page.evaluate(() => window.GAME_TEST_API!.interact())
    await page.waitForFunction(
      () => window.GAME_TEST_API!.getCharacterState('player')?.animState === 'driving',
      undefined,
      { timeout: 5_000 },
    )
    const stats = await getStats(page)
    expect(stats.mode).toBe('driving')

    await page.evaluate(() => window.GAME_TEST_API!.interact())
    await page.waitForFunction(
      () => window.GAME_TEST_API!.getCharacterState('player')?.animState !== 'driving',
      undefined,
      { timeout: 5_000 },
    )
    const after = await page.evaluate(() => window.GAME_TEST_API!.getCharacterState('player')!)
    expect(after.activeVisual).toBe('model')
  })

  test('render-mode switch: primitive fallback on demand, model on restore', async ({ page }) => {
    await gotoGame(page)
    await page.evaluate(() => window.GAME_TEST_API!.setCharacterRenderMode('primitive'))
    await page.waitForFunction(
      () => window.GAME_TEST_API!.getCharacterState('player')?.activeVisual === 'primitive',
      undefined,
      { timeout: 5_000 },
    )
    // Kim falls back too — the switch is global.
    const kim = await page.evaluate(() => window.GAME_TEST_API!.getCharacterState('npc_kim_01')!)
    expect(kim.activeVisual).toBe('primitive')

    await page.evaluate(() => window.GAME_TEST_API!.setCharacterRenderMode('auto'))
    await page.waitForFunction(
      () => window.GAME_TEST_API!.getCharacterState('player')?.activeVisual === 'model',
      undefined,
      { timeout: 10_000 },
    )
  })

  test('forceCharacterAnimation overrides the gait for debugging and restores', async ({ page }) => {
    await gotoGame(page)
    await page.evaluate(() => {
      window.GAME_TEST_API!.resetGame()
      window.GAME_TEST_API!.forceCharacterAnimation('run')
    })
    await page.waitForFunction(
      () => window.GAME_TEST_API!.getCharacterState('player')?.animState === 'run',
      undefined,
      { timeout: 5_000 },
    )
    await page.evaluate(() => window.GAME_TEST_API!.forceCharacterAnimation(null))
    await page.waitForFunction(
      () => window.GAME_TEST_API!.getCharacterState('player')?.animState === 'idle',
      undefined,
      { timeout: 5_000 },
    )
  })

  test('occlusion still fades a building hiding the modeled player', async ({ page }) => {
    await gotoGame(page)
    await page.evaluate(() => {
      window.GAME_TEST_API!.resetGame()
      window.GAME_TEST_API!.setTime(10)
      window.GAME_TEST_API!.teleportPlayer([9.5, 1.2, -1])
    })
    await page.waitForTimeout(1500)
    // Walk east behind the office tower.
    await page.keyboard.down('d')
    await page.keyboard.down('s')
    await page.waitForFunction(
      () =>
        window.GAME_TEST_API!.getVisibilityState().faded.some(
          (f) => f.id === 'building_office_01' && f.opacity < 0.5,
        ),
      undefined,
      { timeout: 8_000 },
    )
    await page.keyboard.up('d')
    await page.keyboard.up('s')
    const player = await page.evaluate(() => window.GAME_TEST_API!.getCharacterState('player')!)
    expect(player.activeVisual).toBe('model')
  })

  test('save → load keeps the modeled player and the saved outfit', async ({ page }) => {
    await gotoGame(page)
    await page.evaluate(async () => {
      window.GAME_TEST_API!.resetGame()
      window.GAME_TEST_API!.setAppearance({ shirtColor: '#2a9d8f' })
      await window.GAME_TEST_API!.saveGame()
      window.GAME_TEST_API!.setAppearance({ shirtColor: '#111111' })
      await window.GAME_TEST_API!.loadGame()
    })
    await page.waitForTimeout(400)
    const result = await page.evaluate(() => ({
      appearance: window.GAME_TEST_API!.getAppearance(),
      state: window.GAME_TEST_API!.getCharacterState('player')!,
    }))
    expect(result.appearance.shirtColor).toBe('#2a9d8f')
    expect(result.state.activeVisual).toBe('model')
  })
})
