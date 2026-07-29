import { beforeEach, describe, expect, it } from 'vitest'
import {
  commitMove,
  getLease,
  getOwnedAssets,
  housingRuntime,
  mintFurnitureAsset,
  reconcileHousingRent,
  resetHousing,
  tourProperty,
} from './housingRuntime'
import { applyHousingSave, sanitizeHousingSave, serializeHousing } from './housingPersistence'
import type { HousingSaveData } from './housingTypes'

describe('housing persistence + migration', () => {
  beforeEach(() => resetHousing(0))

  it('round-trips lease, assets, placements, and history without change', () => {
    const a = mintFurnitureAsset('sofa')
    mintFurnitureAsset('bed_double')
    tourProperty('city_loft')
    commitMove('city_loft', 10)
    housingRuntime.state.placements = { lf_sofa: a.assetId }
    reconcileHousingRent(20, 5000) // some rent history

    const saved = serializeHousing()
    resetHousing(0)
    applyHousingSave(saved, 20)

    expect(housingRuntime.state.currentPropertyId).toBe('city_loft')
    expect(getLease().depositHeld).toBe(600)
    expect(getOwnedAssets()).toHaveLength(2)
    expect(housingRuntime.state.placements).toEqual({ lf_sofa: a.assetId })
    expect(housingRuntime.state.assetSeq).toBe(2)
  })

  it('migrates an old apartment save (no housing field) into a Starter Studio with grace', () => {
    applyHousingSave(undefined, 20)
    expect(housingRuntime.state.currentPropertyId).toBe('starter_studio')
    expect(getLease().status).toBe('active')
    expect(getLease().nextDueDay).toBe(27) // one full period out — no immediate charge
    expect(getLease().debt).toBe(0)
    expect(housingRuntime.state.payments).toHaveLength(0)
  })

  it('falls back to the starter for an unknown current property and clamps bad numbers', () => {
    const bad = {
      version: 1,
      currentPropertyId: 'mansion',
      lease: { propertyId: 'mansion', startDay: -5, nextDueDay: 'x', periodSeq: -3, depositHeld: -9, debt: 'nope', status: 'weird', lateFeePeriod: -1 },
    } as unknown as HousingSaveData
    const s = sanitizeHousingSave(bad, 3)
    expect(s.currentPropertyId).toBe('starter_studio')
    expect(s.lease.propertyId).toBe('starter_studio')
    expect(s.lease.startDay).toBe(0)
    expect(s.lease.debt).toBe(0)
    expect(s.lease.status).toBe('active')
  })

  it('drops assets with unknown furniture defs and recovers invalid placements', () => {
    const raw = {
      version: 1,
      currentPropertyId: 'premium_apartment',
      lease: { propertyId: 'premium_apartment', startDay: 0, nextDueDay: 7, periodSeq: 0, depositHeld: 1500, debt: 0, status: 'active', lateFeePeriod: null },
      assets: {
        fa_1: { assetId: 'fa_1', defId: 'potted_plant', rotationY: 0 }, // decor small
        fa_2: { assetId: 'fa_2', defId: 'ghost_chair', rotationY: 0 }, // unknown def → dropped
      },
      // fa_1 claimed by TWO valid decor slots (dedup), a bogus slot, and an
      // incompatible entertainment slot (recover) — only one placement survives.
      placements: { pr_decor_a: 'fa_1', pr_decor_b: 'fa_1', bogus_slot: 'fa_1', pr_ent: 'fa_1' },
      assetSeq: 0,
    } as unknown as HousingSaveData
    const s = sanitizeHousingSave(raw, 0)
    expect(Object.keys(s.assets)).toEqual(['fa_1']) // unknown def dropped, none deleted otherwise
    const placedSlots = Object.entries(s.placements).filter(([, aid]) => aid === 'fa_1')
    expect(placedSlots).toHaveLength(1)
    expect(['pr_decor_a', 'pr_decor_b']).toContain(placedSlots[0][0])
    expect(s.placements['bogus_slot']).toBeUndefined()
    expect(s.placements['pr_ent']).toBeUndefined() // incompatible category → recovered to storage
  })

  it('keeps assetSeq ahead of the highest loaded asset id (reload-safe)', () => {
    const raw = {
      version: 1,
      currentPropertyId: 'starter_studio',
      lease: { propertyId: 'starter_studio', startDay: 0, nextDueDay: 7, periodSeq: 0, depositHeld: 0, debt: 0, status: 'active', lateFeePeriod: null },
      assets: { fa_9: { assetId: 'fa_9', defId: 'sofa', rotationY: 0 } },
      assetSeq: 2, // stale/behind
    } as unknown as HousingSaveData
    const s = sanitizeHousingSave(raw, 0)
    expect(s.assetSeq).toBe(9)
    // A fresh mint after load can't collide.
    applyHousingSave(raw, 0)
    const next = mintFurnitureAsset('sofa')
    expect(next.assetId).toBe('fa_10')
  })

  it('preserves the exact-once key ledger so a reload cannot re-charge rent', () => {
    reconcileHousingRent(7, 500) // pays one period → key recorded
    const keysBefore = [...housingRuntime.state.appliedTxnKeys]
    expect(keysBefore.length).toBeGreaterThan(0)
    const saved = serializeHousing()
    resetHousing(0)
    applyHousingSave(saved, 7)
    expect(housingRuntime.state.appliedTxnKeys).toEqual(keysBefore)
    // Reconciling the same period again after reload charges nothing.
    expect(reconcileHousingRent(7, 500).moneyDelta).toBe(0)
  })
})
