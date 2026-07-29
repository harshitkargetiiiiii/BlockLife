import { describe, expect, it } from 'vitest'
import { createLease, isDelinquent, lateFeeAmount, reconcileRent, settleDebt } from './leaseModel'
import { getProperty } from './propertyRegistry'
import type { HousingPayment, LeaseState } from './housingTypes'

const STARTER = getProperty('starter_studio')! // rent 120, period 7

/** A tiny exact-once key ledger that mimics the runtime recording applied txns. */
function ledger() {
  const keys = new Set<string>()
  return {
    hasKey: (k: string) => keys.has(k),
    apply: (txns: HousingPayment[]) => txns.forEach((t) => keys.add(t.key)),
  }
}

describe('lease + rent model', () => {
  it('creates a lease with one full period before the first due day', () => {
    const l = createLease('starter_studio', 3, 7, 0)
    expect(l.status).toBe('active')
    expect(l.nextDueDay).toBe(10)
    expect(l.debt).toBe(0)
    expect(l.periodSeq).toBe(0)
  })

  it('auto-pays rent exactly once at the due boundary when funds exist', () => {
    const led = ledger()
    const l0 = createLease('starter_studio', 0, 7, 0) // due day 7
    const r = reconcileRent(l0, STARTER, 7, 500, led.hasKey)
    expect(r.moneyDelta).toBe(-120)
    expect(r.txns).toHaveLength(1)
    expect(r.txns[0].kind).toBe('recurring_rent')
    expect(r.lease.nextDueDay).toBe(14)
    expect(r.lease.status).toBe('active')
    led.apply(r.txns)
    // Re-running the same reconcile does NOT re-charge (idempotent / reload-safe).
    const again = reconcileRent(r.lease, STARTER, 7, 380, led.hasKey)
    expect(again.moneyDelta).toBe(0)
    expect(again.txns).toHaveLength(0)
  })

  it('creates one overdue period when funds are insufficient (no money moves)', () => {
    const l0 = createLease('starter_studio', 0, 7, 0)
    const r = reconcileRent(l0, STARTER, 7, 50, () => false)
    expect(r.moneyDelta).toBe(0)
    expect(r.lease.debt).toBe(120)
    expect(r.lease.status).toBe('overdue')
    expect(r.lease.nextDueDay).toBe(7) // schedule frozen on the unresolved period
    expect(r.messages.length).toBe(1)
  })

  it('does NOT accrue a new period while an older one is unresolved', () => {
    const l0 = createLease('starter_studio', 0, 7, 0)
    const overdue = reconcileRent(l0, STARTER, 7, 0, () => false).lease
    // Many days later, still broke: debt stays exactly one period (plus a fee), never two.
    const later = reconcileRent(overdue, STARTER, 40, 0, () => false)
    expect(later.lease.debt).toBeLessThanOrEqual(120 + lateFeeAmount(120))
    expect(later.lease.periodSeq).toBe(0)
  })

  it('adds exactly one bounded late fee after the grace window, never compounding', () => {
    const led = ledger()
    const overdue = reconcileRent(createLease('starter_studio', 0, 7, 0), STARTER, 7, 0, led.hasKey).lease
    // Within grace (day 9 = due 7 + 2): no fee yet.
    const inGrace = reconcileRent(overdue, STARTER, 9, 0, led.hasKey)
    expect(inGrace.lease.status).toBe('overdue')
    expect(inGrace.lease.debt).toBe(120)
    // Past grace (day 10): exactly one fee, delinquent.
    const past = reconcileRent(overdue, STARTER, 10, 0, led.hasKey)
    const fee = lateFeeAmount(120)
    expect(fee).toBe(30)
    expect(past.lease.debt).toBe(120 + fee)
    expect(past.lease.status).toBe('delinquent')
    expect(past.txns.filter((t) => t.kind === 'late_fee')).toHaveLength(1)
    led.apply(past.txns)
    // Re-reconcile even later: no second fee.
    const evenLater = reconcileRent(past.lease, STARTER, 30, 0, led.hasKey)
    expect(evenLater.lease.debt).toBe(120 + fee)
    expect(evenLater.txns.filter((t) => t.kind === 'late_fee')).toHaveLength(0)
  })

  it('settles debt manually, clears delinquency, and resumes the schedule', () => {
    const led = ledger()
    let l: LeaseState = reconcileRent(createLease('starter_studio', 0, 7, 0), STARTER, 12, 0, led.hasKey).lease
    // Now delinquent with rent + fee owed.
    expect(isDelinquent(l)).toBe(true)
    const owed = l.debt
    const s = settleDebt(l, STARTER, 12, 1000, led.hasKey)
    expect(s.moneyDelta).toBe(-owed)
    expect(s.lease.debt).toBe(0)
    expect(s.lease.status).toBe('active')
    expect(s.lease.nextDueDay).toBe(12 + 7) // resumed from settlement
    led.apply(s.txns)
    l = s.lease
    // Reopening/reload: settling again is a no-op (debt already 0).
    const noop = settleDebt(l, STARTER, 12, 1000, led.hasKey)
    expect(noop.moneyDelta).toBe(0)
    expect(noop.txns).toHaveLength(0)
  })

  it('supports a partial settlement that leaves a smaller debt', () => {
    const led = ledger()
    const l = reconcileRent(createLease('starter_studio', 0, 7, 0), STARTER, 12, 0, led.hasKey).lease
    const owed = l.debt
    const s = settleDebt(l, STARTER, 12, 20, led.hasKey)
    expect(s.moneyDelta).toBe(-20)
    expect(s.lease.debt).toBe(owed - 20)
    expect(s.lease.status).not.toBe('active')
  })

  it('catches up multiple elapsed periods when funds allow, each charged once', () => {
    const led = ledger()
    const l0 = createLease('starter_studio', 0, 7, 0) // due 7, then 14
    const r = reconcileRent(l0, STARTER, 15, 500, led.hasKey)
    expect(r.txns.filter((t) => t.kind === 'recurring_rent')).toHaveLength(2)
    expect(r.moneyDelta).toBe(-240)
    expect(r.lease.nextDueDay).toBe(21)
  })
})
