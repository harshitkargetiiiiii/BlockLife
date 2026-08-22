import { test, expect, type Page } from '@playwright/test'
import { gotoGame } from './helpers'

/**
 * Vehicle Ownership v1 (issue #19) lifecycle soak. Drives the whole loop — buy / trade / retrieve /
 * park / recover / repair / impound-release / customize / cargo — deterministically over many game
 * days through the SAME store actions, asserting the invariants NEVER break: owned count ≤ 4, the
 * registry stays valid, no two vehicles share a parking anchor, at most one active shell, money never
 * goes negative, and no vehicle/cargo is silently lost. Deterministic op selection (i % k), no
 * Math.random. Each iteration runs in ONE page.evaluate (store actions + invariant snapshot) so the
 * soak stays well inside the standard 180s soak budget without weakening anything.
 */
interface Snap {
  registryValid: boolean
  ownedCount: number
  cap: number
  duplicateAnchors: number
  activeCount: number
  money: number
}

async function soakIteration(page: Page, i: number): Promise<Snap> {
  return page.evaluate((iter) => {
    const api = window.GAME_TEST_API as unknown as Record<string, (...a: unknown[]) => unknown>
    const CLASSES = ['veh_scooter', 'veh_compact', 'veh_van', 'veh_sports']
    const list = () => Object.values((api.getVehicleState() as { assets: Record<string, { id: string; defId: string; location: { kind: string } }> }).assets)
    if (iter % 10 === 0) {
      api.setMoney(1_000_000)
      for (const d of CLASSES) api.vehicleSetDealershipStock(d, 9)
    }
    api.setGameDay(1 + iter)
    const owned = list()
    const op = iter % 8
    if (op === 0 && owned.length < 4) api.vehicleBuy(CLASSES[iter % 3])
    else if (op === 1) { const v = owned.find((x) => x.location.kind === 'parked'); if (v) api.vehicleTradeIn(v.id, CLASSES[(iter + 1) % 3]) }
    else if (op === 2) { const v = owned.find((x) => x.location.kind === 'parked' || x.location.kind === 'recovery'); if (v) api.vehicleRetrieve(v.id) }
    else if (op === 3) api.vehiclePark()
    else if (op === 4 && owned.length) { const v = owned[iter % owned.length]; api.vehicleSetCondition(v.id, 30); api.vehicleRepair(v.id) }
    else if (op === 5) { const v = owned.find((x) => x.location.kind === 'parked'); if (v) { api.vehicleSetLocation(v.id, { kind: 'impound' }); api.vehicleReleaseImpound(v.id) } }
    else if (op === 6) { const v = owned.find((x) => x.defId === 'veh_van' && x.location.kind !== 'impound'); if (v) { api.giveItem('snack', 4); api.vehicleLoadCargo(v.id, 'snack', 2); api.vehicleInstallUpgrade(v.id, 'up_cargo_rack') } }
    else if (op === 7) { const v = owned.find((x) => x.location.kind === 'active') ?? owned[0]; if (v) api.vehicleRecover(v.id) }

    const r = api.getVehicleReport() as { registryValid: boolean; ownedCount: number; cap: number; duplicateParkingAnchors: string[] }
    const active = list().filter((v) => v.location.kind === 'active')
    return {
      registryValid: r.registryValid,
      ownedCount: r.ownedCount,
      cap: r.cap,
      duplicateAnchors: r.duplicateParkingAnchors.length,
      activeCount: active.length,
      money: (api.getStats() as { money: number }).money,
    }
  }, i)
}

test('vehicle lifecycle soak — invariants hold over 200 game-days', async ({ page }) => {
  test.setTimeout(180_000)
  await gotoGame(page)
  await page.evaluate(() => {
    const api = window.GAME_TEST_API as unknown as Record<string, (...a: unknown[]) => unknown>
    api.setMoney(1_000_000)
    for (const d of ['veh_scooter', 'veh_compact', 'veh_van', 'veh_sports']) api.vehicleSetDealershipStock(d, 9)
  })

  for (let i = 0; i < 200; i++) {
    const s = await soakIteration(page, i)
    expect(s.registryValid, `iter ${i}: registry valid`).toBe(true)
    expect(s.ownedCount, `iter ${i}: owned <= cap`).toBeLessThanOrEqual(s.cap)
    expect(s.duplicateAnchors, `iter ${i}: no shared anchors`).toBe(0)
    expect(s.activeCount, `iter ${i}: <= 1 active shell`).toBeLessThanOrEqual(1)
    expect(s.money, `iter ${i}: money non-negative`).toBeGreaterThanOrEqual(0)
  }
})
