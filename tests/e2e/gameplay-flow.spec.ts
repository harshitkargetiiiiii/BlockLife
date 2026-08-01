import { expect, test } from '@playwright/test'
import { acquireDrivableCar, getStats, gotoGame, pressE, teleport, waitForActiveInteractable } from './helpers'

test.describe('gameplay flow', () => {
  test.beforeEach(async ({ page }) => {
    await gotoGame(page)
    await page.evaluate(() => window.GAME_TEST_API!.resetGame())
    await page.waitForTimeout(300)
  })

  test('player moves with the keyboard and runs with shift', async ({ page }) => {
    await teleport(page, [0, 1.2, 0])
    const start = (await getStats(page)).position

    await page.keyboard.down('w')
    await page.waitForTimeout(600)
    await page.keyboard.up('w')
    const walked = (await getStats(page)).position
    const walkDist = Math.hypot(walked[0] - start[0], walked[2] - start[2])
    expect(walkDist).toBeGreaterThan(1)

    await teleport(page, [0, 1.2, 0])
    await page.keyboard.down('Shift')
    await page.keyboard.down('w')
    await page.waitForTimeout(600)
    await page.keyboard.up('w')
    await page.keyboard.up('Shift')
    const ran = (await getStats(page)).position
    const runDist = Math.hypot(ran[0], ran[2])
    expect(runDist).toBeGreaterThan(walkDist)
  })

  test('food truck: buying a meal updates money and hunger', async ({ page }) => {
    // Freeze the clock so hunger doesn't tick between reads.
    await page.evaluate(() => window.GAME_TEST_API!.pauseWorld(true))
    await teleport(page, [1.5, 1.2, -3.5])
    await waitForActiveInteractable(page, 'food_truck_01')
    await expect(page.getByTestId('interaction-prompt')).toContainText("Maya's Snack Truck")

    await pressE(page)
    await expect(page.getByTestId('activity-panel')).toBeVisible()

    const before = await getStats(page)
    await page.getByTestId('action-buy_meal').click()
    const after = await getStats(page)
    expect(after.money).toBe(before.money - 10)
    expect(after.hunger).toBe(Math.max(0, before.hunger - 25))

    await page.keyboard.press('Escape')
    await expect(page.getByTestId('activity-panel')).toBeHidden()
  })

  test('gym, job board and apartment interactions work', async ({ page }) => {
    // Gym: train
    await teleport(page, [14, 1.2, -9.2])
    await waitForActiveInteractable(page, 'gym')
    await pressE(page)
    await page.getByTestId('action-train').click()
    let stats = await getStats(page)
    expect(stats.strength).toBe(2)
    await page.keyboard.press('Escape')

    // Job board: opens Careers v1 (discover/apply), not a money vendor (R4).
    await teleport(page, [11, 1.2, -4.5])
    await waitForActiveInteractable(page, 'job_board')
    await pressE(page)
    await page.getByTestId('action-open_careers').click()
    await expect(page.getByTestId('phone-jobs')).toBeVisible()
    await page.keyboard.press('Escape')

    // Apartment (Home Base v1): the door leads inside; sleep at the bed.
    await teleport(page, [-12.5, 1.2, -9])
    await waitForActiveInteractable(page, 'apartment')
    await pressE(page)
    await page.waitForFunction(() => window.GAME_TEST_API!.getLocationMode() === 'apartment')
    await teleport(page, [197.5, 1.2, 198.6])
    await waitForActiveInteractable(page, 'apartment_bed')
    await pressE(page)
    await page.getByTestId('action-sleep').click()
    stats = await getStats(page)
    expect(stats.energy).toBe(100)
    expect(stats.day).toBe(2)
    expect(Math.floor(stats.hour)).toBe(7)
    // Head back out to the street for the tests that follow.
    await teleport(page, [203.4, 1.2, 203.6])
    await waitForActiveInteractable(page, 'apartment_exit')
    await pressE(page)
    await page.waitForFunction(() => window.GAME_TEST_API!.getLocationMode() === 'city')
  })

  test('Coffee for Ravi quest completes end to end', async ({ page }) => {
    // Freeze routines so Ravi stays put while we ferry the coffee.
    await page.evaluate(() => {
      window.GAME_TEST_API!.setTime(9)
      window.GAME_TEST_API!.pauseWorld(true)
    })
    await page.waitForTimeout(400)

    const raviPos = await page.evaluate(() =>
      window.GAME_TEST_API!.getNpcPosition('npc_ravi_01'),
    )
    expect(raviPos).not.toBeNull()

    // 1. Accept the quest.
    await teleport(page, [raviPos![0] + 0.6, 1.2, raviPos![2] + 0.6])
    await waitForActiveInteractable(page, 'npc_ravi_01')
    await pressE(page)
    await expect(page.getByTestId('dialogue-panel')).toBeVisible()
    await expect(page.getByTestId('dialogue-npc-name')).toHaveText('Ravi')
    await page.locator('[data-action-id="accept_quest"]').click()
    expect((await getStats(page)).questStates['coffee_for_ravi']).toBe('active')
    await expect(page.getByTestId('quest-step')).toContainText('Buy a coffee')

    // 2. Buy the coffee.
    await teleport(page, [1.5, 1.2, -3.5])
    await waitForActiveInteractable(page, 'food_truck_01')
    await pressE(page)
    await page.getByTestId('action-buy_coffee').click()
    let stats = await getStats(page)
    expect(stats.questStates['coffee_for_ravi']).toBe('has_coffee')
    expect(stats.inventory['coffee']).toBe(1)
    await page.keyboard.press('Escape')

    // 3. Deliver it.
    await teleport(page, [raviPos![0] + 0.6, 1.2, raviPos![2] + 0.6])
    await waitForActiveInteractable(page, 'npc_ravi_01')
    const beforeReward = await getStats(page)
    await pressE(page)
    await page.locator('[data-action-id="deliver_coffee"]').click()
    stats = await getStats(page)
    expect(stats.questStates['coffee_for_ravi']).toBe('completed')
    expect(stats.money).toBe(beforeReward.money + 25)
    expect(stats.reputation).toBe(beforeReward.reputation + 5)
    expect(stats.inventory['coffee']).toBeUndefined()
    await expect(page.getByTestId('quest-state')).toHaveText('Done')
  })

  test('player can enter, drive and exit the car', async ({ page }) => {
    await acquireDrivableCar(page) // §19: no free car on a new game — own an active Compact shell first
    await teleport(page, [13, 1.2, 14])
    await waitForActiveInteractable(page, 'vehicle_compact_car_01')

    await pressE(page)
    let stats = await getStats(page)
    expect(stats.mode).toBe('driving')

    const start = stats.position
    await page.keyboard.down('w')
    await page.waitForTimeout(900)
    await page.keyboard.up('w')
    stats = await getStats(page)
    const dist = Math.hypot(stats.position[0] - start[0], stats.position[2] - start[2])
    expect(dist).toBeGreaterThan(2)

    await pressE(page)
    stats = await getStats(page)
    expect(stats.mode).toBe('walking')
  })

  test('the car cannot drive through buildings', async ({ page }) => {
    await acquireDrivableCar(page) // §19: own an active Compact shell before the classic enter flow
    await teleport(page, [13, 1.2, 14])
    await waitForActiveInteractable(page, 'vehicle_compact_car_01')
    await pressE(page)

    // Point the car at the office tower (building_office_01 at x=16.5, z=-1)
    // and floor it. The building collider should stop it well outside the wall.
    await page.keyboard.down('w')
    await page.waitForTimeout(2500)
    await page.keyboard.up('w')
    const stats = await getStats(page)
    const [x, , z] = stats.position
    const insideOffice = x > 13 && x < 20 && z > -4.5 && z < 2.5
    expect(insideOffice, `car ended up inside the office at ${x}, ${z}`).toBe(false)

    // Exiting while pinned against the building must not strand the player
    // inside a collider: they should land on a clear spot and be able to move.
    await pressE(page)
    const onFoot = await getStats(page)
    expect(onFoot.mode).toBe('walking')
    const before = onFoot.position
    await page.keyboard.down('s')
    await page.waitForTimeout(500)
    await page.keyboard.up('s')
    const after = (await getStats(page)).position
    const moved = Math.hypot(after[0] - before[0], after[2] - before[2])
    expect(moved, 'player stuck after exiting against a wall').toBeGreaterThan(0.8)
  })
})
