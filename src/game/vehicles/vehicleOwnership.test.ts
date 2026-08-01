import { beforeEach, describe, expect, it } from 'vitest'
import {
  atOwnedCap,
  getActiveVehicle,
  getVehicleAtAnchor,
  isAnchorOccupied,
  markVehicleTxn,
  mintOwnedVehicle,
  ownedCount,
  removeOwnedVehicle,
  resetVehicleOwnership,
  setVehicleCondition,
  setVehicleLocation,
  vehicleOwnershipRuntime,
} from './vehicleOwnershipRuntime'
import {
  applyVehicleOwnershipSave,
  sanitizeVehicleOwnershipSave,
  serializeVehicleOwnership,
} from './vehicleOwnershipPersistence'
import { recordTheft, resetVehicleCrimeRuntime } from './vehicleCrimeState'
import { VEHICLE_OWNED_CAP } from './vehicleOwnershipTypes'

const buy = (defId: string, i = 0) =>
  mintOwnedVehicle(defId, { acquiredVia: 'purchase', receipt: `r${i}`, day: 1, price: 1000, location: { kind: 'parked', anchorId: `park_${i}` } })

describe('vehicle ownership runtime (issue #19 §2)', () => {
  beforeEach(() => {
    resetVehicleOwnership()
    resetVehicleCrimeRuntime()
  })

  it('mints unique monotonic ids and enforces the owned cap', () => {
    const a = buy('veh_scooter', 0)
    const b = buy('veh_compact', 1)
    expect(a.id).toBe('ov_1')
    expect(b.id).toBe('ov_2')
    expect(ownedCount()).toBe(2)
    for (let i = 2; i < VEHICLE_OWNED_CAP; i++) buy('veh_scooter', i)
    expect(atOwnedCap()).toBe(true)
  })

  it('one vehicle per anchor + one active at a time', () => {
    const a = buy('veh_compact', 0)
    const b = buy('veh_van', 1)
    expect(getVehicleAtAnchor('park_0')?.id).toBe(a.id)
    expect(isAnchorOccupied('park_0')).toBe(true)
    expect(isAnchorOccupied('park_0', a.id)).toBe(false) // itself doesn't count
    setVehicleLocation(a.id, { kind: 'active' })
    setVehicleLocation(b.id, { kind: 'active' })
    // Activating b deactivated a (dropped to recovery); only one active.
    expect(getActiveVehicle()?.id).toBe(b.id)
    expect(getOwnedActiveCount()).toBe(1)
  })

  function getOwnedActiveCount(): number {
    return Object.values(vehicleOwnershipRuntime.state.assets).filter((v) => v.location.kind === 'active').length
  }

  it('a duplicate transaction key is a true no-op (exact-once — §4)', () => {
    expect(markVehicleTxn('purchase:x')).toBe(true)
    expect(markVehicleTxn('purchase:x')).toBe(false)
  })

  it('condition clamps 0..100 and derives disabled', () => {
    const a = buy('veh_compact', 0)
    expect(setVehicleCondition(a.id, -5)).toBe(true) // disabled
    expect(a.condition).toBe(0)
    setVehicleCondition(a.id, 250)
    expect(a.condition).toBe(100)
  })

  it('STEALING never mints a legitimate owned asset (§2 legit-vs-stolen boundary)', () => {
    buy('veh_compact', 0)
    const before = ownedCount()
    recordTheft('theft_parked_plaza') // projects onto the shell, NOT the ownership runtime
    expect(ownedCount()).toBe(before) // no new owned asset
    // The owned car is untouched and still recoverable.
    expect(getVehicleAtAnchor('park_0')).toBeTruthy()
  })

  it('trade-in removal clears active + returns the asset for audit', () => {
    const a = buy('veh_compact', 0)
    setVehicleLocation(a.id, { kind: 'active' })
    const removed = removeOwnedVehicle(a.id)
    expect(removed?.id).toBe(a.id)
    expect(getActiveVehicle()).toBeUndefined()
    expect(ownedCount()).toBe(0)
  })
})

describe('vehicle ownership persistence + migration (§3/§13)', () => {
  beforeEach(() => {
    resetVehicleOwnership()
    resetVehicleCrimeRuntime()
  })

  it('a new game / reset starts with NO owned vehicle', () => {
    applyVehicleOwnershipSave(undefined, { legacySave: false, loadDay: 0 })
    expect(ownedCount()).toBe(0)
    expect(vehicleOwnershipRuntime.state.migrated).toBe(false)
  })

  it('a legacy save grants EXACTLY ONE Compact, exact-once across reloads (§3)', () => {
    applyVehicleOwnershipSave(undefined, { legacySave: true, loadDay: 5, parkAnchorId: 'park_home' })
    expect(ownedCount()).toBe(1)
    const v = Object.values(vehicleOwnershipRuntime.state.assets)[0]
    expect(v.defId).toBe('veh_compact')
    expect(v.acquiredVia).toBe('migration')
    expect(v.location).toEqual({ kind: 'parked', anchorId: 'park_home' })
    expect(vehicleOwnershipRuntime.state.migrated).toBe(true)
    // Reloading the now-migrated save re-applies the SAVED slice (migrated=true) — no 2nd grant.
    const saved = serializeVehicleOwnership()
    applyVehicleOwnershipSave(saved, { legacySave: false, loadDay: 6 })
    expect(ownedCount()).toBe(1)
  })

  it('never legitimizes an ACTIVE STOLEN identity on legacy migration (§3)', () => {
    applyVehicleOwnershipSave(undefined, { legacySave: true, loadDay: 5, stolenActive: true })
    expect(ownedCount()).toBe(0)
    expect(vehicleOwnershipRuntime.state.migrated).toBe(false)
  })

  it('round-trips an owned fleet with no duplication', () => {
    const a = mintOwnedVehicle('veh_van', { acquiredVia: 'purchase', receipt: 'r1', day: 2, price: 6800, location: { kind: 'parked', anchorId: 'park_a' } })
    setVehicleCondition(a.id, 70)
    const saved = serializeVehicleOwnership()
    resetVehicleOwnership()
    applyVehicleOwnershipSave(saved, { legacySave: false, loadDay: 3 })
    expect(ownedCount()).toBe(1)
    const v = Object.values(vehicleOwnershipRuntime.state.assets)[0]
    expect(v.defId).toBe('veh_van')
    expect(v.condition).toBe(70)
  })

  it('malformed load: dup parking → recovery, unknown def dropped, assetSeq stays ahead', () => {
    const state = sanitizeVehicleOwnershipSave({
      version: 1,
      assets: {
        ov_5: { defId: 'veh_compact', location: { kind: 'parked', anchorId: 'shared' }, condition: 90 },
        ov_6: { defId: 'veh_compact', location: { kind: 'parked', anchorId: 'shared' }, condition: 80 }, // dup anchor
        ov_7: { defId: 'not_a_car', location: { kind: 'parked', anchorId: 'x' } }, // unknown → recovered as compact (kept)
      },
      assetSeq: 2, // stale — must be pulled up past ov_7
      activeAssetId: 'ov_missing',
      migrated: true,
      appliedTxnKeys: [],
    })
    // ov_5 keeps the shared anchor; ov_6 recovered off it; both survive (no deletion).
    const anchored = Object.values(state.assets).filter((v) => v.location.kind === 'parked' && v.location.anchorId === 'shared')
    expect(anchored).toHaveLength(1)
    expect(state.assetSeq).toBeGreaterThanOrEqual(7)
    expect(state.activeAssetId).toBeNull() // unknown active id cleared
    // Unknown def id recovered to a valid car (no silent loss of the asset).
    expect(Object.keys(state.assets).length).toBe(3)
  })

  it('over-capacity malformed cargo preserves every item in bounded overflow (no loss — §8)', () => {
    const state = sanitizeVehicleOwnershipSave({
      version: 1,
      assets: {
        ov_1: { defId: 'veh_scooter', location: { kind: 'recovery' }, cargo: { snack: 99 } }, // scooter cap tiny
      },
      assetSeq: 1, activeAssetId: null, migrated: false, appliedTxnKeys: [],
    })
    const v = state.assets.ov_1
    const total = (v.cargo.snack ?? 0) + (v.cargoOverflow.snack ?? 0)
    expect(total).toBe(99) // nothing lost — split across cargo + overflow
  })
})
