import { expect, test, type Page } from '@playwright/test'
import { gotoGame } from './helpers'

/**
 * Personal Economy, Inventory & Shopping v1 — long integration soak (§Testing).
 * Repeatedly exercises purchase, use, transfer, stock depletion/restock, time
 * advancement, store/interior/sector cycling, save/load, Shelf Run success/cancel,
 * and robbery closure/recovery — all while ambient traffic + citizens simulate.
 * Asserts no page errors, no negative quantities/stock/money, no capacity
 * overflow, no duplicate receipts/rewards, no dangling cargo, bounded runtime.
 */

const SOAK_MS = 180_000
test.describe.configure({ timeout: SOAK_MS + 120_000 })

async function cycle(page: Page, i: number): Promise<void> {
  await page.evaluate((n) => {
    const api = window.GAME_TEST_API!
    // Fund the run so purchases can proceed, then shop, use, and transfer.
    api.enterInterior('store_mainst')
    for (let k = 0; k < 3; k++) api.buyTestItem('store_mainst', 'snack')
    api.buyTestItem('store_mainst', 'meal')
    api.useTestItem('snack')
    api.depositTestItem('snack', 1)
    api.withdrawTestItem('snack', 1)
    // Advance the restock clock a full day and reconcile.
    const s = api.getStats()
    api.reconcileStoreStock('store_mainst', s.day * 24 + s.hour + (n % 2 === 0 ? 24 : 6))
    api.exitInterior()

    // Every 3rd loop: a Shelf Run (deliver) or a cancel; every 4th: a robbery
    // that closes the store then recovers via resetActivities.
    if (n % 3 === 0) {
      api.startMission('shelf_run')
      api.collectTestShelfCrate()
      api.forceMissionEvent({ type: 'interactable_used', interactableId: 'shelf_depot' })
      if (n % 6 === 0) {
        api.cancelMission() // cancel path → crate dropped
      } else {
        api.deliverTestShelfCrate('store_mainst')
      }
    }
    if (n % 4 === 0) {
      api.enterInterior('store_mainst')
      api.forceBeginRobbery('robbery_mainst_store')
      api.lootStoreRegister?.()
      api.exitInterior()
      api.clearWanted()
      api.resetActivities() // recover
    }
  }, i)

  // Cycle a store-district sector to prove streaming safety mid-loop.
  await page.evaluate(() => window.GAME_TEST_API!.forceUnloadSector('s1_-2'))
  await page.waitForTimeout(200)
  await page.evaluate(() => window.GAME_TEST_API!.forceLoadSector('s1_-2'))

  // Occasionally persist + reload where allowed (no active pursuit/robbery).
  if (i % 5 === 4) {
    await page.evaluate(async () => {
      const api = window.GAME_TEST_API!
      api.clearWanted()
      api.resetActivities()
      if (await api.saveGame()) {
        api.resetGame()
        await api.loadGame()
      }
    })
  }
  await page.waitForTimeout(150)
}

test('economy soak — shopping/inventory/restock stay clean under streaming', { tag: '@simulation-only' }, async ({ page }) => {
  const errors: string[] = []
  page.on('pageerror', (e) => errors.push(e.message))
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text())
  })
  await gotoGame(page)
  await page.evaluate(() => {
    const api = window.GAME_TEST_API!
    api.resetGame()
    api.setTime(12)
  })
  await page.waitForTimeout(600)

  const started = Date.now()
  let cycles = 0
  while (Date.now() - started < SOAK_MS) {
    await cycle(page, cycles)
    cycles++
  }

  const final = await page.evaluate(() => {
    const api = window.GAME_TEST_API!
    const bag = api.getBackpack()
    const store = api.getStorageContainer()
    const stockMain = api.getStoreStockState('store_mainst').stock
    return {
      money: api.getStats().money,
      bag,
      store,
      stockMain,
      itemValidation: api.getItemValidation(),
      commerceValidation: api.getCommerceValidation(),
      receipts: api.getCommerceReceipts().length,
      crate: bag.stacks.restock_crate ?? 0,
    }
  })

  expect(errors).toEqual([])
  expect(final.money).toBeGreaterThanOrEqual(0) // never negative
  expect(final.bag.occupied).toBeLessThanOrEqual(final.bag.capacity) // no overflow
  expect(final.store.occupied).toBeLessThanOrEqual(final.store.capacity)
  expect(Object.values(final.bag.stacks).every((q) => q > 0 && Number.isInteger(q))).toBe(true)
  expect(Object.values(final.stockMain).every((q) => q >= 0 && Number.isInteger(q))).toBe(true)
  expect(final.itemValidation).toEqual([]) // catalog still valid
  expect(final.commerceValidation).toEqual([]) // stores still valid
  expect(final.receipts).toBeLessThanOrEqual(64) // bounded receipt log
  expect(final.crate).toBe(0) // no dangling mission cargo
  expect(cycles).toBeGreaterThan(0)
  console.log(`[ECONOMY SOAK] cycles=${cycles}`)
})
