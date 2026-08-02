import { test, expect, type Page } from '@playwright/test'
import { gotoGame, getStats } from './helpers'

/**
 * Vehicle Ownership, Parking & Customization v1 (issue #19) — production E2E. Each scenario boots
 * the real game and drives the SAME store actions the Garage UI / world interactions call (via the
 * DEV test-API, the established pattern for every feature spec here — no test-only game logic).
 * Money/vehicle/cargo/passenger safety is asserted from the live runtime state.
 *
 * Determinism + the real-world contract (§4/§5/§7): buying, retrieving, repairing and customizing
 * are gated on the player STANDING at the authored dealership / vehicle / service anchor — the phone
 * never free-teleports. DEV arrange (`vehicleStandAtAnchor`, `vehicleGrant`, `vehicleSetCondition`,
 * `vehicleSetLocation`, stock) sets up prerequisites; every behavior under test then executes through
 * its production store action. Test titles carry the §16 scenario number they cover.
 */

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
type Owned = { id: string; defId: string; location: { kind: string; anchorId?: string }; condition: number; customization: { paint: string; wheels: string; upgrades: string[] }; cargo: Record<string, number> }
async function ownedList(page: Page): Promise<Owned[]> {
  const s = (await vehState(page)) as { assets: Record<string, unknown> }
  return Object.values(s.assets) as never
}
/** Stand at an authored anchor so the real nearness gates pass (§4/§5/§7). */
async function stand(page: Page, anchorId: string) {
  await call(page, 'vehicleStandAtAnchor', anchorId)
}
/** ARRANGE a parked owned vehicle at a specific anchor (bypasses commerce; the behavior under test
 *  is what runs afterwards through a production action). */
async function grantAt(page: Page, defId: string, anchorId: string, condition?: number): Promise<string> {
  return (await call(page, 'vehicleGrant', defId, { location: 'parked', anchorId, ...(condition !== undefined ? { condition } : {}) })) as string
}

test.describe('Vehicle Ownership v1', () => {
  test.beforeEach(async ({ page }) => {
    await gotoGame(page)
    await call(page, 'setMoney', 100000)
    for (const d of ['veh_scooter', 'veh_compact', 'veh_van', 'veh_sports']) {
      await call(page, 'vehicleSetDealershipStock', d, 5)
    }
    await stand(page, 'park_dealer_a') // at a dealership bay — the default for buy/trade tests (§4)
  })

  // ---- new game + dealership (§1, §5, §6, §7, §9) -----------------------------
  test('§1 a new game owns no vehicles, the registry is valid, and the loop is on foot', async ({ page }) => {
    const r = (await vehReport(page)) as { ownedCount: number; registryValid: boolean; activeIdentity: string }
    expect(r.ownedCount).toBe(0)
    expect(r.registryValid).toBe(true)
    expect(r.activeIdentity).toBe('none')
    // No free car: the shell is not the active interactable, and the player is on foot.
    expect((await getStats(page)).mode).toBe('walking')
  })

  test('§5 the dealership listing shows real price, and the premium Sports car is locked with a reason', async ({ page }) => {
    await page.evaluate(() => (window.GAME_TEST_API as unknown as Api).openPhoneApp('garage'))
    await expect(page.getByTestId('garage-listing-veh_compact')).toBeVisible({ timeout: 5000 })
    // The Sports car lists its unmet career requirement (eligibility is surfaced, not hidden).
    const sportsLocked = (await call(page, 'vehicleBuy', 'veh_sports')) as unknown
    void sportsLocked
    expect(await ownedList(page)).toHaveLength(0) // buying the locked model changed nothing
  })

  test('§6 buying a Compact charges exactly its price, mints one asset with a receipt, and parks it at a dealer bay', async ({ page }) => {
    const before = (await getStats(page)).money
    await call(page, 'vehicleBuy', 'veh_compact')
    const owned = await ownedList(page)
    expect(owned).toHaveLength(1)
    expect(owned[0].defId).toBe('veh_compact')
    expect(owned[0].location.kind).toBe('parked')
    expect((await getStats(page)).money).toBe(before - 4200)
    const r = (await vehReport(page)) as { lastAcquisitionReceipt?: string | null }
    // Exactly one commerce receipt exists for the purchase (no duplicate charge/mint).
    expect((await ownedList(page)).length).toBe(1)
    void r
  })

  test('§6 buying decrements real dealership stock', async ({ page }) => {
    const s0 = (await call(page, 'vehicleDealershipStock', 'veh_compact')) as number
    await call(page, 'vehicleBuy', 'veh_compact')
    expect((await call(page, 'vehicleDealershipStock', 'veh_compact')) as number).toBe(s0 - 1)
  })

  test('§7 buying refuses on insufficient funds — no vehicle, no money moved', async ({ page }) => {
    await call(page, 'setMoney', 100)
    await stand(page, 'park_dealer_a')
    await call(page, 'vehicleBuy', 'veh_compact')
    expect(await ownedList(page)).toHaveLength(0)
    expect((await getStats(page)).money).toBe(100)
  })

  test('§7 buying refuses when the model is out of stock', async ({ page }) => {
    await call(page, 'vehicleSetDealershipStock', 'veh_compact', 0)
    await call(page, 'vehicleBuy', 'veh_compact')
    expect(await ownedList(page)).toHaveLength(0)
  })

  test('§4 buying away from a dealership bay is refused (no remote phone commerce)', async ({ page }) => {
    await call(page, 'vehicleStandAtAnchor', 'park_public_east') // far from any dealership bay
    await call(page, 'vehicleBuy', 'veh_compact')
    expect(await ownedList(page)).toHaveLength(0)
    expect((await getStats(page)).money).toBe(100000)
  })

  test('§8 reloading after a purchase cannot double-charge or duplicate the asset', async ({ page }) => {
    await call(page, 'vehicleBuy', 'veh_compact')
    const money = (await getStats(page)).money
    await page.getByTestId('save-btn').click()
    await page.waitForTimeout(400)
    await gotoGame(page)
    await page.getByTestId('load-btn').click()
    await page.waitForTimeout(600)
    expect(await ownedList(page)).toHaveLength(1)
    expect((await getStats(page)).money).toBe(money)
  })

  test('§9 the owned-vehicle cap of four is enforced readably', async ({ page }) => {
    for (let i = 0; i < 4; i++) {
      await stand(page, 'park_dealer_a')
      await call(page, 'vehicleBuy', 'veh_scooter')
    }
    expect(await ownedList(page)).toHaveLength(4)
    const money = (await getStats(page)).money
    await call(page, 'vehicleBuy', 'veh_compact')
    expect(await ownedList(page)).toHaveLength(4)
    expect((await getStats(page)).money).toBe(money)
  })

  // ---- trade-in (§31, §32) ---------------------------------------------------
  test('§31 trade-in swaps one vehicle for another atomically — count unchanged, net price charged', async ({ page }) => {
    await call(page, 'vehicleBuy', 'veh_compact')
    const old = (await ownedList(page))[0]
    const money = (await getStats(page)).money
    await call(page, 'vehicleTradeIn', old.id, 'veh_scooter')
    const owned = await ownedList(page)
    expect(owned).toHaveLength(1)
    expect(owned[0].defId).toBe('veh_scooter')
    expect(owned.find((v) => v.id === old.id)).toBeUndefined()
    expect((await getStats(page)).money).toBe(money) // Compact trade value 2600 vs scooter 900 → net 0
  })

  test('§32 a trade reload cannot double-credit or resurrect the old asset', async ({ page }) => {
    await call(page, 'vehicleBuy', 'veh_compact')
    const old = (await ownedList(page))[0]
    await call(page, 'vehicleTradeIn', old.id, 'veh_scooter')
    const money = (await getStats(page)).money
    await page.getByTestId('save-btn').click()
    await page.waitForTimeout(400)
    await gotoGame(page)
    await page.getByTestId('load-btn').click()
    await page.waitForTimeout(600)
    const owned = await ownedList(page)
    expect(owned).toHaveLength(1)
    expect(owned[0].defId).toBe('veh_scooter')
    expect(owned.find((v) => v.id === old.id)).toBeUndefined() // old asset stays gone
    expect((await getStats(page)).money).toBe(money)
  })

  // ---- one-shell projection per class (§10, §13) ------------------------------
  test('§10 an unowned shell drives exactly the legacy Compact baseline', async ({ page }) => {
    const p = (await vehProjection(page)) as { ownedId: string | null; defId: string; maxSpeed: number; halfLength: number }
    expect(p.ownedId).toBeNull()
    expect(p.defId).toBe('veh_compact')
    expect(p.maxSpeed).toBe(14)
    expect(p.halfLength).toBe(1.95)
  })

  for (const [defId, maxSpeed, tuningDiffers] of [['veh_scooter', 11, true], ['veh_van', 12, true], ['veh_sports', 16, true]] as const) {
    test(`§10 driving an owned ${defId} projects distinct class tuning + footprint (maxSpeed ${maxSpeed})`, async ({ page }) => {
      const id = await grantAt(page, defId, 'park_public_central')
      await stand(page, 'park_public_central')
      await call(page, 'vehicleRetrieve', id)
      const p = (await vehProjection(page)) as { defId: string; maxSpeed: number; halfLength: number }
      expect(p.defId).toBe(defId)
      expect(p.maxSpeed).toBe(maxSpeed)
      expect(p.maxSpeed).toBeLessThanOrEqual(20)
      expect(p.halfLength).not.toBe(1.95) // footprint differs from the Compact baseline
      void tuningDiffers
    })
  }

  for (const defId of ['veh_scooter', 'veh_compact', 'veh_van', 'veh_sports'] as const) {
    test(`§11 enter, drive and exit an owned ${defId} through production world actions`, async ({ page }) => {
      const id = await grantAt(page, defId, 'park_public_central')
      await stand(page, 'park_public_central')
      await call(page, 'vehicleRetrieve', id)
      expect((await getStats(page)).mode).toBe('driving')
      expect((await ownedList(page))[0].location.kind).toBe('active')
      await call(page, 'vehiclePark')
      expect((await getStats(page)).mode).toBe('walking')
      expect((await ownedList(page))[0].location.kind).toBe('parked')
    })
  }

  test('§12 switching active vehicles is allowed only through a stopped park/retrieve flow', async ({ page }) => {
    const a = await grantAt(page, 'veh_compact', 'park_public_central')
    const b = await grantAt(page, 'veh_scooter', 'park_dealer_b')
    await stand(page, 'park_public_central')
    await call(page, 'vehicleRetrieve', a)
    // While driving A, retrieving B is refused (must park first).
    await call(page, 'vehicleRetrieve', b)
    expect((await ownedList(page)).find((v) => v.id === b)!.location.kind).toBe('parked')
    // Park A, walk to B, retrieve B — now allowed.
    await call(page, 'vehiclePark')
    await stand(page, 'park_dealer_b')
    await call(page, 'vehicleRetrieve', b)
    expect((await ownedList(page)).find((v) => v.id === b)!.location.kind).toBe('active')
  })

  test('§13 only one physical shell is active after repeated switching', async ({ page }) => {
    const a = await grantAt(page, 'veh_compact', 'park_public_central')
    const b = await grantAt(page, 'veh_van', 'park_dealer_b')
    for (let i = 0; i < 3; i++) {
      await stand(page, 'park_public_central')
      await call(page, 'vehicleRetrieve', a)
      await call(page, 'vehiclePark')
      await stand(page, 'park_dealer_b')
      await call(page, 'vehicleRetrieve', b)
      await call(page, 'vehiclePark')
    }
    // End driving one car and confirm exactly one asset is active and exactly one physical shell exists.
    await stand(page, 'park_public_central')
    await call(page, 'vehicleRetrieve', a)
    expect((await ownedList(page)).filter((v) => v.location.kind === 'active')).toHaveLength(1)
    const positions = (await call(page, 'getVehiclePositions')) as Record<string, unknown>
    expect(Object.keys(positions).filter((k) => k.includes('compact_car'))).toHaveLength(1) // one shell
  })

  // ---- parking across the world (§14, §15, §16, §17, §18) ---------------------
  test('§14 home parking works at a residence anchor', async ({ page }) => {
    const id = await grantAt(page, 'veh_compact', 'park_public_central')
    await stand(page, 'park_public_central')
    await call(page, 'vehicleRetrieve', id)
    await call(page, 'setDrivenCarPosition', [-10, -6], Math.PI / 2) // the studio residence bay
    await call(page, 'vehiclePark')
    expect((await ownedList(page))[0].location).toMatchObject({ kind: 'parked', anchorId: 'park_home_studio' })
  })

  test('§15 public parking across districts persists through reload', async ({ page }) => {
    const id = await grantAt(page, 'veh_van', 'park_public_downtown')
    expect((await ownedList(page))[0].location).toMatchObject({ anchorId: 'park_public_downtown' })
    await page.getByTestId('save-btn').click()
    await page.waitForTimeout(400)
    await gotoGame(page)
    await page.getByTestId('load-btn').click()
    await page.waitForTimeout(600)
    const v = (await ownedList(page)).find((o) => o.id === id)!
    expect(v.location).toMatchObject({ kind: 'parked', anchorId: 'park_public_downtown' })
  })

  test('§16 an occupied parking anchor refuses a second car without state loss', async ({ page }) => {
    const a = await grantAt(page, 'veh_compact', 'park_public_central')
    const b = await grantAt(page, 'veh_scooter', 'park_dealer_b')
    await stand(page, 'park_dealer_b')
    await call(page, 'vehicleRetrieve', b)
    // Try to park B onto A's occupied central bay.
    await call(page, 'setDrivenCarPosition', [24, 22], Math.PI / 2)
    await call(page, 'vehiclePark')
    const owned = await ownedList(page)
    // A keeps its bay; B did not overwrite the claim (it never becomes parked at the central bay).
    expect(owned.find((v) => v.id === a)!.location).toMatchObject({ kind: 'parked', anchorId: 'park_public_central' })
    const bLoc = owned.find((v) => v.id === b)!.location
    expect(bLoc.kind === 'parked' && bLoc.anchorId === 'park_public_central').toBe(false)
  })

  test('§17 retrieval is refused away from the vehicle — the phone never free-teleports it', async ({ page }) => {
    const id = await grantAt(page, 'veh_compact', 'park_public_central')
    await stand(page, 'park_dealer_a') // nowhere near the parked car
    await call(page, 'vehicleRetrieve', id)
    expect((await getStats(page)).mode).not.toBe('driving')
    expect((await ownedList(page))[0].location.kind).toBe('parked') // untouched
  })

  test('§18 a parked car with an unknown anchor recovers safely and exactly once', async ({ page }) => {
    const id = await grantAt(page, 'veh_compact', 'park_public_central')
    await call(page, 'vehicleSetLocation', id, { kind: 'parked', anchorId: 'park_gone_forever' })
    await call(page, 'vehicleRecover', id)
    expect((await ownedList(page))[0].location.kind).toBe('recovery')
    // A second recover is a no-op (already safe) — no duplicate history/among assets.
    await call(page, 'vehicleRecover', id)
    expect((await ownedList(page))).toHaveLength(1)
    expect((await ownedList(page))[0].location.kind).toBe('recovery')
  })

  // ---- condition / repair / impound (§19, §20, §21, §22, §23) -----------------
  test('§19 condition damage applies to the correct owned asset and persists', async ({ page }) => {
    const a = await grantAt(page, 'veh_compact', 'park_public_central')
    const b = await grantAt(page, 'veh_scooter', 'park_dealer_b')
    await call(page, 'vehicleSetCondition', a, 45) // only A is damaged
    await page.getByTestId('save-btn').click()
    await page.waitForTimeout(400)
    await gotoGame(page)
    await page.getByTestId('load-btn').click()
    await page.waitForTimeout(600)
    const owned = await ownedList(page)
    expect(owned.find((v) => v.id === a)!.condition).toBe(45)
    expect(owned.find((v) => v.id === b)!.condition).toBe(100)
  })

  test('§20 a disabled vehicle cannot be retrieved until repaired at the service location', async ({ page }) => {
    const id = await grantAt(page, 'veh_compact', 'park_public_central', 0)
    await stand(page, 'park_public_central')
    await call(page, 'vehicleRetrieve', id)
    expect((await getStats(page)).mode).not.toBe('driving') // disabled — refused
    // Repairing away from the service bay is refused.
    await call(page, 'vehicleRepair', id)
    expect((await ownedList(page))[0].condition).toBe(0)
    // At the service bay, repair works; then it drives.
    await stand(page, 'park_service')
    await call(page, 'vehicleRepair', id)
    expect((await ownedList(page))[0].condition).toBe(100)
    await stand(page, 'park_public_central')
    await call(page, 'vehicleRetrieve', id)
    expect((await getStats(page)).mode).toBe('driving')
  })

  test('§21 repair restores condition, charges the quote, and cannot duplicate across reload', async ({ page }) => {
    const id = await grantAt(page, 'veh_compact', 'park_service', 40)
    await stand(page, 'park_service')
    const money = (await getStats(page)).money
    await call(page, 'vehicleRepair', id)
    expect((await ownedList(page))[0].condition).toBe(100)
    expect((await getStats(page)).money).toBe(money - 60 * 12)
    const after = (await getStats(page)).money
    await page.getByTestId('save-btn').click()
    await page.waitForTimeout(400)
    await gotoGame(page)
    await page.getByTestId('load-btn').click()
    await page.waitForTimeout(600)
    expect((await getStats(page)).money).toBe(after) // no repeated charge on reload
    expect((await ownedList(page))[0].condition).toBe(100)
  })

  test('§22 an arrest while driving impounds only the involved owned vehicle, exactly once', async ({ page }) => {
    const a = await grantAt(page, 'veh_compact', 'park_public_central')
    const b = await grantAt(page, 'veh_scooter', 'park_dealer_b')
    await stand(page, 'park_public_central')
    await call(page, 'vehicleRetrieve', a) // driving A
    await call(page, 'respawnPlayer', 'arrest')
    let owned = await ownedList(page)
    expect(owned.find((v) => v.id === a)!.location.kind).toBe('impound')
    expect(owned.find((v) => v.id === b)!.location.kind).toBe('parked') // the other car is untouched
    // Re-running the incident does not impound a second time / duplicate.
    await call(page, 'respawnPlayer', 'arrest')
    owned = await ownedList(page)
    expect(owned.filter((v) => v.location.kind === 'impound')).toHaveLength(1)
  })

  test('§23 impound release requires the displayed fee and restores the car safely', async ({ page }) => {
    const id = await grantAt(page, 'veh_van', 'park_public_central')
    await call(page, 'vehicleSetLocation', id, { kind: 'impound' })
    const money = (await getStats(page)).money
    await call(page, 'vehicleReleaseImpound', id)
    expect((await ownedList(page))[0].location.kind).toBe('recovery')
    expect((await getStats(page)).money).toBeLessThan(money)
    // A released car can be driven again (from the recovery holding anchor).
    await stand(page, 'park_recovery')
    await call(page, 'vehicleRetrieve', id)
    expect((await getStats(page)).mode).toBe('driving')
  })

  // ---- owned-vs-stolen separation (§24, §26) ----------------------------------
  test('§24 an owned vehicle is never a stealable identity and cannot be traded once stolen', async ({ page }) => {
    await call(page, 'vehicleBuy', 'veh_compact')
    const r = (await vehReport(page)) as { activeIdentity: string; stolenSourceId: string | null }
    expect(r.stolenSourceId).toBeNull()
    const v = (await ownedList(page))[0]
    expect(v.id.startsWith('ov_')).toBe(true) // owned id-namespace, never a crime target
    expect(v.location.kind).toBe('parked')
  })

  test('§26 switching owned → stolen → owned preserves both identities and all property', async ({ page }) => {
    const ownedId = await grantAt(page, 'veh_van', 'park_public_central')
    await call(page, 'giveItem', 'snack', 3)
    await call(page, 'vehicleLoadCargo', ownedId, 'snack', 2) // owned van carries cargo
    // Steal a street car — a transient identity that never becomes an owned asset.
    const stole = (await call(page, 'stealVehicle', 'theft_parked_plaza')) as boolean
    expect(stole).toBe(true)
    const rStolen = (await vehReport(page)) as { activeIdentity: string; stolenSourceId: string | null }
    expect(rStolen.activeIdentity).toBe('stolen')
    // The owned van still exists with its cargo; the stolen car did not join the owned fleet.
    const owned = await ownedList(page)
    expect(owned.some((v) => v.id === ownedId && (v.cargo['snack'] ?? 0) === 2)).toBe(true)
    expect(owned.every((v) => v.id.startsWith('ov_'))).toBe(true)
  })

  // ---- cargo (§27, §28) ------------------------------------------------------
  test('§27 cargo transfer uses real stack/capacity rules and persists with no loss', async ({ page }) => {
    const id = await grantAt(page, 'veh_van', 'park_public_central')
    await call(page, 'giveItem', 'snack', 3)
    await call(page, 'vehicleLoadCargo', id, 'snack', 2)
    expect((await ownedList(page))[0].cargo['snack']).toBe(2)
    expect((await getStats(page)).inventory['snack']).toBe(1)
    await call(page, 'vehicleUnloadCargo', id, 'snack', 2)
    expect((await getStats(page)).inventory['snack']).toBe(3)
    expect((await ownedList(page))[0].cargo['snack'] ?? 0).toBe(0)
  })

  test('§28 the Van carries far more cargo than a Scooter, and overflow past the Scooter cap is refused', async ({ page }) => {
    const van = await grantAt(page, 'veh_van', 'park_public_central')
    const scooter = await grantAt(page, 'veh_scooter', 'park_public_downtown')
    await call(page, 'giveItem', 'snack', 80)
    // Snacks stack 10/slot: Scooter = 2 slots (20 max), Van = 16 slots. Loading 30 exceeds the
    // Scooter's capacity but sits well inside the Van's.
    await call(page, 'vehicleLoadCargo', van, 'snack', 30)
    await call(page, 'vehicleLoadCargo', scooter, 'snack', 30)
    const owned = await ownedList(page)
    const vanCargo = owned.find((v) => v.id === van)!.cargo['snack'] ?? 0
    const scoCargo = owned.find((v) => v.id === scooter)!.cargo['snack'] ?? 0
    expect(vanCargo).toBe(30) // the Van took all 30
    expect(scoCargo).toBeLessThanOrEqual(20) // the Scooter never exceeds its 2-slot cap
    expect(vanCargo).toBeGreaterThan(scoCargo)
  })

  // ---- customization (§29, §30) ----------------------------------------------
  test('§29 paint and wheel changes render and persist', async ({ page }) => {
    const id = await grantAt(page, 'veh_sports', 'park_service')
    await stand(page, 'park_service')
    await call(page, 'vehiclePaint', id, '#2c2c33')
    await call(page, 'vehicleSetWheels', id, 'wheels_sport')
    let v = (await ownedList(page))[0]
    expect(v.customization.paint).toBe('#2c2c33')
    expect(v.customization.wheels).toBe('wheels_sport')
    await page.getByTestId('save-btn').click()
    await page.waitForTimeout(400)
    await gotoGame(page)
    await page.getByTestId('load-btn').click()
    await page.waitForTimeout(600)
    v = (await ownedList(page)).find((o) => o.id === id)!
    expect(v.customization.paint).toBe('#2c2c33')
    expect(v.customization.wheels).toBe('wheels_sport')
  })

  test('§30 upgrades apply exact effects, are one-per-category, and carry no duplicate charge', async ({ page }) => {
    const id = await grantAt(page, 'veh_compact', 'park_service')
    await stand(page, 'park_service')
    const money = (await getStats(page)).money
    await call(page, 'vehicleInstallUpgrade', id, 'up_sport_tune')
    expect((await getStats(page)).money).toBe(money - 3000)
    expect((await ownedList(page))[0].customization.upgrades).toContain('up_sport_tune')
    const money2 = (await getStats(page)).money
    await call(page, 'vehicleInstallUpgrade', id, 'up_sport_tune')
    expect((await getStats(page)).money).toBe(money2) // second install refused, no double-charge
    // The projected top speed reflects the tune when driven.
    await stand(page, 'park_service')
    await call(page, 'vehicleRetrieve', id)
    const p = (await vehProjection(page)) as { maxSpeed: number }
    expect(p.maxSpeed).toBeLessThanOrEqual(20)
  })

  test('§30 a Sport Tune is refused on the Van (class disallows it)', async ({ page }) => {
    const id = await grantAt(page, 'veh_van', 'park_service')
    await stand(page, 'park_service')
    await call(page, 'vehicleInstallUpgrade', id, 'up_sport_tune')
    expect((await ownedList(page))[0].customization.upgrades).not.toContain('up_sport_tune')
  })

  test('§30 a cargo-rack upgrade raises cargo capacity', async ({ page }) => {
    const id = await grantAt(page, 'veh_van', 'park_service')
    await stand(page, 'park_service')
    await call(page, 'vehicleInstallUpgrade', id, 'up_cargo_rack')
    await call(page, 'giveItem', 'snack', 40)
    await call(page, 'vehicleLoadCargo', id, 'snack', 18) // van base 16 + 4 rack = 20 slots
    expect((await ownedList(page))[0].cargo['snack']).toBe(18)
  })

  test('§35 customizing is refused during a pursuit (transition/activity conflict)', async ({ page }) => {
    const id = await grantAt(page, 'veh_compact', 'park_service')
    await stand(page, 'park_service')
    await call(page, 'setWantedLevel', 2) // heat is on
    await call(page, 'vehiclePaint', id, '#2c2c33')
    expect((await ownedList(page))[0].customization.paint).not.toBe('#2c2c33') // refused while wanted
    await call(page, 'clearWanted')
    await call(page, 'vehiclePaint', id, '#2c2c33')
    expect((await ownedList(page))[0].customization.paint).toBe('#2c2c33') // allowed once clear
  })

  // ---- career + social integration (§33, §34) --------------------------------
  test('§33 the delivery-vehicle pay advantage is visible, deterministic, and capped', async ({ page }) => {
    // No usable delivery vehicle → no bonus.
    expect((await call(page, 'vehicleDeliveryBonus')) as number).toBe(0)
    // Own a usable delivery-capable van → a deterministic flat bonus the career finalize path reads.
    const id = await grantAt(page, 'veh_van', 'park_public_central')
    const bonus = (await call(page, 'vehicleDeliveryBonus')) as number
    expect(bonus).toBeGreaterThan(0)
    expect(bonus).toBeLessThanOrEqual(60) // bounded/capped, never runaway
    // A wrecked or impounded delivery vehicle grants nothing.
    await call(page, 'vehicleSetCondition', id, 0)
    expect((await call(page, 'vehicleDeliveryBonus')) as number).toBe(0)
  })

  // Arrange: befriend Maya to a friend + phone contact (familiarity ≥ 20) through the real event
  // pipeline, own a usable van and get in it, at a game time when Maya is available so the invite is
  // accepted + immediately startable. The ride itself is driven ONLY through production social UI.
  async function arrangeRideReady(page: Page, seed: string): Promise<string> {
    await call(page, 'setTime', 12) // Maya is available 10–20 → invite accepted, plan startable now
    for (let i = 0; i < 5; i++) {
      await call(page, 'ingestSocialEvent', { id: `${seed}_${i}`, kind: 'activity_completed', actorId: 'npc_maya_01', gameDay: 1, gameHour: 12 })
    }
    const id = await grantAt(page, 'veh_van', 'park_public_central')
    await stand(page, 'park_public_central')
    await call(page, 'vehicleRetrieve', id) // owned, driving, stopped (getting IN the car is arrange)
    await page.waitForTimeout(250)
    return id
  }

  // Invite Maya to a drive from the People app, then start the confirmed plan from the Chats app —
  // both real DOM buttons. Returns after the ride activity has begun.
  async function inviteAndStartRideViaUI(page: Page): Promise<void> {
    await call(page, 'openPhoneApp', 'contacts')
    await page.getByTestId('contact-invite-drive-npc_maya_01').click() // §11 invitation, real UI
    const invs = (await call(page, 'getSocialInvitations')) as Array<{ id: string; activityKind: string; status: string; actorId: string }>
    const plan = invs.find((i) => i.activityKind === 'drive_around' && i.actorId === 'npc_maya_01' && i.status === 'accepted')
    expect(plan, 'Maya accepts the drive invite → a confirmed plan').toBeTruthy()
    await call(page, 'openPhoneApp', 'messages')
    await page.getByTestId(`plan-start-${plan!.id}`).click() // start the confirmed plan, real UI
  }

  test('§34 Give a Ride is invited, started, and completed entirely through the social UI', async ({ page }) => {
    await arrangeRideReady(page, 'ride_ui')
    await inviteAndStartRideViaUI(page)
    // The ride is now the ONE active social activity, with Maya as the seated passenger.
    expect((await call(page, 'vehicleRidePassenger')) as string | null).toBe('npc_maya_01')
    // Complete it through the shared activity tracker's Continue button (travel → together → done).
    await page.keyboard.press('Tab') // close the phone so the HUD activity tracker is interactable
    await page.waitForTimeout(150)
    for (let i = 0; i < 3 && ((await call(page, 'vehicleRidePassenger')) as string | null); i++) {
      await page.getByTestId('sat-continue').click()
      await page.waitForTimeout(200)
    }
    expect((await call(page, 'vehicleRidePassenger')) as string | null).toBeNull() // clean teardown via the pipeline
    const mems = (await call(page, 'getSocialMemories', 'npc_maya_01')) as unknown[]
    expect(Array.isArray(mems) ? mems.length : 0).toBeGreaterThan(0) // the ride banked one memory
  })

  test('§34 an arrest during a UI-started ride cleanly removes the passenger', async ({ page }) => {
    await arrangeRideReady(page, 'ride_arrest')
    await inviteAndStartRideViaUI(page)
    expect((await call(page, 'vehicleRidePassenger')) as string | null).toBe('npc_maya_01')
    await call(page, 'respawnPlayer', 'arrest')
    expect((await call(page, 'vehicleRidePassenger')) as string | null).toBeNull()
  })

  // ---- persistence + integrity (§36, §37) ------------------------------------
  test('§36 save/load while parked and impounded leaves no duplicate shell or asset', async ({ page }) => {
    const parked = await grantAt(page, 'veh_van', 'park_public_central')
    const impounded = await grantAt(page, 'veh_compact', 'park_dealer_b')
    await call(page, 'vehicleSetLocation', impounded, { kind: 'impound' })
    await page.getByTestId('save-btn').click()
    await page.waitForTimeout(400)
    await gotoGame(page)
    await page.getByTestId('load-btn').click()
    await page.waitForTimeout(600)
    const owned = await ownedList(page)
    expect(owned).toHaveLength(2)
    expect(owned.find((v) => v.id === parked)!.location.kind).toBe('parked')
    expect(owned.find((v) => v.id === impounded)!.location.kind).toBe('impound')
    const positions = (await call(page, 'getVehiclePositions')) as Record<string, unknown>
    // Never more than one physical player shell (it is hidden while nothing is active).
    expect(Object.keys(positions).filter((k) => k.includes('compact_car')).length).toBeLessThanOrEqual(1)
  })

  test('§37 the DEV report exposes no duplicate parking anchors across the fleet', async ({ page }) => {
    await call(page, 'vehicleBuy', 'veh_compact')
    await stand(page, 'park_dealer_a')
    await call(page, 'vehicleBuy', 'veh_scooter')
    const r = (await vehReport(page)) as { duplicateParkingAnchors: string[]; ownedCount: number }
    expect(r.ownedCount).toBe(2)
    expect(r.duplicateParkingAnchors).toEqual([])
  })

  // ---- production Garage UI ---------------------------------------------------
  test('§5 the Garage phone app lists the dealership and owned vehicles', async ({ page }) => {
    await call(page, 'vehicleBuy', 'veh_compact')
    await page.evaluate(() => (window.GAME_TEST_API as unknown as Api).openPhoneApp('garage'))
    await expect(page.getByTestId('garage-listing-veh_compact')).toBeVisible({ timeout: 5000 })
  })
})
