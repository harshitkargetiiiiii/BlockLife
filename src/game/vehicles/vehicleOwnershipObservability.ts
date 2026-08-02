/**
 * Vehicle ownership DEV observability (issue #19 §15). A compact, read-only snapshot for the
 * debug panel + the DEV/E2E test API. Pure derivation from canonical runtime state — it never
 * mutates and owns no gameplay. Everything that surfaces it is `import.meta.env.DEV`-guarded, so
 * no `GAME_TEST_API`/observability string survives the production build (asserted by the gate).
 */
import { getPlayerCarSourceId, isPlayerCarStolen } from './vehicleCrimeState'
import { getOwnedVehicles, ownedCount, vehicleOwnershipRuntime } from './vehicleOwnershipRuntime'
import { VEHICLE_OWNED_CAP } from './vehicleOwnershipTypes'
import { getVehicleDef, validateVehicleRegistry } from './vehicleRegistry'
import { conditionBand } from './vehicleOwnershipTypes'

export interface VehicleOwnershipReport {
  registryValid: boolean
  registryErrors: string[]
  ownedCount: number
  cap: number
  activeAssetId: string | null
  /** The active PHYSICAL identity: a legitimate owned asset, a stolen source, or nothing. */
  activeIdentity: 'owned' | 'stolen' | 'none'
  stolenSourceId: string | null
  migrated: boolean
  appliedTxnKeys: number
  /** Anchors claimed by more than one owned vehicle (should always be empty). */
  duplicateParkingAnchors: string[]
  assets: {
    id: string
    defId: string
    className: string
    condition: number
    band: string
    location: string
    upgrades: number
    cargoOverflow: number
    historyLen: number
  }[]
}

export function vehicleOwnershipReport(): VehicleOwnershipReport {
  const s = vehicleOwnershipRuntime.state
  const errors = validateVehicleRegistry()
  const owned = getOwnedVehicles()

  // Detect any anchor claimed twice (an invariant violation the runtime prevents).
  const byAnchor = new Map<string, number>()
  for (const v of owned) {
    if (v.location.kind === 'parked') byAnchor.set(v.location.anchorId, (byAnchor.get(v.location.anchorId) ?? 0) + 1)
  }
  const duplicateParkingAnchors = [...byAnchor.entries()].filter(([, n]) => n > 1).map(([a]) => a)

  const stolen = isPlayerCarStolen()
  return {
    registryValid: errors.length === 0,
    registryErrors: errors,
    ownedCount: ownedCount(),
    cap: VEHICLE_OWNED_CAP,
    activeAssetId: s.activeAssetId,
    activeIdentity: stolen ? 'stolen' : s.activeAssetId ? 'owned' : 'none',
    stolenSourceId: getPlayerCarSourceId(),
    migrated: s.migrated,
    appliedTxnKeys: s.appliedTxnKeys.length,
    duplicateParkingAnchors,
    assets: owned.map((v) => ({
      id: v.id,
      defId: v.defId,
      className: getVehicleDef(v.defId)?.vehicleClass ?? 'unknown',
      condition: v.condition,
      band: conditionBand(v.condition),
      location: v.location.kind === 'parked' ? `parked:${v.location.anchorId}` : v.location.kind,
      upgrades: v.customization.upgrades.length,
      cargoOverflow: Object.keys(v.cargoOverflow).length,
      historyLen: v.history.length,
    })),
  }
}
