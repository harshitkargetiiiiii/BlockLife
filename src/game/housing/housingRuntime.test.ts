import { beforeEach, describe, expect, it } from 'vitest'
import {
  commitMove,
  discoverProperty,
  getCurrentPropertyId,
  getLease,
  getOwnedAssets,
  getStoredAssetIds,
  housingRuntime,
  isDiscovered,
  isToured,
  mintFurnitureAsset,
  planMove,
  reconcileHousingRent,
  resetHousing,
  settleHousingDebt,
  tourProperty,
} from './housingRuntime'

const OK_GATES = { eligible: true, toured: true, tourRequired: true, storageOk: true, activityOk: true }

describe('housing runtime', () => {
  beforeEach(() => resetHousing(0))

  it('resets to a canonical Starter Studio lease', () => {
    const s = housingRuntime.state
    expect(s.currentPropertyId).toBe('starter_studio')
    expect(getLease().status).toBe('active')
    expect(getLease().depositHeld).toBe(0)
    expect(s.discovered).toEqual(['starter_studio'])
    expect(s.toured).toEqual(['starter_studio'])
    expect(getOwnedAssets()).toHaveLength(0)
    expect(s.assetSeq).toBe(0)
  })

  it('discovers and tours properties without touching money/assets', () => {
    discoverProperty('city_loft')
    expect(isDiscovered('city_loft')).toBe(true)
    expect(isToured('city_loft')).toBe(false)
    tourProperty('city_loft')
    expect(isToured('city_loft')).toBe(true)
    expect(getOwnedAssets()).toHaveLength(0)
  })

  it('mints unique reload-safe furniture assets that start stored', () => {
    const a = mintFurnitureAsset('sofa')
    const b = mintFurnitureAsset('sofa')
    expect(a.assetId).toBe('fa_1')
    expect(b.assetId).toBe('fa_2')
    expect(a.assetId).not.toBe(b.assetId)
    expect(getStoredAssetIds().sort()).toEqual(['fa_1', 'fa_2'])
    expect(housingRuntime.state.assetSeq).toBe(2)
  })

  it('applies rent reconcile + manual settlement through the runtime', () => {
    // Jump to the due day with funds → one auto-payment.
    const paid = reconcileHousingRent(7, 500)
    expect(paid.moneyDelta).toBe(-120)
    expect(getLease().nextDueDay).toBe(14)
    // Same day again → idempotent (no second charge).
    expect(reconcileHousingRent(7, 380).moneyDelta).toBe(0)

    // Fall behind: broke at the next due day → overdue debt.
    resetHousing(0)
    const overdue = reconcileHousingRent(12, 0)
    expect(overdue.moneyDelta).toBe(0)
    expect(getLease().debt).toBeGreaterThan(0)
    const settle = settleHousingDebt(12, 1000)
    expect(settle.moneyDelta).toBeLessThan(0)
    expect(getLease().debt).toBe(0)
    expect(getLease().status).toBe('active')
  })

  it('plans a move atomically and refuses unsafe transitions', () => {
    tourProperty('city_loft')
    // Sufficient funds: refund 0 − deposit 600 − initial rent 260 = −860.
    const ok = planMove('city_loft', 2000, OK_GATES)
    expect(ok.ok).toBe(true)
    expect(ok.moneyDelta).toBe(-860)

    expect(planMove('city_loft', 100, OK_GATES).reason).toBe('insufficient_funds')
    expect(planMove('city_loft', 2000, { ...OK_GATES, eligible: false }).reason).toBe('ineligible')
    expect(planMove('city_loft', 2000, { ...OK_GATES, toured: false }).reason).toBe('not_toured')
    expect(planMove('city_loft', 2000, { ...OK_GATES, storageOk: false }).reason).toBe('storage_overflow')
    expect(planMove('city_loft', 2000, { ...OK_GATES, activityOk: false }).reason).toBe('incompatible_activity')
    expect(planMove('starter_studio', 2000, OK_GATES).reason).toBe('already_here')
  })

  it('commits a move: new lease, history, preserved furniture, cleared placements', () => {
    const asset = mintFurnitureAsset('sofa')
    mintFurnitureAsset('dresser')
    // Simulate a placed piece in the studio (an accent slot).
    housingRuntime.state.placements = { ss_accent_b: asset.assetId }
    tourProperty('city_loft')

    const res = commitMove('city_loft', 30)
    expect(res.moneyDelta).toBe(-860)
    expect(getCurrentPropertyId()).toBe('city_loft')
    expect(getLease().propertyId).toBe('city_loft')
    expect(getLease().depositHeld).toBe(600)
    expect(getLease().nextDueDay).toBe(37)
    // Furniture is preserved but packed (placements cleared, assets kept).
    expect(getOwnedAssets()).toHaveLength(2)
    expect(housingRuntime.state.placements).toEqual({})
    expect(getStoredAssetIds()).toHaveLength(2)
    // History closes the studio and opens the loft.
    const studioRec = housingRuntime.state.history.find((h) => h.propertyId === 'starter_studio')
    expect(studioRec?.movedOutDay).toBe(30)
    expect(housingRuntime.state.history.some((h) => h.propertyId === 'city_loft' && h.movedOutDay === null)).toBe(true)
    // Deposit refund/charge + initial rent are recorded exactly once.
    const kinds = housingRuntime.state.payments.map((p) => p.kind)
    expect(kinds).toContain('deposit_charge')
    expect(kinds).toContain('initial_rent')
  })

  it('refunds the held deposit on the next move (exactly once)', () => {
    tourProperty('city_loft')
    commitMove('city_loft', 30) // now holding a 600 deposit
    expect(getLease().depositHeld).toBe(600)
    tourProperty('premium_apartment')
    const plan = planMove('premium_apartment', 5000, OK_GATES)
    // refund 600 − deposit 1500 − rent 500 = −1400.
    expect(plan.moneyDelta).toBe(-1400)
    const res = commitMove('premium_apartment', 60)
    expect(res.moneyDelta).toBe(-1400)
    const refunds = housingRuntime.state.payments.filter((p) => p.kind === 'deposit_refund')
    expect(refunds).toHaveLength(1)
    expect(refunds[0].amount).toBe(600)
  })
})
