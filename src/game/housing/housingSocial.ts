/**
 * Home-hosting adapter (issue #17 §9). The three home activities run entirely
 * through the EXISTING Social Life invitation + activity + relationship + memory +
 * message pipeline (no second social engine): the invitation kind is a `*_home`
 * social kind, the venue is the player's residence, and this module adds only the
 * housing-specific parts — the furniture/lease gates, the required seating, and the
 * interior hosting anchor where the guest appears. Trust is enforced by the social
 * layer's own invite response, plus a housing minimum tier per activity.
 */
import type { InvitationActivityKind, RelationshipTier } from './../social/socialTypes'
import { APARTMENT_INTERACTABLE_POSITIONS } from '../interiors/apartmentLayout'
import { LOFT_GUEST_SPAWN } from '../interiors/loftLayout'
import { PREMIUM_GUEST_SPAWN } from '../interiors/premiumLayout'
import { isDelinquent } from './leaseModel'
import { getProperty } from './propertyRegistry'
import { getHomeMetrics, getLease, placedFurnitureDefs } from './housingRuntime'
import type { HomeActivityKind, HostingRefusalReason, PropertyId } from './housingTypes'

export interface HomeActivityDef {
  kind: HomeActivityKind
  invitationKind: InvitationActivityKind
  displayName: string
  /** Seats the home must provide (a guest needs somewhere to sit). */
  minSeats: number
  /** Minimum relationship tier a guest must have to accept. */
  minTier: RelationshipTier
  description: string
}

export const HOME_ACTIVITY_DEFS: readonly HomeActivityDef[] = [
  { kind: 'coffee_home', invitationKind: 'coffee_home', displayName: 'Coffee at Home', minSeats: 1, minTier: 'friendly', description: 'A relaxed catch-up over coffee.' },
  { kind: 'movie_night', invitationKind: 'movie_night', displayName: 'Movie Night', minSeats: 2, minTier: 'friendly', description: 'Cue up a film on the big screen.' },
  { kind: 'dinner_home', invitationKind: 'dinner_home', displayName: 'Dinner at Home', minSeats: 2, minTier: 'trusted', description: 'Cook and share a meal.' },
]

const TIER_ORDER: readonly RelationshipTier[] = ['stranger', 'acquaintance', 'friendly', 'trusted', 'close']
export function tierAtLeast(have: RelationshipTier, need: RelationshipTier): boolean {
  return TIER_ORDER.indexOf(have) >= TIER_ORDER.indexOf(need)
}

export function getHomeActivityDef(kind: HomeActivityKind): HomeActivityDef | undefined {
  return HOME_ACTIVITY_DEFS.find((d) => d.kind === kind)
}
export function homeActivityForInvitationKind(k: InvitationActivityKind): HomeActivityDef | undefined {
  return HOME_ACTIVITY_DEFS.find((d) => d.invitationKind === k)
}

/**
 * Whether the CURRENT home can host `kind` right now: lease in good standing, the
 * property supports hosting, the unlocking furniture is placed, and there is enough
 * seating. Trust is checked against the specific guest at invite time. Returns the
 * first unmet reason (readable via housingText).
 */
export function canHostActivity(kind: HomeActivityKind): { ok: boolean; reason?: HostingRefusalReason } {
  const def = getHomeActivityDef(kind)
  if (!def) return { ok: false, reason: 'missing_furniture' }
  const property = getProperty(getLease().propertyId)
  if (!property || property.hostingCapacity <= 0) return { ok: false, reason: 'no_lease' }
  if (isDelinquent(getLease())) return { ok: false, reason: 'delinquent' }
  const hasFurniture = placedFurnitureDefs().some((d) => d.unlocksActivities?.includes(kind))
  if (!hasFurniture) return { ok: false, reason: 'missing_furniture' }
  if (getHomeMetrics().hostingCapacity < def.minSeats) return { ok: false, reason: 'missing_furniture' }
  return { ok: true }
}

/** The interior world position a hosted guest stands at, per property. */
export function guestAnchorFor(propertyId: PropertyId): [number, number, number] | null {
  switch (propertyId) {
    case 'starter_studio': {
      const h = APARTMENT_INTERACTABLE_POSITIONS.host
      return [h[0], 1.2, h[2]]
    }
    case 'city_loft':
      return LOFT_GUEST_SPAWN
    case 'premium_apartment':
      return PREMIUM_GUEST_SPAWN
  }
}
