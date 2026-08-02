/**
 * Vehicle → social ride adapter (issue #19 §11). "Give a Ride": the player, stopped in an owned
 * usable vehicle, offers a sufficiently-friendly NPC a lift. The ride is a REAL Social Life activity
 * of kind `drive_around` run through the EXISTING activity authority (`beginActivity` / `stepActivity`
 * / `cancelActivity`) — NOT a parallel vehicle-side runtime. This adapter only READS social state
 * (relationship tier + the active activity) and derives the current passenger from it; it never owns
 * ride state or mutates social relationships (the pipeline's completion/cancel events do that).
 */
import { getOwnedVehicles } from './vehicleOwnershipRuntime'
import { getVehicleDef } from './vehicleRegistry'
import { getActiveActivity, getDerivedRelationship, hasMet } from '../social/socialRuntime'
import type { RelationshipTier, SocialActorId } from '../social/socialTypes'
import type { VehicleRefusalReason } from './vehicleOwnershipTypes'

/** The current ride passenger NPC id, derived from the ONE active social activity — non-null only
 *  while a `drive_around` activity is running. Never a separate stored field (no stranded passenger). */
export function getRidePassenger(): string | null {
  const a = getActiveActivity()
  return a && a.activityKind === 'drive_around' ? a.actorId : null
}

/** True when a Give-a-Ride activity is currently in progress. */
export function isRideActive(): boolean {
  return getRidePassenger() != null
}

/** A ride needs a friend or better (never bought with vehicle value — §11). */
const RIDE_ALLOWED_TIERS: readonly RelationshipTier[] = ['friendly', 'trusted', 'close']

/** True when the player owns a usable passenger vehicle: seats ≥ 2, positive condition, not impounded. */
export function hasUsableRideVehicle(): boolean {
  return getOwnedVehicles().some((v) => {
    const def = getVehicleDef(v.defId)
    return !!def && def.seats >= 2 && v.condition > 0 && v.location.kind !== 'impound'
  })
}

export type RideCheck = { ok: true } | { ok: false; reason: VehicleRefusalReason }

/** Validate offering `npcId` a ride: met, a friendly+ relationship, and a usable owned vehicle.
 *  Stopped/driving/activity-exclusion checks are the store action's (they read live game state). */
export function canGiveRide(npcId: string): RideCheck {
  const id = npcId as SocialActorId
  if (!hasMet(id)) return { ok: false, reason: 'ineligible' }
  if (!RIDE_ALLOWED_TIERS.includes(getDerivedRelationship(id).tier)) return { ok: false, reason: 'ineligible' }
  if (!hasUsableRideVehicle()) return { ok: false, reason: 'unavailable' }
  return { ok: true }
}
