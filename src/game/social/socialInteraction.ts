/**
 * Contextual social actions (issue #13 §2 "talk, check in, gift, ask favor,
 * apologize, contextual threat"). PURE + deterministic: given an actor and a
 * snapshot of context, decide which actions are offered and what one resolves to
 * — a typed {@link SocialEvent} (fed to the ONE pipeline) plus an optional item to
 * consume and a response token the dialogue layer renders. No business logic lives
 * in strings; the numbers all live in the event effect table (§4).
 *
 * Anti-farming (§ gifts, and generally "no cheap grinding"): every
 * relationship-moving action is EXACTLY-ONCE PER NPC PER DAY via a per-day event
 * id, so spamming a button in one game-day applies once. Gifts additionally
 * consume a real catalog item through the inventory service, so they cannot be
 * free. `ask_favor` is a pure GATE here — it demonstrates the accept/refuse
 * consequence of the current relationship; the favor *activity* that actually
 * moves trust arrives in Slice 4.
 */
import { getItemDefinition } from '../items/itemCatalog'
import type { ItemStacks } from '../items/itemTypes'
import type { SocialEvent, SocialEventKind } from './socialEvents'
import type { DerivedRelationship, Relationship, SocialActor, SocialActorId } from './socialTypes'

/** The player-initiated contextual actions offered in a conversation. */
export type SocialActionId = 'talk' | 'check_in' | 'gift' | 'ask_favor' | 'apologize' | 'threaten'

/** Response tokens (dialogue templates key off these; they never carry logic). */
export type SocialResponseToken =
  | 'talk'
  | 'check_in'
  | 'gift_liked'
  | 'gift_neutral'
  | 'gift_disliked'
  | 'favor_accepted'
  | 'favor_refused'
  | 'apology_accepted'
  | 'apology_rejected'
  | 'threatened'
  | 'unavailable'

/** A snapshot of everything the resolver needs — gathered ONCE by the caller. */
export interface SocialActionContext {
  rel: Relationship
  derived: DerivedRelationship
  hasMet: boolean
  gameDay: number
  gameHour: number
  /** Real catalog item ids present in the backpack that can be gifted. */
  giftableItemIds: string[]
  /** Player currently has a weapon drawn (gates the contextual threat). */
  armed: boolean
  /** Per-day event ids already applied (exact-once anti-farm gate). */
  appliedEventIds: readonly string[]
}

/** One offered action for the UI: label + whether it can fire + an optional hint. */
export interface SocialActionOption {
  id: SocialActionId
  label: string
  enabled: boolean
  /** Short reason shown when disabled (or a hint). */
  hint?: string
}

/** Trust/tier a favor request needs before the NPC agrees (§ refusal consequence). */
const FAVOR_MIN_TRUST = 20

/** Stable per-day event id — the exact-once key that caps an action to once/day. */
export function perDayEventId(action: SocialActionId, actorId: SocialActorId, gameDay: number): string {
  return `social:${action}:${actorId}:${Math.trunc(gameDay)}`
}

function appliedToday(action: SocialActionId, actorId: SocialActorId, ctx: SocialActionContext): boolean {
  return ctx.appliedEventIds.includes(perDayEventId(action, actorId, ctx.gameDay))
}

/** Backpack items that may be gifted: discardable, non-quest-reserved, in stock. */
export function giftableBackpackItems(backpack: ItemStacks): string[] {
  const out: string[] = []
  for (const [id, qty] of Object.entries(backpack)) {
    if (qty <= 0) continue
    const def = getItemDefinition(id)
    if (def && def.discardable && !def.questReserved) out.push(id)
  }
  return out
}

/** Is there anything to apologize FOR right now? (fear, hostility, or resentment) */
function hasGrievance(ctx: SocialActionContext): boolean {
  return ctx.derived.afraid || ctx.derived.hostile || ctx.rel.fear > 0 || ctx.rel.affinity < 0
}

/**
 * The contextual action menu for this actor + context. `talk` and `gift` are
 * always offered (you can break the ice or give a gift to a stranger); `check_in`
 * and `ask_favor` need a prior meeting; `apologize` appears only when there is a
 * grievance; `threaten` only while the player is armed (the "where existing
 * systems permit" gate). Disabled actions still show with a hint so the player
 * understands the state.
 */
export function availableSocialActions(actor: SocialActor, ctx: SocialActionContext): SocialActionOption[] {
  const out: SocialActionOption[] = []

  out.push({ id: 'talk', label: 'Talk', enabled: true })

  if (ctx.hasMet) {
    out.push(
      appliedToday('check_in', actor.id, ctx)
        ? { id: 'check_in', label: 'Check in', enabled: false, hint: 'Already checked in today' }
        : { id: 'check_in', label: 'Check in', enabled: true },
    )
  }

  const gifted = appliedToday('gift', actor.id, ctx)
  out.push({
    id: 'gift',
    label: 'Give a gift',
    enabled: !gifted && ctx.giftableItemIds.length > 0,
    hint: gifted ? 'Already gave a gift today' : ctx.giftableItemIds.length === 0 ? 'Nothing to give' : undefined,
  })

  if (ctx.hasMet) {
    out.push({ id: 'ask_favor', label: 'Ask a favor', enabled: true })
  }

  if (hasGrievance(ctx)) {
    out.push(
      appliedToday('apologize', actor.id, ctx)
        ? { id: 'apologize', label: 'Apologize', enabled: false, hint: 'Already apologized today' }
        : { id: 'apologize', label: 'Apologize', enabled: true },
    )
  }

  if (ctx.armed) {
    out.push(
      appliedToday('threaten', actor.id, ctx)
        ? { id: 'threaten', label: 'Threaten', enabled: false, hint: 'Already threatened today' }
        : { id: 'threaten', label: 'Threaten', enabled: true },
    )
  }

  return out
}

/** The outcome of resolving one action: a response line token + optional effects. */
export interface SocialActionResolution {
  ok: boolean
  responseToken: SocialResponseToken
  /** The event to feed the pipeline (absent for a pure gate like a refused favor). */
  event?: SocialEvent
  /** A real catalog item to remove (qty 1) BEFORE ingesting the event (gifts). */
  consumeItemId?: string
}

function mkEvent(
  action: SocialActionId,
  kind: SocialEventKind,
  actor: SocialActor,
  ctx: SocialActionContext,
): SocialEvent {
  return {
    id: perDayEventId(action, actor.id, ctx.gameDay),
    kind,
    actorId: actor.id,
    gameDay: Math.trunc(ctx.gameDay),
    gameHour: ctx.gameHour,
  }
}

/** How the actor receives a specific gift item (like / dislike / neutral). */
export function giftReaction(actor: SocialActor, itemId: string): SocialEventKind {
  if (actor.giftLikes.includes(itemId)) return 'gift_liked'
  if (actor.giftDislikes.includes(itemId)) return 'gift_disliked'
  return 'gift_neutral'
}

/**
 * Resolve one chosen action into an effect. Deterministic and total: an action
 * that can't proceed (already done today, nothing to gift, ineligible) returns
 * `ok:false` with an `unavailable`/gate token and no event, so the caller never
 * consumes an item or half-applies. `opts.itemId` is required for `gift`.
 */
export function resolveSocialAction(
  actor: SocialActor,
  action: SocialActionId,
  ctx: SocialActionContext,
  opts: { itemId?: string } = {},
): SocialActionResolution {
  switch (action) {
    case 'talk': {
      if (appliedToday('talk', actor.id, ctx)) {
        // Flavor-only repeat: no relationship change, but still a friendly line.
        return { ok: true, responseToken: 'talk' }
      }
      return { ok: true, responseToken: 'talk', event: mkEvent('talk', 'conversation', actor, ctx) }
    }

    case 'check_in': {
      if (!ctx.hasMet || appliedToday('check_in', actor.id, ctx)) {
        return { ok: false, responseToken: 'unavailable' }
      }
      return { ok: true, responseToken: 'check_in', event: mkEvent('check_in', 'check_in', actor, ctx) }
    }

    case 'gift': {
      const itemId = opts.itemId
      if (appliedToday('gift', actor.id, ctx) || !itemId || !ctx.giftableItemIds.includes(itemId)) {
        return { ok: false, responseToken: 'unavailable' }
      }
      const kind = giftReaction(actor, itemId)
      const token: SocialResponseToken =
        kind === 'gift_liked' ? 'gift_liked' : kind === 'gift_disliked' ? 'gift_disliked' : 'gift_neutral'
      return {
        ok: true,
        responseToken: token,
        consumeItemId: itemId,
        event: mkEvent('gift', kind, actor, ctx),
      }
    }

    case 'ask_favor': {
      // Pure GATE: shows the accept/refuse consequence of the relationship. The
      // favor ACTIVITY that moves trust is Slice 4 — nothing is applied here.
      if (!ctx.hasMet) return { ok: false, responseToken: 'unavailable' }
      const willing = ctx.rel.trust >= FAVOR_MIN_TRUST || ctx.derived.tier === 'trusted' || ctx.derived.tier === 'close'
      return { ok: willing, responseToken: willing ? 'favor_accepted' : 'favor_refused' }
    }

    case 'apologize': {
      if (!hasGrievance(ctx) || appliedToday('apologize', actor.id, ctx)) {
        return { ok: false, responseToken: 'unavailable' }
      }
      // Actively hostile NPCs reject; merely afraid / upset ones accept.
      const rejected = ctx.derived.hostile
      const kind: SocialEventKind = rejected ? 'apology_rejected' : 'apology_accepted'
      return {
        ok: !rejected,
        responseToken: rejected ? 'apology_rejected' : 'apology_accepted',
        event: mkEvent('apologize', kind, actor, ctx),
      }
    }

    case 'threaten': {
      if (!ctx.armed || appliedToday('threaten', actor.id, ctx)) {
        return { ok: false, responseToken: 'unavailable' }
      }
      return { ok: true, responseToken: 'threatened', event: mkEvent('threaten', 'threatened', actor, ctx) }
    }
  }
}
