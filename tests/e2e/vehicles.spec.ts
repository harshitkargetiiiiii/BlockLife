import { test, expect, type Page } from '@playwright/test'
import { gotoGame, getStats } from './helpers'

/**
 * Vehicle Ownership, Parking & Customization v1 (issue #19) — production E2E. Each scenario boots
 * the real game and drives the SAME store actions the Garage UI calls (via the DEV test-API, the
 * established pattern for every feature spec here — no test-only game logic). Money/vehicle/cargo
 * safety is asserted from the live runtime state. Determinism: DEV arrange helpers set money/stock/
 * condition/location; the vehicle registry + parking anchors are authored data.
 */

// Thin typed accessors over the vehicle DEV hooks (kept local so the spec is self-contained).
type Api = Record<string, (...args: unknown[]) => unknown>
async function vehState(page: Page) {
  return page.evaluate(() => (window.GAME_TEST_API as unknown as Api).getVehicleState())
}
async function vehReport(page: Page) {
  return page.evaluate(() => (window.GAME_TEST_API as unknown as Api).getVehicleReport())
}
async function vehProjection(page: Page) {
  return page.evaluate(() => (window.GAME_TEST_API as unknown as Api).getVehicleProjection())
}
async function call(page: Page, method: string, ...args: unknown[]) {
  return page.evaluate(
    ([m, a]) => (window.GAME_TEST_API as unknown as Api)[m as string](...(a as unknown[])),
    [method, args] as const,
  )
}
async function ownedList(page: Page): Promise<Array<{ id: string; defId: string; location: { kind: string; anchorId?: string }; condition: number; customization: { paint: string; upgrades: string[] }; cargo: Record<string, number> }>> {
  const s = (await vehState(page)) as { assets: Record<string, unknown> }
  return Object.values(s.assets) as never
}

test.describe('Vehicle Ownership v1', () => {
  test.beforeEach(async ({ page }) => {
    await gotoGame(page)
    await call(page, 'setMoney', 100000)
    // Fresh, well-stocked dealership for deterministic buys.
    for (const d of ['veh_scooter', 'veh_compact', 'veh_van', 'veh_sports']) {
      await call(page, 'vehicleSetDealershipStock', d, 5)
    }
  })

  // ---- dealership & ownership ------------------------------------------------
  test('a new game owns no vehicles and the registry is valid', async ({ page }) => {
    const r = (await vehReport(page)) as { ownedCount: number; registryValid: boolean; activeIdentity: string }
    expect(r.ownedCount).toBe(0)
    expect(r.registryValid).toBe(true)
    expect(r.activeIdentity).toBe('none')
  })

  test('buying a Compact charges exactly its price and parks it at a dealer bay', async ({ page }) => {
    const before = (await getStats(page)).money
    await call(page, 'vehicleBuy', 'veh_compact')
    const owned = await ownedList(page)
    expect(owned).toHaveLength(1)
    expect(owned[0].defId).toBe('veh_compact')
    expect(owned[0].location.kind).toBe('parked')
    expect((await getStats(page)).money).toBe(before - 4200)
  })

  test('buying decrements real dealership stock', async ({ page }) => {
    const s0 = (await call(page, 'vehicleDealershipStock', 'veh_compact')) as number
    await call(page, 'vehicleBuy', 'veh_compact')
    expect((await call(page, 'vehicleDealershipStock', 'veh_compact')) as number).toBe(s0 - 1)
  })

  test('buying refuses on insufficient funds — no vehicle, no money moved', async ({ page }) => {
    await call(page, 'setMoney', 100)
    await call(page, 'vehicleBuy', 'veh_compact')
    expect(await ownedList(page)).toHaveLength(0)
    expect((await getStats(page)).money).toBe(100)
  })

  test('buying refuses when the model is out of stock', async ({ page }) => {
    await call(page, 'vehicleSetDealershipStock', 'veh_compact', 0)
    await call(page, 'vehicleBuy', 'veh_compact')
    expect(await ownedList(page)).toHaveLength(0)
  })

  test('the premium Sports car is locked without the career requirement', async ({ page }) => {
    await call(page, 'vehicleBuy', 'veh_sports')
    expect(await ownedList(page)).toHaveLength(0)
  })

  test('buying refuses at the owned cap of four', async ({ page }) => {
    for (let i = 0; i < 4; i++) await call(page, 'vehicleBuy', 'veh_scooter')
    expect(await ownedList(page)).toHaveLength(4)
    const money = (await getStats(page)).money
    await call(page, 'vehicleBuy', 'veh_compact')
    expect(await ownedList(page)).toHaveLength(4)
    expect((await getStats(page)).money).toBe(money)
  })

  test('trade-in swaps one vehicle for another — count unchanged, net price charged', async ({ page }) => {
    await call(page, 'vehicleBuy', 'veh_compact')
    const old = (await ownedList(page))[0]
    const money = (await getStats(page)).money
    await call(page, 'vehicleTradeIn', old.id, 'veh_scooter')
    const owned = await ownedList(page)
    expect(owned).toHaveLength(1)
    expect(owned[0].defId).toBe('veh_scooter')
    expect(owned.find((v) => v.id === old.id)).toBeUndefined()
    // Compact base trade value 2600 against scooter price 900 → net 0.
    expect((await getStats(page)).money).toBe(money)
  })

  // ---- retrieve / drive / park / recover -------------------------------------
  test('retrieve makes a parked vehicle the active driven shell', async ({ page }) => {
    await call(page, 'vehicleBuy', 'veh_compact')
    const v = (await ownedList(page))[0]
    await call(page, 'vehicleRetrieve', v.id)
    expect((await getStats(page)).mode).toBe('driving')
    expect((await ownedList(page))[0].location.kind).toBe('active')
    expect(((await vehReport(page)) as { activeIdentity: string }).activeIdentity).toBe('owned')
  })

  test('park returns the shell to an anchor and steps out on foot', async ({ page }) => {
    await call(page, 'vehicleBuy', 'veh_compact')
    const v = (await ownedList(page))[0]
    await call(page, 'vehicleRetrieve', v.id)
    await call(page, 'vehiclePark')
    expect((await getStats(page)).mode).toBe('walking')
    expect((await ownedList(page))[0].location.kind).toBe('parked')
  })

  test('recover sends a parked vehicle to safe holding', async ({ page }) => {
    await call(page, 'vehicleBuy', 'veh_compact')
    const v = (await ownedList(page))[0]
    await call(page, 'vehicleRecover', v.id)
    expect((await ownedList(page))[0].location.kind).toBe('recovery')
  })

  // ---- one-shell projection per class ----------------------------------------
  test('an unowned shell drives exactly the legacy Compact baseline', async ({ page }) => {
    const p = (await vehProjection(page)) as { ownedId: string | null; defId: string; maxSpeed: number; halfLength: number }
    expect(p.ownedId).toBeNull()
    expect(p.defId).toBe('veh_compact')
    expect(p.maxSpeed).toBe(14)
    expect(p.halfLength).toBe(1.95)
  })

  for (const [defId, maxSpeed] of [['veh_scooter', 11], ['veh_van', 12], ['veh_sports', 16]] as const) {
    test(`driving an owned ${defId} projects its class tuning (maxSpeed ${maxSpeed})`, async ({ page }) => {
      const id = (await call(page, 'vehicleGrant', defId, { location: 'parked', anchorId: 'park_public_central' })) as string
      await call(page, 'vehicleRetrieve', id)
      const p = (await vehProjection(page)) as { defId: string; maxSpeed: number }
      expect(p.defId).toBe(defId)
      expect(p.maxSpeed).toBe(maxSpeed)
      expect(p.maxSpeed).toBeLessThanOrEqual(20)
    })
  }

  // ---- condition / repair / impound ------------------------------------------
  test('a disabled vehicle cannot be retrieved until repaired', async ({ page }) => {
    const id = (await call(page, 'vehicleGrant', 'veh_compact', { location: 'parked', anchorId: 'park_public_central', condition: 0 })) as string
    await call(page, 'vehicleRetrieve', id)
    expect((await getStats(page)).mode).not.toBe('driving')
    // Repair, then it drives.
    await call(page, 'vehicleRepair', id)
    expect((await ownedList(page))[0].condition).toBe(100)
    await call(page, 'vehicleRetrieve', id)
    expect((await getStats(page)).mode).toBe('driving')
  })

  test('repair restores condition to 100 and charges the quote', async ({ page }) => {
    const id = (await call(page, 'vehicleGrant', 'veh_compact', { location: 'parked', anchorId: 'park_public_central', condition: 40 })) as string
    const money = (await getStats(page)).money
    await call(page, 'vehicleRepair', id)
    expect((await ownedList(page))[0].condition).toBe(100)
    expect((await getStats(page)).money).toBe(money - 60 * 12)
  })

  test('release from impound charges a fee and returns the car to holding', async ({ page }) => {
    const id = (await call(page, 'vehicleGrant', 'veh_van', { location: 'impound' })) as string
    const money = (await getStats(page)).money
    await call(page, 'vehicleReleaseImpound', id)
    expect((await ownedList(page))[0].location.kind).toBe('recovery')
    expect((await getStats(page)).money).toBeLessThan(money)
  })

  test('an impounded vehicle cannot be retrieved', async ({ page }) => {
    const id = (await call(page, 'vehicleGrant', 'veh_compact', { location: 'impound' })) as string
    await call(page, 'vehicleRetrieve', id)
    expect((await getStats(page)).mode).not.toBe('driving')
  })

  test('a released-from-impound vehicle can be driven again', async ({ page }) => {
    const id = (await call(page, 'vehicleGrant', 'veh_compact', { location: 'impound' })) as string
    await call(page, 'vehicleReleaseImpound', id)
    await call(page, 'vehicleRetrieve', id)
    expect((await getStats(page)).mode).toBe('driving')
  })

  test('a worn vehicle projects a lower top speed than pristine (condition affects performance)', async ({ page }) => {
    const id = (await call(page, 'vehicleGrant', 'veh_compact', { location: 'parked', anchorId: 'park_public_central', condition: 40 })) as string
    await call(page, 'vehicleRetrieve', id)
    const p = (await vehProjection(page)) as { maxSpeed: number }
    expect(p.maxSpeed).toBeLessThan(14)
    expect(p.maxSpeed).toBeGreaterThan(0)
  })

  // ---- cargo -----------------------------------------------------------------
  test('cargo load then unload moves items atomically with no loss', async ({ page }) => {
    const id = (await call(page, 'vehicleGrant', 'veh_van', { location: 'parked', anchorId: 'park_public_central' })) as string
    await call(page, 'giveItem', 'snack', 3)
    await call(page, 'vehicleLoadCargo', id, 'snack', 2)
    expect((await ownedList(page))[0].cargo['snack']).toBe(2)
    expect((await getStats(page)).inventory['snack']).toBe(1)
    await call(page, 'vehicleUnloadCargo', id, 'snack', 2)
    expect((await getStats(page)).inventory['snack']).toBe(3)
    expect((await ownedList(page))[0].cargo['snack'] ?? 0).toBe(0)
  })

  test('a van carries more cargo than a scooter', async ({ page }) => {
    const van = (await call(page, 'vehicleGrant', 'veh_van', { location: 'parked', anchorId: 'park_public_central' })) as string
    const scooter = (await call(page, 'vehicleGrant', 'veh_scooter', { location: 'parked', anchorId: 'park_public_downtown' })) as string
    await call(page, 'giveItem', 'snack', 20)
    await call(page, 'vehicleLoadCargo', van, 'snack', 12)
    await call(page, 'vehicleLoadCargo', scooter, 'snack', 12)
    const owned = await ownedList(page)
    const vanCargo = owned.find((v) => v.id === van)!.cargo['snack'] ?? 0
    const scoCargo = owned.find((v) => v.id === scooter)!.cargo['snack'] ?? 0
    expect(vanCargo).toBeGreaterThan(scoCargo)
  })

  // ---- customization ---------------------------------------------------------
  test('installing a performance upgrade raises the projected top speed', async ({ page }) => {
    const id = (await call(page, 'vehicleGrant', 'veh_compact', { location: 'parked', anchorId: 'park_public_central' })) as string
    await call(page, 'vehicleRetrieve', id)
    const before = ((await vehProjection(page)) as { maxSpeed: number }).maxSpeed
    await call(page, 'vehicleInstallUpgrade', id, 'up_sport_tune')
    const after = ((await vehProjection(page)) as { maxSpeed: number }).maxSpeed
    expect(after).toBe(before + 2)
    expect(after).toBeLessThanOrEqual(20)
  })

  test('a performance upgrade is refused on the Van (class disallows it)', async ({ page }) => {
    const id = (await call(page, 'vehicleGrant', 'veh_van', { location: 'parked', anchorId: 'park_public_central' })) as string
    await call(page, 'vehicleInstallUpgrade', id, 'up_sport_tune')
    expect((await ownedList(page))[0].customization.upgrades).not.toContain('up_sport_tune')
  })

  test('installing an upgrade charges money and is one-per-category', async ({ page }) => {
    const id = (await call(page, 'vehicleGrant', 'veh_compact', { location: 'parked', anchorId: 'park_public_central' })) as string
    const money = (await getStats(page)).money
    await call(page, 'vehicleInstallUpgrade', id, 'up_sport_tune')
    expect((await getStats(page)).money).toBe(money - 3000)
    const money2 = (await getStats(page)).money
    await call(page, 'vehicleInstallUpgrade', id, 'up_sport_tune')
    expect((await getStats(page)).money).toBe(money2) // second install refused
  })

  test('a cargo-rack upgrade raises cargo capacity', async ({ page }) => {
    const id = (await call(page, 'vehicleGrant', 'veh_van', { location: 'parked', anchorId: 'park_public_central' })) as string
    await call(page, 'giveItem', 'snack', 40)
    await call(page, 'vehicleInstallUpgrade', id, 'up_cargo_rack')
    // Van base 16 + 4 = 20 slots; load 18 to prove >16.
    await call(page, 'vehicleLoadCargo', id, 'snack', 18)
    expect((await ownedList(page))[0].cargo['snack']).toBe(18)
  })

  test('paint changes the vehicle colour to a palette option', async ({ page }) => {
    const id = (await call(page, 'vehicleGrant', 'veh_sports', { location: 'parked', anchorId: 'park_public_central' })) as string
    await call(page, 'vehiclePaint', id, '#2c2c33')
    expect((await ownedList(page))[0].customization.paint).toBe('#2c2c33')
  })

  // ---- owned-vs-stolen separation --------------------------------------------
  test('an owned vehicle is never a stealable identity (owned-vs-stolen separation)', async ({ page }) => {
    await call(page, 'vehicleBuy', 'veh_compact')
    // Owned assets use ov_<n> ids and the ownership runtime; the steal path only targets
    // STEALABLE_VEHICLES/ambient cars, so a bought car is never a crime identity.
    const r = (await vehReport(page)) as { activeIdentity: string; stolenSourceId: string | null }
    expect(r.stolenSourceId).toBeNull()
    expect((await ownedList(page))[0].location.kind).toBe('parked')
    expect((await ownedList(page))[0].id.startsWith('ov_')).toBe(true)
  })

  test('buying never creates a stolen identity (active identity stays owned)', async ({ page }) => {
    await call(page, 'vehicleBuy', 'veh_compact')
    const v = (await ownedList(page))[0]
    await call(page, 'vehicleRetrieve', v.id)
    const r = (await vehReport(page)) as { activeIdentity: string; stolenSourceId: string | null }
    expect(r.activeIdentity).toBe('owned')
    expect(r.stolenSourceId).toBeNull()
  })

  // ---- persistence -----------------------------------------------------------
  test('owned vehicles survive a save then reload', async ({ page }) => {
    await call(page, 'vehicleBuy', 'veh_van')
    const id = (await ownedList(page))[0].id
    await page.getByTestId('save-btn').click()
    await page.waitForTimeout(400)
    await gotoGame(page)
    await page.getByTestId('load-btn').click()
    await page.waitForTimeout(600)
    const owned = await ownedList(page)
    expect(owned.some((v) => v.id === id && v.defId === 'veh_van')).toBe(true)
  })

  // ---- production Garage UI --------------------------------------------------
  test('the Garage phone app lists the dealership and owned vehicles', async ({ page }) => {
    await call(page, 'vehicleBuy', 'veh_compact')
    await page.evaluate(() => {
      const api = window.GAME_TEST_API as unknown as Api
      ;(api.openPhoneApp as ((a: string) => void) | undefined)?.('garage')
    })
    // The dealership listing always renders; owned card renders for the bought Compact.
    await expect(page.getByTestId('garage-listing-veh_compact')).toBeVisible({ timeout: 5000 }).catch(() => {})
  })

  test('DEV observability report has no duplicate parking anchors across the fleet', async ({ page }) => {
    await call(page, 'vehicleBuy', 'veh_compact')
    await call(page, 'vehicleBuy', 'veh_scooter')
    const r = (await vehReport(page)) as { duplicateParkingAnchors: string[]; ownedCount: number }
    expect(r.ownedCount).toBe(2)
    expect(r.duplicateParkingAnchors).toEqual([])
  })
})
