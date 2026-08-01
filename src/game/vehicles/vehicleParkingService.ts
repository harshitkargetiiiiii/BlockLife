/**
 * Vehicle parking service (issue #19 §5) — the ONE place that selects and validates where an
 * owned vehicle may legitimately sit. Pure selection + guarded checks over the authored parking
 * registry + the ownership runtime; it enforces one-vehicle-per-anchor and size fit. It never
 * touches the physical shell, crime state, or money — the store action performs the actual
 * location mutation (via `setVehicleLocation`) and any shell teleport.
 */
import {
  DEALERSHIP_ANCHOR_IDS,
  PARKING_ANCHORS,
  anchorsInCategory,
  getParkingAnchor,
  parkingSizeFits,
  residenceAnchorFor,
  type ParkingCategory,
} from './parkingRegistry'
import { getVehicleDef } from './vehicleRegistry'
import { isAnchorOccupied } from './vehicleOwnershipRuntime'
import type { VehicleRefusalReason } from './vehicleOwnershipTypes'

/** Categories the player may actively park at (impound/recovery are system-managed holdings). */
const PARKABLE_CATEGORIES: readonly ParkingCategory[] = ['residence', 'public', 'dealership', 'service']

/**
 * Pick a safe initial parking anchor for a freshly acquired vehicle, or null → anchor-less
 * recovery holding (the player retrieves it later). Prefers a free dealership bay, then a free
 * public anchor that fits the class. Deterministic order (registry order, never sorted).
 */
export function pickInitialParkingAnchorId(defId: string): string | null {
  const size = getVehicleDef(defId)?.parkingSize ?? 'large'
  for (const id of DEALERSHIP_ANCHOR_IDS) {
    const a = getParkingAnchor(id)
    if (a && parkingSizeFits(a.maxSize, size) && !isAnchorOccupied(id)) return id
  }
  for (const a of anchorsInCategory('public')) {
    if (parkingSizeFits(a.maxSize, size) && !isAnchorOccupied(a.id)) return a.id
  }
  return null
}

/** The residence parking anchor for a property, if free + size-compatible (else null). */
export function freeResidenceAnchorId(propertyId: string, defId: string): string | null {
  const a = residenceAnchorFor(propertyId)
  if (!a) return null
  const size = getVehicleDef(defId)?.parkingSize ?? 'large'
  if (!parkingSizeFits(a.maxSize, size) || isAnchorOccupied(a.id)) return null
  return a.id
}

/**
 * The nearest free, size-compatible parkable anchor to (x, z) within `maxDist`, or null. Used when
 * the player parks the driven car: they must be beside a real authored spot, not "save anywhere".
 */
export function nearestParkableAnchorId(x: number, z: number, defId: string, maxDist = 6): string | null {
  const size = getVehicleDef(defId)?.parkingSize ?? 'large'
  let best: { id: string; d: number } | null = null
  for (const a of PARKING_ANCHORS) {
    if (!PARKABLE_CATEGORIES.includes(a.category)) continue
    if (!parkingSizeFits(a.maxSize, size) || isAnchorOccupied(a.id)) continue
    const d = Math.hypot(a.position[0] - x, a.position[1] - z)
    if (d <= maxDist && (best === null || d < best.d)) best = { id: a.id, d }
  }
  return best ? best.id : null
}

export type ParkAnchorCheck = { ok: true } | { ok: false; reason: VehicleRefusalReason }

/**
 * Validate that `defId` may park at `anchorId` (excluding `exceptAssetId`, e.g. re-parking the
 * same asset): the anchor must exist, fit the class size, and be unoccupied. Nearness/stopped/
 * streamed checks are the store action's (they need the live shell transform).
 */
export function canParkAtAnchor(defId: string, anchorId: string, exceptAssetId?: string): ParkAnchorCheck {
  const a = getParkingAnchor(anchorId)
  if (!a) return { ok: false, reason: 'not_at_location' }
  const size = getVehicleDef(defId)?.parkingSize ?? 'large'
  if (!parkingSizeFits(a.maxSize, size)) return { ok: false, reason: 'incompatible' }
  if (isAnchorOccupied(anchorId, exceptAssetId)) return { ok: false, reason: 'occupied_anchor' }
  return { ok: true }
}
