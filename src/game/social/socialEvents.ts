/**
 * The ONE social event pipeline (issue #13 §4). Existing gameplay events are
 * translated by adapters into typed {@link SocialEvent}s, then:
 *
 *   event → exact-once dedupe → memory entry → relationship effect → unlock eval
 *
 * Pure + deterministic: `applySocialEvent` returns a NEW state (no mutation), so
 * reset/load never re-applies old events and repeated delivery is a no-op. Every
 * relationship effect is DATA in the effect table below — no feature writes the
 * numbers directly, and dialogue text owns nothing (§1/§2/§4).
 */
import { applyRelationshipDelta, deriveRelationship } from './relationship'
import { defaultRelationshipFor, getSocialActor } from './socialActors'
import { insertMemory } from './memoryLedger'
import {
  APPLIED_EVENT_ID_MAX,
  type MemoryEntry,
  type MemoryKind,
  type Relationship,
  type RelationshipDelta,
  type RelationshipReason,
  type SocialActivity,
  type SocialActor,
  type SocialActorId,
  type SocialInvitation,
  type SocialMessage,
} from './socialTypes'

/** Kinds an adapter can emit (maps existing mission/economy/crime/interaction events). */
export type SocialEventKind =
  | 'met'
  | 'conversation'
  | 'check_in'
  | 'gift_liked'
  | 'gift_neutral'
  | 'gift_disliked'
  | 'favor_completed'
  | 'favor_failed'
  | 'invitation_accepted'
  | 'invitation_declined'
  | 'activity_completed'
  | 'no_show'
  | 'purchase_relevant'
  | 'crime_witnessed'
  | 'harmed'
  | 'protected'
  | 'apology_accepted'
  | 'apology_rejected'
  | 'arrested_witnessed'
  | 'threatened'

/** A typed social event with a STABLE id for exact-once application. */
export interface SocialEvent {
  /** Stable, unique — the exact-once key AND the memory's sourceEventId. */
  id: string
  kind: SocialEventKind
  actorId: SocialActorId
  gameDay: number
  gameHour?: number
  district?: string
  counterpartyId?: string
}

/** The mutable social gameplay state (lives in the runtime; mutated only via
 *  the pipeline here + the messaging reducers). */
export interface SocialState {
  relationships: Record<SocialActorId, Relationship>
  memories: Record<SocialActorId, MemoryEntry[]>
  contacts: SocialActorId[]
  /** Bounded FIFO of already-applied event ids (exact-once guard). */
  appliedEventIds: string[]
  /** Phone: bounded per-contact message threads (Slice 3). */
  messages: Record<SocialActorId, SocialMessage[]>
  /** Phone: active + resolved meet-up invitations (bounded, Slice 3). */
  invitations: SocialInvitation[]
  /** Last game day each NPC reached out (outreach anti-spam cooldown). */
  lastInitiatedDay: Record<SocialActorId, number>
  /** The single in-progress social activity (Slice 4), or null. */
  activeActivity: SocialActivity | null
}

export function defaultSocialState(): SocialState {
  return { relationships: {}, memories: {}, contacts: [], appliedEventIds: [], messages: {}, invitations: [], lastInitiatedDay: {}, activeActivity: null }
}

// ---- effect table (§4: effects are DATA) ---------------------------------

interface SocialEffect {
  delta: RelationshipDelta
  reason: RelationshipReason
  memoryKind: MemoryKind
  salience: number
  valence: -1 | 0 | 1
  pinned: boolean
  summaryToken: string
  /** Whether the memory reinforces on repeat (dedupe by day) vs one-shot (by event). */
  reinforcing: boolean
}

/**
 * Deterministic effect for an event, given the actor (so e.g. crime reactions
 * scale with the NPC's `crimeSensitivity`). Bounded integer deltas only.
 */
function socialEffect(kind: SocialEventKind, actor: SocialActor): SocialEffect {
  const cs = actor.crimeSensitivity
  switch (kind) {
    case 'met':
      return { delta: { familiarity: 15 }, reason: 'first_meeting', memoryKind: 'first_meeting', salience: 60, valence: 1, pinned: true, summaryToken: 'first_meeting', reinforcing: false }
    case 'conversation':
      return { delta: { familiarity: 4, affinity: 2 }, reason: 'conversation', memoryKind: 'conversation', salience: 22, valence: 0, pinned: false, summaryToken: 'talked', reinforcing: true }
    case 'check_in':
      return { delta: { affinity: 4, trust: 3, familiarity: 2 }, reason: 'check_in', memoryKind: 'check_in', salience: 26, valence: 1, pinned: false, summaryToken: 'checked_in', reinforcing: true }
    case 'gift_liked':
      return { delta: { affinity: 12, trust: 3, familiarity: 2 }, reason: 'gift_liked', memoryKind: 'gift_given', salience: 45, valence: 1, pinned: false, summaryToken: 'gift_liked', reinforcing: false }
    case 'gift_neutral':
      return { delta: { affinity: 3, familiarity: 1 }, reason: 'gift_neutral', memoryKind: 'gift_given', salience: 20, valence: 0, pinned: false, summaryToken: 'gift_ok', reinforcing: true }
    case 'gift_disliked':
      return { delta: { affinity: -8 }, reason: 'gift_disliked', memoryKind: 'gift_given', salience: 30, valence: -1, pinned: false, summaryToken: 'gift_disliked', reinforcing: false }
    case 'favor_completed':
      return { delta: { trust: 15, affinity: 8, familiarity: 5 }, reason: 'favor_completed', memoryKind: 'favor_completed', salience: 55, valence: 1, pinned: true, summaryToken: 'favor_done', reinforcing: false }
    case 'favor_failed':
      return { delta: { trust: -12, affinity: -5 }, reason: 'favor_failed', memoryKind: 'favor_failed', salience: 45, valence: -1, pinned: false, summaryToken: 'favor_failed', reinforcing: false }
    case 'invitation_accepted':
      return { delta: { affinity: 5, familiarity: 2 }, reason: 'invitation_accepted', memoryKind: 'invitation_accepted', salience: 28, valence: 1, pinned: false, summaryToken: 'inv_yes', reinforcing: false }
    case 'invitation_declined':
      return { delta: { affinity: -2 }, reason: 'invitation_declined', memoryKind: 'invitation_declined', salience: 18, valence: 0, pinned: false, summaryToken: 'inv_no', reinforcing: false }
    case 'activity_completed':
      return { delta: { affinity: 10, trust: 5, familiarity: 4 }, reason: 'activity_completed', memoryKind: 'invitation_accepted', salience: 50, valence: 1, pinned: false, summaryToken: 'hung_out', reinforcing: false }
    case 'no_show':
      return { delta: { trust: -10, affinity: -8 }, reason: 'no_show', memoryKind: 'no_show', salience: 40, valence: -1, pinned: false, summaryToken: 'no_show', reinforcing: false }
    case 'purchase_relevant':
      return { delta: { affinity: 4, familiarity: 3 }, reason: 'purchase_relevant', memoryKind: 'purchase_relevant', salience: 24, valence: 1, pinned: false, summaryToken: 'bought', reinforcing: true }
    case 'crime_witnessed':
      return { delta: { fear: Math.round(cs / 6), trust: -Math.round(cs / 12), affinity: -Math.round(cs / 20) }, reason: 'crime_witnessed', memoryKind: 'crime_witnessed', salience: 50, valence: -1, pinned: true, summaryToken: 'saw_crime', reinforcing: false }
    case 'harmed':
      return { delta: { fear: 40, affinity: -40, trust: -30 }, reason: 'harmed', memoryKind: 'harmed', salience: 85, valence: -1, pinned: true, summaryToken: 'harmed', reinforcing: false }
    case 'protected':
      return { delta: { affinity: 15, trust: 12, fear: -10 }, reason: 'protected', memoryKind: 'protected', salience: 60, valence: 1, pinned: true, summaryToken: 'protected', reinforcing: false }
    case 'apology_accepted':
      return { delta: { fear: -20, affinity: 6, trust: 4 }, reason: 'apology_accepted', memoryKind: 'apology_accepted', salience: 35, valence: 1, pinned: false, summaryToken: 'sorry_ok', reinforcing: false }
    case 'apology_rejected':
      return { delta: {}, reason: 'apology_rejected', memoryKind: 'apology_rejected', salience: 30, valence: -1, pinned: false, summaryToken: 'sorry_no', reinforcing: false }
    case 'arrested_witnessed':
      return { delta: { trust: -8, familiarity: 2 }, reason: 'arrested_witnessed', memoryKind: 'arrested_witnessed', salience: 40, valence: -1, pinned: false, summaryToken: 'saw_arrest', reinforcing: false }
    case 'threatened':
      return { delta: { fear: 35, affinity: -25, trust: -20 }, reason: 'threatened', memoryKind: 'threatened', salience: 70, valence: -1, pinned: true, summaryToken: 'threatened', reinforcing: false }
  }
}

/** What one applied event changed (for messages/unlock evaluation upstream). */
export interface SocialEventResult {
  state: SocialState
  /** False when the event was a duplicate (exact-once) — nothing changed. */
  applied: boolean
  /** True when this application newly unlocked the NPC as a phone contact. */
  contactUnlocked: boolean
  actorId: SocialActorId
}

/** A stable memory dedupe key (reinforcing kinds collapse per day; else per event). */
function memoryDedupeKey(e: SocialEvent, eff: SocialEffect): string {
  return eff.reinforcing ? `${e.actorId}:${eff.memoryKind}:${e.gameDay}` : e.id
}

/** Should this NPC be a contact given the relationship + a real meeting? */
export function contactUnlocked(actor: SocialActor, rel: Relationship, hasMet: boolean): boolean {
  const rule = actor.contactUnlock
  if (rule.kind === 'first_meeting') return hasMet
  if (rule.kind === 'familiarity') return rel.familiarity >= rule.min
  // tier rule
  const order = ['stranger', 'acquaintance', 'friendly', 'trusted', 'close']
  return order.indexOf(deriveRelationship(rel).tier) >= order.indexOf(rule.min)
}

/**
 * Apply one social event through the whole pipeline, exact-once. Returns a new
 * state; a duplicate event id (or unknown actor) is a no-op that reports
 * `applied:false`. The relationship effect and the memory both derive from the
 * SAME effect-table entry, so they never drift.
 */
export function applySocialEvent(prev: SocialState, event: SocialEvent): SocialEventResult {
  const actor = getSocialActor(event.actorId)
  if (!actor || prev.appliedEventIds.includes(event.id)) {
    return { state: prev, applied: false, contactUnlocked: false, actorId: event.actorId }
  }
  const eff = socialEffect(event.kind, actor)

  const baseRel = prev.relationships[event.actorId] ?? defaultRelationshipFor(event.actorId)
  const nextRel = applyRelationshipDelta(baseRel, eff.delta, eff.reason, event.gameDay)

  const memory: MemoryEntry = {
    id: memoryDedupeKey(event, eff),
    npcId: event.actorId,
    kind: eff.memoryKind,
    counterpartyId: event.counterpartyId,
    gameDay: Math.trunc(event.gameDay),
    gameHour: event.gameHour,
    district: event.district,
    salience: eff.salience,
    valence: eff.valence,
    sourceEventId: event.id,
    pinned: eff.pinned,
    summaryToken: eff.summaryToken,
  }
  const nextMemories = insertMemory(prev.memories[event.actorId] ?? [], memory, event.gameDay)

  const hasMet = event.kind === 'met' || prev.contacts.includes(event.actorId) || (prev.memories[event.actorId]?.length ?? 0) > 0
  const wasContact = prev.contacts.includes(event.actorId)
  const nowContact = contactUnlocked(actor, nextRel, hasMet)
  const contacts = nowContact && !wasContact ? [...prev.contacts, event.actorId] : prev.contacts

  const appliedEventIds = [...prev.appliedEventIds, event.id]
  if (appliedEventIds.length > APPLIED_EVENT_ID_MAX) appliedEventIds.splice(0, appliedEventIds.length - APPLIED_EVENT_ID_MAX)

  return {
    state: {
      ...prev,
      relationships: { ...prev.relationships, [event.actorId]: nextRel },
      memories: { ...prev.memories, [event.actorId]: nextMemories },
      contacts,
      appliedEventIds,
    },
    applied: true,
    contactUnlocked: nowContact && !wasContact,
    actorId: event.actorId,
  }
}
