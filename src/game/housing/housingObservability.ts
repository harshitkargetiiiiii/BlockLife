/**
 * DEV-only housing observability (issue #17 §15). A compact, inspectable snapshot
 * of the housing runtime + registry validation for the debug panel and E2E. Pure
 * reads — no mutation. Everything here is DEV-guarded at the call site (the test
 * API + debug panel), so it never ships in production bundles.
 */
import { validateFurnitureCatalog } from './furnitureCatalog'
import { leaseStatusLabel } from './leaseModel'
import { validatePropertyRegistry } from './propertyRegistry'
import {
  getHousingState,
  getStoredAssetIds,
  ownedAssetCount,
} from './housingRuntime'
import type { LeaseStatus, PropertyId } from './housingTypes'

export interface HousingReport {
  registryValid: boolean
  registryProblems: string[]
  catalogValid: boolean
  currentProperty: PropertyId
  leaseStatus: LeaseStatus
  leaseLabel: string
  nextDueDay: number
  periodSeq: number
  debt: number
  depositHeld: number
  lateFeePeriod: number | null
  paymentsCount: number
  appliedTxnKeys: number
  ownedAssets: number
  assetSeq: number
  placedCount: number
  storedCount: number
  discovered: PropertyId[]
  toured: PropertyId[]
  historyCount: number
}

export function housingReport(): HousingReport {
  const s = getHousingState()
  const problems = validatePropertyRegistry()
  return {
    registryValid: problems.length === 0,
    registryProblems: problems,
    catalogValid: validateFurnitureCatalog().length === 0,
    currentProperty: s.currentPropertyId,
    leaseStatus: s.lease.status,
    leaseLabel: leaseStatusLabel(s.lease),
    nextDueDay: s.lease.nextDueDay,
    periodSeq: s.lease.periodSeq,
    debt: s.lease.debt,
    depositHeld: s.lease.depositHeld,
    lateFeePeriod: s.lease.lateFeePeriod,
    paymentsCount: s.payments.length,
    appliedTxnKeys: s.appliedTxnKeys.length,
    ownedAssets: ownedAssetCount(),
    assetSeq: s.assetSeq,
    placedCount: Object.keys(s.placements).length,
    storedCount: getStoredAssetIds().length,
    discovered: [...s.discovered],
    toured: [...s.toured],
    historyCount: s.history.length,
  }
}
