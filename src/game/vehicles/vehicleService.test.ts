import { afterEach, describe, expect, it } from 'vitest'
import {
  REPAIR_COST_PER_POINT,
  canRecover,
  canReleaseFromImpound,
  canRepair,
  canRetrieve,
  canPark,
  conditionLossFromImpact,
  impoundFee,
  noteActiveVehicleImpact,
  repairQuote,
} from './vehicleService'
import { mintOwnedVehicle, resetVehicleOwnership, setActiveVehicle } from './vehicleOwnershipRuntime'
import { getVehicleDef } from './vehicleRegistry'

afterEach(() => resetVehicleOwnership())

function mint(defId: string, opts?: { condition?: number; location?: Parameters<typeof mintOwnedVehicle>[1]['location'] }) {
  const v = mintOwnedVehicle(defId, {
    acquiredVia: 'purchase', receipt: `r_${Math.random()}`, day: 1, price: 1000,
    location: opts?.location ?? { kind: 'parked', anchorId: 'a' },
  })
  if (opts?.condition !== undefined) v.condition = opts.condition
  return v
}

describe('vehicle lifecycle service', () => {
  it('quotes a repair as the deterministic cost to restore to 100', () => {
    const v = mint('veh_compact', { condition: 60 })
    const q = repairQuote(v)
    expect(q.points).toBe(40)
    expect(q.cost).toBe(40 * REPAIR_COST_PER_POINT)
    expect(q.toCondition).toBe(100)
  })

  it('refuses repair when nothing is damaged or funds are short', () => {
    const pristine = mint('veh_compact', { condition: 100 })
    expect(canRepair(pristine.id, 100000)).toEqual({ ok: false, reason: 'already_installed' })
    const worn = mint('veh_compact', { condition: 50 })
    expect(canRepair(worn.id, 1)).toEqual({ ok: false, reason: 'insufficient_funds' })
    expect(canRepair(worn.id, 100000).ok).toBe(true)
  })

  it('impound fee scales with class value and releases only when affordable', () => {
    const v = mint('veh_van', { location: { kind: 'impound' } })
    const fee = impoundFee(v)
    expect(fee).toBeGreaterThan(250)
    expect(fee).toBe(250 + Math.round(getVehicleDef('veh_van')!.baseTradeValue * 0.05))
    expect(canReleaseFromImpound(v.id, 1)).toEqual({ ok: false, reason: 'insufficient_funds' })
    expect(canReleaseFromImpound(v.id, 100000)).toEqual({ ok: true, fee })
  })

  it('release refused when the vehicle is not actually impounded', () => {
    const parked = mint('veh_compact')
    expect(canReleaseFromImpound(parked.id, 100000)).toEqual({ ok: false, reason: 'unavailable' })
  })

  it('impact damage is bounded (a single crash never destroys a car)', () => {
    expect(conditionLossFromImpact(5)).toBe(0) // below threshold
    expect(conditionLossFromImpact(10)).toBeGreaterThan(0)
    expect(conditionLossFromImpact(1000)).toBeLessThanOrEqual(20) // capped
  })

  it('retrieve: allowed for a parked healthy car; refused for active/impound/disabled', () => {
    const parked = mint('veh_compact', { condition: 100, location: { kind: 'parked', anchorId: 'a' } })
    expect(canRetrieve(parked.id)).toEqual({ ok: true })

    const impounded = mint('veh_compact', { location: { kind: 'impound' } })
    expect(canRetrieve(impounded.id)).toEqual({ ok: false, reason: 'unavailable' })

    const disabled = mint('veh_compact', { condition: 0, location: { kind: 'parked', anchorId: 'b' } })
    expect(canRetrieve(disabled.id)).toEqual({ ok: false, reason: 'unavailable' })

    const active = mint('veh_compact', { location: { kind: 'active' } })
    expect(canRetrieve(active.id)).toEqual({ ok: false, reason: 'busy' })
  })

  it('park: only the active (driven) asset may be parked', () => {
    const parked = mint('veh_compact', { location: { kind: 'parked', anchorId: 'a' } })
    expect(canPark(parked.id).ok).toBe(false)
    const active = mint('veh_van', { location: { kind: 'active' } })
    expect(canPark(active.id)).toEqual({ ok: true })
  })

  it('recover: a bounded emergency only — a healthy parked car cannot be summoned to holding (§5)', () => {
    const healthy = mint('veh_compact', { condition: 100, location: { kind: 'parked', anchorId: 'park_dealer_a' } })
    expect(canRecover(healthy.id)).toEqual({ ok: false, reason: 'unavailable' }) // drive it, don't recover it
    // A DISABLED car (or one at a lost/unknown anchor) is a legitimate recovery case.
    const disabled = mint('veh_compact', { condition: 0, location: { kind: 'parked', anchorId: 'park_dealer_b' } })
    expect(canRecover(disabled.id)).toEqual({ ok: true })
    const lost = mint('veh_compact', { condition: 100, location: { kind: 'parked', anchorId: 'anchor_that_was_removed' } })
    expect(canRecover(lost.id)).toEqual({ ok: true })
  })

  it('driving impacts wear the active owned vehicle but never a legacy/stolen shell', () => {
    expect(noteActiveVehicleImpact(20)).toBe(0) // no owned active vehicle → no-op
    const v = mint('veh_compact', { condition: 100, location: { kind: 'active' } })
    setActiveVehicle(v.id)
    const lost = noteActiveVehicleImpact(12)
    expect(lost).toBeGreaterThan(0)
    expect(v.condition).toBe(100 - lost)
    // A gentle bump below threshold does nothing.
    expect(noteActiveVehicleImpact(5)).toBe(0)
  })

  it('unknown asset ids are refused everywhere', () => {
    expect(canRetrieve('ov_nope')).toEqual({ ok: false, reason: 'not_owned' })
    expect(canRepair('ov_nope', 100).ok).toBe(false)
    expect(canRecover('ov_nope')).toEqual({ ok: false, reason: 'not_owned' })
  })
})
