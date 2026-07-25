/**
 * Social Life, Relationships & NPC Memory v1 (issue #13) — the typed, serializable
 * gameplay STATE that owns social behaviour. Dialogue text may express this state,
 * but never becomes the authority (product principle #1).
 *
 * Determinism: every relationship dimension is an INTEGER in a bounded range, so
 * there is no floating-point drift that could change deterministic tests
 * (constraint §2 / §14). Tiers derive purely from the dimensions; nothing else
 * assigns a tier. Memory explains WHY a relationship changed; the relationship is
 * the compact current summary — the two stay separate (§3).
 */

/** Stable social-actor id === the world/mission/phone/save NPC id (§1 mapping). */
export type SocialActorId = string

// ---- relationship model (§2) ---------------------------------------------

/** Bounded integer ranges — clamped centrally, never mutated component-side. */
export const REL_BOUNDS = {
  familiarity: { min: 0, max: 100 },
  affinity: { min: -100, max: 100 },
  trust: { min: -100, max: 100 },
  fear: { min: 0, max: 100 },
} as const

/**
 * A compact multidimensional relationship. Supports orthogonal states like
 * "likes but doesn't trust", "trusts but is upset", "fears but cooperates".
 * All numbers are integers within {@link REL_BOUNDS}. `lastMeaningfulInteractionDay`
 * is a game day (integer) or -1 when the two have never had a meaningful moment.
 */
export interface Relationship {
  familiarity: number
  affinity: number
  trust: number
  fear: number
  lastMeaningfulInteractionDay: number
}

/** Derived, never hand-assigned. Warmth tier + orthogonal hostile/afraid flags. */
export type RelationshipTier = 'stranger' | 'acquaintance' | 'friendly' | 'trusted' | 'close'

export interface DerivedRelationship {
  tier: RelationshipTier
  /** Fear/hostility high AND affinity low → the NPC is actively hostile. */
  hostile: boolean
  /** Fear high but not hostile → cooperates reluctantly, avoids confrontation. */
  afraid: boolean
}

/**
 * Typed reasons for a relationship change (§2 "typed change reasons for
 * debugging"). Every mutation carries one; unrelated features never poke the
 * numbers directly.
 */
export type RelationshipReason =
  | 'first_meeting'
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
  | 'apology_accepted'
  | 'apology_rejected'
  | 'purchase_relevant'
  | 'crime_witnessed'
  | 'arrested_witnessed'
  | 'harmed'
  | 'threatened'
  | 'protected'
  | 'helped'
  | 'decay'

/** A bounded per-dimension delta applied through the ONE mutation path. */
export interface RelationshipDelta {
  familiarity?: number
  affinity?: number
  trust?: number
  fear?: number
}

// ---- named social actor registry (§1) ------------------------------------

/** Interaction categories an NPC can prefer or dislike (drives affinity effects). */
export type InteractionCategory = 'conversation' | 'gift' | 'favor' | 'invite' | 'commerce' | 'fitness' | 'delivery'

/** When a contact unlocks in the phone (§1 "contact unlock rule"). */
export type ContactUnlockRule =
  | { kind: 'first_meeting' } // unlocks the moment you meet them
  | { kind: 'familiarity'; min: number } // unlocks once known well enough
  | { kind: 'tier'; min: RelationshipTier } // unlocks at a warmth tier

/**
 * One named social actor: typed, serializable metadata extending an existing
 * named NPC (NOT a duplicate). Its `id` IS the world/mission/phone/save NPC id.
 */
export interface SocialActor {
  id: SocialActorId
  /** The world NPC entity id — same stable id (validated by tests). */
  npcId: string
  displayName: string
  role: string
  /** Short profile line for the phone/contact card. */
  profile: string
  /** Daily availability windows as [fromHour, toHour) game hours (may wrap). */
  availability: [number, number][]
  /** Social tendencies (debug + future tuning). */
  traits: string[]
  preferredCategories: InteractionCategory[]
  dislikedCategories: InteractionCategory[]
  defaultRelationship: Relationship
  contactUnlock: ContactUnlockRule
  /** Item ids (from the real catalog) this NPC likes / dislikes as gifts. */
  giftLikes: string[]
  giftDislikes: string[]
  /** 0..100: how strongly crime witnessed nearby moves this NPC (Officer Kim high). */
  crimeSensitivity: number
  /** Debug provenance. */
  sourceRef: string
}

// ---- memory ledger (§3) --------------------------------------------------

/** Typed memory kinds (§3 "required memory kinds"). */
export type MemoryKind =
  | 'first_meeting'
  | 'conversation'
  | 'check_in'
  | 'favor_completed'
  | 'favor_failed'
  | 'gift_given'
  | 'invitation_accepted'
  | 'invitation_declined'
  | 'no_show'
  | 'repeated_visit'
  | 'purchase_relevant'
  | 'crime_witnessed'
  | 'harmed'
  | 'threatened'
  | 'protected'
  | 'arrested_witnessed'
  | 'apology_accepted'
  | 'apology_rejected'

/**
 * One bounded, gameplay-relevant memory. No dialogue transcripts, no unbounded
 * fields (§3). `dedupeKey` collapses repeated deliveries of the "same" memory;
 * `sourceEventId` ties it to the exact-once social event that created it.
 */
export interface MemoryEntry {
  /** Deterministic identity == dedupeKey (stable, so replay can't duplicate). */
  id: string
  npcId: SocialActorId
  kind: MemoryKind
  /** Other party (an NPC/store/mission id) when the memory is ABOUT someone. */
  counterpartyId?: string
  gameDay: number
  /** Game time-of-day hour [0,24) when known (display only). */
  gameHour?: number
  district?: string
  /** 0..100 — importance; low-salience memories decay + evict first. */
  salience: number
  /** -1 negative, 0 neutral, +1 positive — the emotional colour. */
  valence: -1 | 0 | 1
  /** The exact-once event that produced this memory (§4). */
  sourceEventId: string
  /** Durable memories (major events) never decay or evict (§3). */
  pinned: boolean
  /** Compact summary token the dialogue/phone layers render (no free text). */
  summaryToken: string
}

/** Bounded ledger config (§3 "bounded maximum per NPC"). */
export const MEMORY_MAX_PER_NPC = 16
/** Salience lost per game day for a non-pinned memory (integer decay). */
export const MEMORY_DECAY_PER_DAY = 2
/** Below this salience a decayed non-pinned memory is dropped. */
export const MEMORY_MIN_SALIENCE = 1

// ---- phone messaging + invitations (§ phone / scheduling) ----------------

/**
 * A bounded phone message. Text is NEVER stored free-form — a `token` selects a
 * deterministic template (see `socialMessaging.ts`), so threads stay bounded and
 * save-safe and dialogue owns no logic.
 */
export interface SocialMessage {
  id: string
  actorId: SocialActorId
  /** 'in' = from the NPC, 'out' = from the player. */
  dir: 'in' | 'out'
  /** Template token the phone renders (no free text). */
  token: string
  gameDay: number
  gameHour: number
  read: boolean
}

/** Reusable social activity kinds an invitation can be about (run in Slice 4). */
export type InvitationActivityKind = 'coffee' | 'food' | 'workout' | 'hangout' | 'walk'

export type InvitationStatus =
  | 'pending'
  | 'accepted'
  | 'declined'
  | 'suggested_later'
  // ---- activity lifecycle (linked instance) ----
  | 'active' // the player started the meet-up
  | 'completed' // the hangout/favor finished
  | 'missed' // the arrival window lapsed with no show
  | 'cancelled' // the player bailed after starting
  | 'failed' // an activity ended in failure (reserved)

/** A scheduled meet-up proposal, from either side. */
export interface SocialInvitation {
  id: string
  actorId: SocialActorId
  /** Who proposed it. */
  source: 'npc' | 'player'
  activityKind: InvitationActivityKind
  /** Proposed game day + hour (within the NPC's availability). */
  proposedDay: number
  proposedHour: number
  status: InvitationStatus
  createdDay: number
}

/** Bounded per-contact thread + total invitation caps (§ "bounded messages"). */
export const MESSAGES_MAX_PER_CONTACT = 12
export const INVITATIONS_MAX = 16

// ---- reusable social activities (§ activities, Slice 4) ------------------

export type SocialActivityTemplate = 'meet' | 'hangout' | 'favor'
/** Linear steps: `travel` → (`deliver` for favors) → `together` → `done`. */
export type SocialActivityStep = 'travel' | 'deliver' | 'together' | 'done'

/** The single in-progress activity. Bounded (one at a time), fully serializable. */
export interface SocialActivity {
  id: string
  actorId: SocialActorId
  template: SocialActivityTemplate
  activityKind: InvitationActivityKind
  /** An EXISTING world venue id reused as the meeting spot. */
  venueId: string
  venueLabel: string
  /** For `favor`: a real catalog item the player carries + hands over. */
  requiredItemId?: string
  /** The invitation this activity fulfils, if it came from one (lifecycle link). */
  invitationId?: string
  step: SocialActivityStep
  startedDay: number
}

// ---- serializable social save shape (§12) --------------------------------

/**
 * Additive, fail-safe social save slice. Old saves lack it entirely and load
 * with canonical defaults; malformed data is sanitized field-by-field so a bad
 * social blob can never corrupt the whole save.
 */
export interface SocialSaveData {
  version: number
  relationships: Record<SocialActorId, Relationship>
  memories: Record<SocialActorId, MemoryEntry[]>
  contacts: SocialActorId[]
  /** Exact-once ledger: source event ids already applied (bounded, FIFO). */
  appliedEventIds: string[]
  /**
   * Phone messaging + scheduling (Slice 3, additive within the social slice).
   * Old social saves lack these three and load with empty threads / no pending
   * invitations; each is sanitized independently on load.
   */
  messages?: Record<SocialActorId, SocialMessage[]>
  invitations?: SocialInvitation[]
  /** Last game day each NPC reached out (anti-spam cooldown for outreach). */
  lastInitiatedDay?: Record<SocialActorId, number>
  /** Slice 4: the single in-progress social activity (or omitted/null). */
  activeActivity?: SocialActivity | null
  /** Persisted message-id counter (PR#14 hardening; old saves default to 0). */
  msgSeq?: number
}

export const SOCIAL_SAVE_VERSION = 1
/** Bounded FIFO of applied event ids kept for exact-once replay guard (§4). */
export const APPLIED_EVENT_ID_MAX = 256
