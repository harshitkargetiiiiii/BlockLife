/**
 * The ONE relationship mutation path (issue #13 §2). Pure + deterministic:
 * integer clamping, a single `applyRelationshipDelta`, and tier derivation that
 * nothing else may bypass. No per-frame use; callers apply a bounded delta once
 * per social event through the pipeline.
 */
import {
  REL_BOUNDS,
  type DerivedRelationship,
  type Relationship,
  type RelationshipDelta,
  type RelationshipReason,
  type RelationshipTier,
} from './socialTypes'

/** Canonical default relationship (a never-met stranger). */
export function defaultRelationship(): Relationship {
  return { familiarity: 0, affinity: 0, trust: 0, fear: 0, lastMeaningfulInteractionDay: -1 }
}

const clampInt = (v: number, min: number, max: number) => Math.max(min, Math.min(max, Math.round(v)))

/** Clamp every dimension into its bounded integer range (fail-safe on load). */
export function clampRelationship(rel: Relationship): Relationship {
  return {
    familiarity: clampInt(rel.familiarity, REL_BOUNDS.familiarity.min, REL_BOUNDS.familiarity.max),
    affinity: clampInt(rel.affinity, REL_BOUNDS.affinity.min, REL_BOUNDS.affinity.max),
    trust: clampInt(rel.trust, REL_BOUNDS.trust.min, REL_BOUNDS.trust.max),
    fear: clampInt(rel.fear, REL_BOUNDS.fear.min, REL_BOUNDS.fear.max),
    lastMeaningfulInteractionDay: Math.trunc(rel.lastMeaningfulInteractionDay),
  }
}

/**
 * Apply a bounded delta and return a NEW clamped relationship (never mutates the
 * input — deterministic + replay-safe). Every meaningful reason stamps
 * `lastMeaningfulInteractionDay`; passive `decay` does not (it isn't a moment
 * between the two). The reason is accepted for typed-change tracing (§2); the
 * numeric effect lives entirely in `delta`, so effects stay data, not code.
 */
export function applyRelationshipDelta(
  rel: Relationship,
  delta: RelationshipDelta,
  reason: RelationshipReason,
  gameDay: number,
): Relationship {
  const next = clampRelationship({
    familiarity: rel.familiarity + (delta.familiarity ?? 0),
    affinity: rel.affinity + (delta.affinity ?? 0),
    trust: rel.trust + (delta.trust ?? 0),
    fear: rel.fear + (delta.fear ?? 0),
    lastMeaningfulInteractionDay: rel.lastMeaningfulInteractionDay,
  })
  if (reason !== 'decay') next.lastMeaningfulInteractionDay = Math.trunc(gameDay)
  return next
}

// ---- derived tiers (§2) --------------------------------------------------

/** Fear at/above this reads as fear/hostility state. */
const FEAR_THRESHOLD = 50
/** With fear, affinity at/below this makes the NPC actively hostile (not just afraid). */
const HOSTILE_AFFINITY = -20

const FAMILIAR_ACQUAINTANCE = 15
const FRIENDLY_AFFINITY = 25
const TRUSTED_TRUST = 40
const CLOSE_AFFINITY = 60

/**
 * Derive the warmth tier + orthogonal hostile/afraid flags PURELY from the
 * dimensions. Warmth escalates monotonically through familiarity → affinity →
 * trust → affinity; hostility/fear is a separate axis so an NPC can be e.g.
 * "friendly but afraid" or "known but hostile".
 */
export function deriveRelationship(rel: Relationship): DerivedRelationship {
  const hostile = rel.fear >= FEAR_THRESHOLD && rel.affinity <= HOSTILE_AFFINITY
  const afraid = rel.fear >= FEAR_THRESHOLD && !hostile

  let tier: RelationshipTier = 'stranger'
  if (rel.familiarity >= FAMILIAR_ACQUAINTANCE) tier = 'acquaintance'
  if (tier === 'acquaintance' && rel.affinity >= FRIENDLY_AFFINITY) tier = 'friendly'
  if (tier === 'friendly' && rel.trust >= TRUSTED_TRUST) tier = 'trusted'
  if (tier === 'trusted' && rel.affinity >= CLOSE_AFFINITY) tier = 'close'

  return { tier, hostile, afraid }
}

/** Convenience: the derived tier only. */
export function relationshipTier(rel: Relationship): RelationshipTier {
  return deriveRelationship(rel).tier
}
