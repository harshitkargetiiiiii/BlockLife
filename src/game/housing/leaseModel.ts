/**
 * Lease + rent lifecycle (issue #17 §2/§3) — PURE, deterministic, game-time only.
 * No I/O, no runtime handles, no money mutation: every function takes the current
 * lease + balance + an exact-once key predicate and returns a NEW lease plus the
 * transactions to apply. The runtime funnels the money through the economy
 * authority and records the keys. Reconcile is idempotent — a reload that re-runs
 * it produces no new charges because the period keys are already applied.
 *
 * Invariants enforced here:
 *  - at most ONE unresolved period at a time: debt freezes the schedule (issue §3
 *    "do not generate a new rent period while an older one is unresolved").
 *  - a period's rent auto-pays exactly once at its due boundary when funds allow.
 *  - a single bounded late fee per overdue period after the grace window; never
 *    compounded (guarded by `lateFeePeriod`).
 *  - manual settlement clears the debt and RESUMES the schedule from settlement.
 */
import { RENT_GRACE_DAYS, type HousingPayment, type LeaseState, type PropertyDef } from './housingTypes'

/** A pure reconcile/settlement result. `moneyDelta` is the balance change (≤ 0). */
export interface RentOutcome {
  lease: LeaseState
  txns: HousingPayment[]
  messages: string[]
  moneyDelta: number
}

/** Bounded late fee for an overdue period (25% of rent, capped). */
export function lateFeeAmount(rent: number): number {
  return Math.min(80, Math.round(rent * 0.25))
}

/** Fresh lease state for a move-in on `startDay`. Money is settled by the runtime. */
export function createLease(propertyId: LeaseState['propertyId'], startDay: number, period: number, depositHeld: number): LeaseState {
  return {
    propertyId,
    startDay: Math.trunc(startDay),
    nextDueDay: Math.trunc(startDay) + period,
    periodSeq: 0,
    depositHeld: Math.max(0, Math.round(depositHeld)),
    debt: 0,
    status: 'active',
    lateFeePeriod: null,
  }
}

const rentKey = (propertyId: string, seq: number) => `rent:${propertyId}:${seq}`
const feeKey = (propertyId: string, seq: number) => `latefee:${propertyId}:${seq}`

/**
 * Lazily reconcile rent up to `day` (issue §3). Call on sleep/day-advance, Home
 * app open, current-home entry, and load — never per frame.
 */
export function reconcileRent(
  lease: LeaseState,
  property: PropertyDef,
  day: number,
  balance: number,
  hasKey: (key: string) => boolean,
): RentOutcome {
  const L: LeaseState = { ...lease }
  const txns: HousingPayment[] = []
  const messages: string[] = []
  let moneyDelta = 0
  const today = Math.trunc(day)
  const period = property.rentPeriodDays

  // 1. Auto-pay each due period while there is NO unresolved debt and funds allow.
  //    A period whose key is already applied (reload) advances the schedule with no
  //    re-charge; a period that can't be paid becomes THE one unresolved debt.
  let guard = 0
  while (L.debt === 0 && today >= L.nextDueDay && guard++ < 600) {
    const key = rentKey(L.propertyId, L.periodSeq)
    if (hasKey(key) || txns.some((t) => t.key === key)) {
      // Already charged in a prior reconcile — just move the schedule forward.
      L.periodSeq += 1
      L.nextDueDay += period
      continue
    }
    if (balance + moneyDelta >= property.rent) {
      moneyDelta -= property.rent
      txns.push({ key, kind: 'recurring_rent', amount: -property.rent, day: L.nextDueDay })
      L.periodSeq += 1
      L.nextDueDay += period
      L.status = 'active'
    } else {
      // Insufficient funds → create ONE outstanding period; freeze the schedule.
      L.debt += property.rent
      L.status = 'overdue'
      messages.push(`Rent of $${property.rent} for the ${property.displayName} is overdue.`)
      break
    }
  }

  // 2. One bounded late fee once the grace window lapses on the unresolved period.
  if (L.debt > 0 && today > L.nextDueDay + RENT_GRACE_DAYS && L.lateFeePeriod !== L.periodSeq) {
    const fk = feeKey(L.propertyId, L.periodSeq)
    if (!hasKey(fk) && !txns.some((t) => t.key === fk)) {
      const fee = lateFeeAmount(property.rent)
      L.debt += fee
      L.lateFeePeriod = L.periodSeq
      L.status = 'delinquent'
      txns.push({ key: fk, kind: 'late_fee', amount: -fee, day: today })
      messages.push(`A $${fee} late fee was added — your ${property.displayName} lease is delinquent.`)
    } else {
      L.status = 'delinquent'
    }
  }

  // 3. Derive the resting status from debt.
  if (L.debt === 0) L.status = 'active'
  else if (L.status !== 'delinquent') L.status = L.lateFeePeriod === L.periodSeq ? 'delinquent' : 'overdue'

  return { lease: L, txns, messages, moneyDelta }
}

/**
 * Manually settle outstanding debt from the Home app (issue §3). Pays the full
 * debt when funds allow; a partial payment reduces it. Clearing the debt resumes
 * the schedule from the settlement day. Exact-once via a settlement key; a reopen/
 * reload can't re-charge because the debt is already reduced + persisted.
 */
export function settleDebt(
  lease: LeaseState,
  property: PropertyDef,
  day: number,
  balance: number,
  settleSeq: number,
  hasKey: (key: string) => boolean,
): RentOutcome {
  const L: LeaseState = { ...lease }
  const txns: HousingPayment[] = []
  const messages: string[] = []
  let moneyDelta = 0
  const today = Math.trunc(day)
  if (L.debt <= 0 || balance <= 0) return { lease: L, txns, messages, moneyDelta }

  const pay = Math.min(L.debt, Math.floor(balance))
  // Keyed by a monotonic settlement id, so a partial payment followed by a same-day
  // top-up are DISTINCT settlements (both apply), while an accidental exact replay of
  // the same settlement id is a no-op in recordTxn (PR#18 review #8).
  const key = `settle:${L.propertyId}:${settleSeq}`
  if (hasKey(key)) return { lease: L, txns, messages, moneyDelta }
  moneyDelta -= pay
  L.debt -= pay
  txns.push({ key, kind: 'debt_settlement', amount: -pay, day: today })
  if (L.debt <= 0) {
    L.debt = 0
    L.lateFeePeriod = null
    L.status = 'active'
    // Resume the schedule from settlement so debt never runs away (issue §3).
    L.periodSeq += 1
    L.nextDueDay = today + property.rentPeriodDays
    messages.push(`Rent settled — you're all caught up on the ${property.displayName}.`)
  } else {
    messages.push(`Paid $${pay} toward rent. $${L.debt} still owed.`)
  }
  return { lease: L, txns, messages, moneyDelta }
}

/** A readable one-line status for UI (issue §3 "readable overdue/delinquent state"). */
export function leaseStatusLabel(lease: LeaseState): string {
  switch (lease.status) {
    case 'active':
      return 'In good standing'
    case 'rent_due':
      return 'Rent due'
    case 'overdue':
      return `Overdue — $${lease.debt} owed`
    case 'delinquent':
      return `Delinquent — $${lease.debt} owed`
    case 'ended':
      return 'Lease ended'
  }
}

/** True when delinquency should block moving up / new hosting (issue §3). */
export function isDelinquent(lease: LeaseState): boolean {
  return lease.status === 'delinquent' || lease.debt > 0
}

/** Days until (−) / since (+) the next due day, for UI. */
export function daysUntilDue(lease: LeaseState, day: number): number {
  return lease.nextDueDay - Math.trunc(day)
}
