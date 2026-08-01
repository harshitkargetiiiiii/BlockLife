/**
 * Vehicle → social ride adapter (issue #19 §11). "Give a Ride": the player, stopped in an owned
 * usable vehicle, invites a sufficiently-friendly NPC along; a completed ride produces ONE social
 * memory through the EXISTING social event pipeline (`ingestSocialEvent`, exact-once by id). The
 * passenger is a transient seated-render flag — NO passenger driving AI, and it is never persisted
 * (a load never strands a passenger). Vehicle ownership READS social relationships; it never mutates
 * social state except through the one event pipeline.
 */
import { getOwnedVehicles } from './vehicleOwnershipRuntime'
import { getVehicleDef } from './vehicleRegistry'
import { getDerivedRelationship, hasMet } from '../social/socialRuntime'
import type { RelationshipTier, SocialActorId } from '../social/socialTypes'
import type { VehicleRefusalReason } from './vehicleOwnershipTypes'

/** Transient ride state — the current passenger NPC id, or null. Never serialized (§11 save policy). */
export const vehicleRideRuntime = { passengerId: null as string | null }
export function getRidePassenger(): string | null {
  return vehicleRideRuntime.passengerId
}
export function setRidePassenger(id: string | null): void {
  vehicleRideRuntime.passengerId = id
}
export function resetVehicleRide(): void {
  vehicleRideRuntime.passengerId = null
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
 *  Stopped/at-the-vehicle/activity-exclusion checks are the store action's (they read live state). */
export function canGiveRide(npcId: string): RideCheck {
  const id = npcId as SocialActorId
  if (!hasMet(id)) return { ok: false, reason: 'ineligible' }
  if (!RIDE_ALLOWED_TIERS.includes(getDerivedRelationship(id).tier)) return { ok: false, reason: 'ineligible' }
  if (!hasUsableRideVehicle()) return { ok: false, reason: 'unavailable' }
  return { ok: true }
}
