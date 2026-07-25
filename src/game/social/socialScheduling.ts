/**
 * Social scheduling + availability (issue #13 §phone/scheduling). PURE +
 * deterministic: availability windows, invite gating (relationship, cooldown,
 * mission state), a next-slot proposer, and NPC-outreach eligibility. No random,
 * no per-frame use — callers reconcile lazily (like commerce restock). Nothing
 * here mutates state or owns dialogue text.
 */
import { INVITATION_GRACE_HOURS, INVITATION_START_EARLY_HOURS, type InvitationActivityKind, type MemoryEntry, type Relationship, type RelationshipTier, type SocialActor, type SocialInvitation } from './socialTypes'

/** True when `hour` falls inside `[from, to)`, correctly handling a wrap past midnight. */
export function isWithinWindow(hour: number, window: [number, number]): boolean {
  const [from, to] = window
  return from <= to ? hour >= from && hour < to : hour >= from || hour < to
}

/** Is the actor generally available (out and about) at this game hour? */
export function isAvailable(actor: SocialActor, hour: number): boolean {
  return actor.availability.some((w) => isWithinWindow(hour, w))
}

/**
 * The next game slot (day + hour) at/after `hour+1` when the actor is available.
 * Deterministic; searches forward up to 48h and falls back to the input.
 */
export function nextAvailableSlot(actor: SocialActor, day: number, hour: number): { day: number; hour: number } {
  for (let ahead = 1; ahead <= 48; ahead++) {
    const abs = hour + ahead
    const hod = ((Math.trunc(abs) % 24) + 24) % 24
    if (isAvailable(actor, hod)) return { day: Math.trunc(day) + Math.floor(abs / 24), hour: hod }
  }
  return { day: Math.trunc(day), hour: Math.trunc(hour) }
}

// ---- confirmed-plan start window (PR#14 review) ---------------------------

export type StartWindowKind = 'ok' | 'too_early' | 'expired' | 'active' | 'not_accepted'
export interface StartWindowResult {
  startable: boolean
  kind: StartWindowKind
  /** A readable reason to show on a disabled Start control (absent when startable). */
  reason?: string
}

const pad2 = (n: number): string => String(Math.trunc(n)).padStart(2, '0')

/**
 * Can this confirmed plan be STARTED at the current game time? Pure + deterministic.
 * The window opens {@link INVITATION_START_EARLY_HOURS} before the proposed slot and
 * closes {@link INVITATION_GRACE_HOURS} after it (the same grace
 * `reconcileMissedInvitations` uses to mark a no-show). Uses the SAME absolute-hour
 * basis as that reconciler (`trunc(day)*24 + hour`). The store revalidates with this
 * (not only the UI), and the phone disables Start with the returned reason — so a
 * future appointment can't be completed early and the no-show model can't be bypassed.
 */
export function invitationStartWindow(
  inv: Pick<SocialInvitation, 'status' | 'proposedDay' | 'proposedHour'>,
  gameDay: number,
  gameHour: number,
): StartWindowResult {
  if (inv.status === 'active') return { startable: false, kind: 'active', reason: 'In progress' }
  if (inv.status !== 'accepted') return { startable: false, kind: 'not_accepted' }
  const proposedAbs = inv.proposedDay * 24 + inv.proposedHour
  const nowAbs = Math.trunc(gameDay) * 24 + gameHour
  if (nowAbs < proposedAbs - INVITATION_START_EARLY_HOURS) {
    return { startable: false, kind: 'too_early', reason: `Available on day ${inv.proposedDay} at ${pad2(inv.proposedHour)}:00` }
  }
  if (nowAbs >= proposedAbs + INVITATION_GRACE_HOURS) {
    return { startable: false, kind: 'expired', reason: 'This plan has expired.' }
  }
  return { startable: true, kind: 'ok' }
}

/** The activity an NPC prefers to invite the player to (from their categories). */
export function preferredActivityKind(actor: SocialActor): InvitationActivityKind {
  if (actor.preferredCategories.includes('fitness')) return 'workout'
  if (actor.preferredCategories.includes('commerce')) return 'food'
  if (actor.id === 'npc_ravi_01') return 'coffee'
  if (actor.preferredCategories.includes('invite')) return 'hangout'
  return 'walk'
}

// ---- invite gating (§ scheduling: relationship + cooldown + mission) ------

const ORDER: RelationshipTier[] = ['stranger', 'acquaintance', 'friendly', 'trusted', 'close']
export function tierAtLeast(tier: RelationshipTier, min: RelationshipTier): boolean {
  return ORDER.indexOf(tier) >= ORDER.indexOf(min)
}

export interface InviteGateContext {
  tier: RelationshipTier
  /** The player is mid-mission and can't commit to plans. */
  missionBusy: boolean
  /** There is already an open (pending/suggested_later) invitation with this actor. */
  hasOpenInvitation: boolean
  /** The player already sent this actor an invitation today (anti-spam). */
  invitedToday: boolean
}

export interface InviteGateResult {
  ok: boolean
  reason?: string
}

/** Can the PLAYER invite this actor out right now? Returns a UI reason if not. */
export function canPlayerInvite(_actor: SocialActor, ctx: InviteGateContext): InviteGateResult {
  if (!tierAtLeast(ctx.tier, 'acquaintance')) return { ok: false, reason: "You don't know them well enough yet" }
  if (ctx.missionBusy) return { ok: false, reason: 'Finish what you’re doing first' }
  if (ctx.hasOpenInvitation) return { ok: false, reason: 'You already have plans pending' }
  if (ctx.invitedToday) return { ok: false, reason: 'You already reached out today' }
  return { ok: true }
}

// ---- NPC outreach eligibility (§ follow-ups) ------------------------------

/** Days of silence before a friendly contact reaches out on their own. */
const OUTREACH_SILENCE_DAYS = 2
/** Minimum days between one NPC's outreaches (cooldown). */
const OUTREACH_COOLDOWN_DAYS = 2
/** Affinity at/above which an NPC will proactively reach out. */
const OUTREACH_MIN_AFFINITY = 20

/**
 * Should this NPC proactively message the player (a deterministic "follow-up")?
 * They do when they're a warm enough contact, some quiet days have passed since
 * a meaningful interaction, and their own cooldown has elapsed. No randomness —
 * purely a function of state, so it is reproducible in tests + soak.
 */
export function npcShouldReachOut(
  _actor: SocialActor,
  rel: Relationship,
  gameDay: number,
  lastInitiatedDay: number | undefined,
): boolean {
  if (rel.affinity < OUTREACH_MIN_AFFINITY) return false
  if (rel.lastMeaningfulInteractionDay < 0) return false // never really met
  const quietDays = Math.trunc(gameDay) - rel.lastMeaningfulInteractionDay
  if (quietDays < OUTREACH_SILENCE_DAYS) return false
  const sinceLastReach = lastInitiatedDay === undefined ? Infinity : Math.trunc(gameDay) - lastInitiatedDay
  return sinceLastReach >= OUTREACH_COOLDOWN_DAYS
}

/**
 * How an NPC answers a PLAYER's invitation — deterministic from warmth +
 * availability at the proposed slot. Warm + free → yes; warm but busy, or only an
 * acquaintance → let's reschedule; otherwise a polite no. No randomness.
 */
export function decideNpcInviteResponse(tier: RelationshipTier, availableAtSlot: boolean): 'accepted' | 'declined' | 'suggested_later' {
  if (tierAtLeast(tier, 'friendly')) return availableAtSlot ? 'accepted' : 'suggested_later'
  if (tierAtLeast(tier, 'acquaintance')) return 'suggested_later'
  return 'declined'
}

/** A memory-aware outreach message token (references what they last remember). */
export function outreachToken(topMemory: MemoryEntry | undefined): string {
  if (!topMemory) return 'reach_out_generic'
  switch (topMemory.summaryToken) {
    case 'gift_liked':
      return 'reach_out_thanks_gift'
    case 'favor_done':
      return 'reach_out_thanks_favor'
    case 'hung_out':
      return 'reach_out_again'
    default:
      return 'reach_out_generic'
  }
}
