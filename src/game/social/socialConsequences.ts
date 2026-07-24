/**
 * Relationship CONSEQUENCES that reach into the wider game (issue #13 §consequences),
 * strictly OBSERVE-ONLY: this bridge reads existing runtimes and feeds the ONE
 * social pipeline; it never owns crime, economy, or world state. It covers the
 * crime/witness axis (named NPCs who see you offend), the world-reaction axis
 * (their fear/hostility then shows on their contact card + gates apologise), and
 * the economy axis (a friendly vendor's loyalty discount). Social ACCESS
 * (contact unlock, favour refusal) and MISSIONS/FAVOURS (favor_completed) are
 * delivered by earlier slices.
 */
import { registry } from '../world/runtimeRegistry'
import { isSocialActor } from './socialActors'
import { getDerivedRelationship, ingestSocialEvent } from './socialRuntime'
import type { RelationshipTier, SocialActorId } from './socialTypes'

/** How close a named NPC must be to a crime/arrest to notice it (world units). */
export const WITNESS_RADIUS = 22

/** Named social actors within `radius` (XZ) of a world position, via the registry. */
export function namedActorsNear(position: [number, number, number], radius = WITNESS_RADIUS): SocialActorId[] {
  const out: SocialActorId[] = []
  const r2 = radius * radius
  for (const [id, pos] of registry.npcPositions) {
    if (!isSocialActor(id)) continue
    const dx = pos.x - position[0]
    const dz = pos.z - position[2]
    if (dx * dx + dz * dz <= r2) out.push(id)
  }
  return out
}

/**
 * A crime the player just committed: every named NPC in sight remembers it
 * (crime_witnessed — fear up, trust down, SCALED by the actor's crimeSensitivity
 * in the effect table, so Officer Kim reacts hardest). Exactly-once per crime per
 * witness. Returns the ids that reacted (for tests / observability).
 */
export function noteCrimeWitnessed(
  crimeId: string,
  position: [number, number, number],
  gameDay: number,
  gameHour: number,
  district?: string,
): SocialActorId[] {
  const witnesses = namedActorsNear(position)
  for (const actorId of witnesses) {
    ingestSocialEvent({ id: `witness:${crimeId}:${actorId}`, kind: 'crime_witnessed', actorId, gameDay, gameHour, district })
  }
  return witnesses
}

/** The player was arrested in public: nearby named NPCs note it (a trust ding). */
export function noteArrestWitnessed(
  position: [number, number, number],
  gameDay: number,
  gameHour: number,
): SocialActorId[] {
  const witnesses = namedActorsNear(position)
  for (const actorId of witnesses) {
    ingestSocialEvent({ id: `arrest:${actorId}:${Math.trunc(gameDay)}:${Math.round(gameHour)}`, kind: 'arrested_witnessed', actorId, gameDay, gameHour })
  }
  return witnesses
}

/**
 * A named vendor's loyalty discount as a fraction (0..0.15), by warmth tier. Pure
 * — the caller (a store / the food truck) reads it for a friend and applies it to
 * the price. A vendor you're on bad terms with simply gets 0 (no penalty pricing).
 */
export function socialLoyaltyDiscount(tier: RelationshipTier): number {
  switch (tier) {
    case 'close':
      return 0.15
    case 'trusted':
      return 0.1
    case 'friendly':
      return 0.05
    default:
      return 0
  }
}

/** Live loyalty discount a named vendor extends the player right now (reads the
 *  runtime tier). A stranger/acquaintance vendor gives 0. */
export function vendorDiscountPct(vendorNpcId: SocialActorId): number {
  return socialLoyaltyDiscount(getDerivedRelationship(vendorNpcId).tier)
}
