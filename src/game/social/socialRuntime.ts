/**
 * Social runtime (issue #13) — the module-singleton that OWNS live social state
 * (relationships, memories, contacts, exact-once ledger), mutated ONLY through the
 * pure event pipeline. Event-driven, never per-frame (constraint §14). Mirrors the
 * repo's feature-runtime pattern (`missionRuntime`, `commerceRuntime`): the runtime
 * is the authority; save/load + UI read through the accessors here. Global —
 * survives sector streaming; cleared on reset.
 */
import { SOCIAL_ACTORS, defaultRelationshipFor, getSocialActor } from './socialActors'
import { deriveRelationship } from './relationship'
import { applySocialEvent, defaultSocialState, type SocialEvent, type SocialEventResult, type SocialState } from './socialEvents'
import {
  addInvitation,
  markThreadRead,
  openInvitationWith,
  pendingForPlayer,
  pushMessage,
  setInvitationStatus,
  threadHas,
  totalUnread,
  unreadCount,
} from './socialMessaging'
import {
  canPlayerInvite,
  decideNpcInviteResponse,
  isAvailable,
  nextAvailableSlot,
  npcShouldReachOut,
  outreachToken,
  preferredActivityKind,
} from './socialScheduling'
import { advanceActivity, isComplete, type SocialActivity } from './socialActivities'
import {
  INVITATION_GRACE_HOURS,
  type DerivedRelationship,
  type InvitationActivityKind,
  type MemoryEntry,
  type Relationship,
  type SocialActorId,
  type SocialInvitation,
  type SocialMessage,
} from './socialTypes'

export const socialRuntime: { state: SocialState } = { state: defaultSocialState() }

/** Ingest one gameplay-derived social event through the pipeline (exact-once). */
export function ingestSocialEvent(event: SocialEvent): SocialEventResult {
  const result = applySocialEvent(socialRuntime.state, event)
  socialRuntime.state = result.state
  return result
}

export function resetSocial(): void {
  socialRuntime.state = defaultSocialState()
}

/** Replace the live state on load (already sanitized by the persistence layer). */
export function loadSocialState(state: SocialState): void {
  socialRuntime.state = state
}

// ---- read accessors (UI + observability, never mutate) -------------------

export function getRelationship(id: SocialActorId): Relationship {
  return socialRuntime.state.relationships[id] ?? defaultRelationshipFor(id)
}
export function getDerivedRelationship(id: SocialActorId): DerivedRelationship {
  return deriveRelationship(getRelationship(id))
}
export function getMemories(id: SocialActorId): readonly MemoryEntry[] {
  return socialRuntime.state.memories[id] ?? []
}
export function getContacts(): readonly SocialActorId[] {
  return socialRuntime.state.contacts
}
export function isContact(id: SocialActorId): boolean {
  return socialRuntime.state.contacts.includes(id)
}
export function hasMet(id: SocialActorId): boolean {
  return isContact(id) || (socialRuntime.state.memories[id]?.length ?? 0) > 0
}

// ---- phone: messages + invitations + scheduling (Slice 3) ----------------

/** Mint a message with an explicit persisted `seq` (the caller bumps state.msgSeq).
 *  The id is collision-safe across a reload because `seq` comes from + advances the
 *  PERSISTED counter, never a module-local one (PR#14 hardening). */
function mkMsg(actorId: SocialActorId, dir: 'in' | 'out', token: string, gameDay: number, gameHour: number, seq: number): SocialMessage {
  return { id: `m:${actorId}:${Math.trunc(gameDay)}:${dir}:${token}:${seq}`, actorId, dir, token, gameDay: Math.trunc(gameDay), gameHour, read: dir === 'out' }
}

/** The most salient stored memory for an actor (pins win), for outreach nods. */
function topMemoryOf(state: SocialState, id: SocialActorId): MemoryEntry | undefined {
  const mems = state.memories[id]
  if (!mems || mems.length === 0) return undefined
  return [...mems].sort((a, b) => (b.pinned ? 1 : 0) - (a.pinned ? 1 : 0) || b.salience - a.salience)[0]
}

export function getMessages(id: SocialActorId): readonly SocialMessage[] {
  return socialRuntime.state.messages[id] ?? []
}
export function getInvitations(): readonly SocialInvitation[] {
  return socialRuntime.state.invitations
}
export function getPendingInvitations(): SocialInvitation[] {
  return pendingForPlayer(socialRuntime.state.invitations)
}
export function getUnread(id: SocialActorId): number {
  return unreadCount(socialRuntime.state.messages[id])
}
export function getTotalUnread(): number {
  return totalUnread(socialRuntime.state.messages)
}
export function getOpenInvitationWith(id: SocialActorId): SocialInvitation | undefined {
  return openInvitationWith(socialRuntime.state.invitations, id)
}

/** Opening a conversation marks its inbound messages read. */
export function markContactRead(id: SocialActorId): void {
  const s = socialRuntime.state
  const thread = s.messages[id]
  if (!thread || unreadCount(thread) === 0) return
  socialRuntime.state = { ...s, messages: { ...s.messages, [id]: markThreadRead(thread) } }
}

/**
 * The player answers an open invitation (from either side). Accept/decline flow
 * through the ONE relationship pipeline; "suggest later" reschedules to the NPC's
 * next available slot and stays open. Posts the player's reply to the thread.
 */
export function respondToInvitation(
  id: string,
  status: 'accepted' | 'declined' | 'suggested_later',
  gameDay: number,
  gameHour: number,
): boolean {
  const inv = socialRuntime.state.invitations.find((i) => i.id === id && (i.status === 'pending' || i.status === 'suggested_later'))
  if (!inv) return false
  const actor = getSocialActor(inv.actorId)
  if (!actor) return false

  if (status === 'accepted') ingestSocialEvent({ id: `inv_accept:${id}`, kind: 'invitation_accepted', actorId: inv.actorId, gameDay, gameHour })
  else if (status === 'declined') ingestSocialEvent({ id: `inv_decline:${id}`, kind: 'invitation_declined', actorId: inv.actorId, gameDay, gameHour })
  const reslot = status === 'suggested_later' ? nextAvailableSlot(actor, gameDay, gameHour) : undefined
  const token = status === 'accepted' ? 'accept' : status === 'declined' ? 'decline' : 'later'

  const s = socialRuntime.state // fresh (ingest may have replaced it)
  socialRuntime.state = {
    ...s,
    msgSeq: s.msgSeq + 1,
    invitations: setInvitationStatus(s.invitations, id, status, reslot),
    messages: { ...s.messages, [inv.actorId]: pushMessage(s.messages[inv.actorId] ?? [], mkMsg(inv.actorId, 'out', token, gameDay, gameHour, s.msgSeq)) },
  }
  return true
}

/**
 * The player invites an actor out. Gated by relationship/cooldown/mission state;
 * the NPC answers deterministically (warmth + availability). Records the player's
 * invite + the NPC's reply in the thread and, on accept/decline, the pipeline.
 */
export function sendPlayerInvite(
  actorId: SocialActorId,
  gameDay: number,
  gameHour: number,
  opts: { activityKind?: InvitationActivityKind; missionBusy?: boolean } = {},
): { ok: boolean; reason?: string } {
  const actor = getSocialActor(actorId)
  if (!actor) return { ok: false, reason: 'Unknown contact' }
  const s0 = socialRuntime.state
  const tier = deriveRelationship(getRelationship(actorId)).tier
  const gate = canPlayerInvite(actor, {
    tier,
    missionBusy: opts.missionBusy ?? false,
    hasOpenInvitation: !!openInvitationWith(s0.invitations, actorId),
    invitedToday: s0.invitations.some((i) => i.actorId === actorId && i.source === 'player' && i.createdDay === Math.trunc(gameDay)),
  })
  if (!gate.ok) return gate

  const kind = opts.activityKind ?? preferredActivityKind(actor)
  const slot = nextAvailableSlot(actor, gameDay, gameHour)
  const response = decideNpcInviteResponse(tier, isAvailable(actor, slot.hour))
  const invId = `pinv:${actorId}:${Math.trunc(gameDay)}:${gameHour}`

  if (response === 'accepted') ingestSocialEvent({ id: `pinv_accept:${invId}`, kind: 'invitation_accepted', actorId, gameDay, gameHour })
  else if (response === 'declined') ingestSocialEvent({ id: `pinv_decline:${invId}`, kind: 'invitation_declined', actorId, gameDay, gameHour })

  const s = socialRuntime.state
  const inv: SocialInvitation = { id: invId, actorId, source: 'player', activityKind: kind, proposedDay: slot.day, proposedHour: slot.hour, status: response, createdDay: Math.trunc(gameDay) }
  const replyToken = response === 'accepted' ? 'accept' : response === 'declined' ? 'decline' : 'later'
  const t1 = pushMessage(s.messages[actorId] ?? [], mkMsg(actorId, 'out', `invite_${kind}`, gameDay, gameHour, s.msgSeq))
  const t2 = pushMessage(t1, mkMsg(actorId, 'in', replyToken, gameDay, gameHour, s.msgSeq + 1))
  socialRuntime.state = { ...s, msgSeq: s.msgSeq + 2, invitations: addInvitation(s.invitations, inv), messages: { ...s.messages, [actorId]: t2 } }
  return { ok: true }
}

// ---- social activities (Slice 4) -----------------------------------------

export function getActiveActivity(): SocialActivity | null {
  return socialRuntime.state.activeActivity
}

/** Confirmed (accepted / in-progress) plans the player can start / is doing. */
export function getConfirmedPlans(): SocialInvitation[] {
  return socialRuntime.state.invitations.filter((i) => i.status === 'accepted' || i.status === 'active')
}

/** Start a social activity (no-op if one is running). A linked invitation must be
 *  `accepted` (never restartable once completed/missed/cancelled) and flips to
 *  `active` atomically (PR#14 lifecycle). */
export function beginActivity(activity: SocialActivity): boolean {
  const s = socialRuntime.state
  if (s.activeActivity) return false
  if (activity.invitationId) {
    const inv = s.invitations.find((i) => i.id === activity.invitationId)
    if (!inv || inv.status !== 'accepted') return false
  }
  socialRuntime.state = {
    ...s,
    activeActivity: activity,
    invitations: activity.invitationId ? setInvitationStatus(s.invitations, activity.invitationId, 'active') : s.invitations,
  }
  return true
}

/**
 * Advance the active activity one step. When it reaches `done`, fire the
 * completion event through the ONE pipeline (`favor_completed` for a favor,
 * `activity_completed` otherwise) and clear it. Returns the resulting activity,
 * or null once complete. Item consumption for a favor's `deliver` step is the
 * caller's responsibility (it owns the inventory) — call this only after that
 * succeeds.
 */
export function stepActivity(gameDay: number, gameHour: number): SocialActivity | null {
  const cur = socialRuntime.state.activeActivity
  if (!cur) return null
  const next = advanceActivity(cur)
  if (isComplete(next)) {
    const kind = next.template === 'favor' ? 'favor_completed' : 'activity_completed'
    ingestSocialEvent({ id: `${next.template}_done:${next.id}`, kind, actorId: next.actorId, gameDay, gameHour })
    // Follow-up thank-you message (§6 "message after a favor / completed hangout").
    postFollowUp(next.actorId, next.template === 'favor' ? 'followup_favor' : 'followup_hangout', `fu:${next.id}`, gameDay, gameHour)
    const s = socialRuntime.state
    socialRuntime.state = {
      ...s,
      activeActivity: null,
      invitations: next.invitationId ? setInvitationStatus(s.invitations, next.invitationId, 'completed') : s.invitations,
    }
    return null
  }
  socialRuntime.state = { ...socialRuntime.state, activeActivity: next }
  return next
}

/** Post ONE bounded, exact-once incoming follow-up message (dedupe by stable id). */
function postFollowUp(actorId: SocialActorId, token: string, id: string, gameDay: number, gameHour: number): void {
  const s = socialRuntime.state
  if (threadHas(s.messages[actorId], id)) return
  const msg: SocialMessage = { id, actorId, dir: 'in', token, gameDay: Math.trunc(gameDay), gameHour, read: false }
  socialRuntime.state = { ...s, messages: { ...s.messages, [actorId]: pushMessage(s.messages[actorId] ?? [], msg) } }
}

/**
 * Post an incoming message from a named contact through the ONE messaging authority
 * (bounded, exact-once by id). The PUBLIC entry other systems (e.g. the careers
 * employer adapter, issue #15 §10) use so they never touch the message arrays or
 * relationship numbers directly — the social system stays the single owner.
 */
export function postContactMessage(actorId: SocialActorId, token: string, id: string, gameDay: number, gameHour: number): void {
  if (!getSocialActor(actorId)) return
  postFollowUp(actorId, token, id, gameDay, gameHour)
}

/** Abandon the active activity (a mild let-down: a `no_show` for a meet-up). A
 *  linked invitation flips to `cancelled` (never restartable). */
export function cancelActivity(gameDay: number, gameHour: number): void {
  const cur = socialRuntime.state.activeActivity
  if (!cur) return
  ingestSocialEvent({ id: `activity_cancel:${cur.id}`, kind: 'no_show', actorId: cur.actorId, gameDay, gameHour })
  // Follow-up "you didn't show" message (§6 message after a no-show).
  postFollowUp(cur.actorId, 'followup_noshow', `funs:${cur.id}`, gameDay, gameHour)
  const s = socialRuntime.state
  socialRuntime.state = {
    ...s,
    activeActivity: null,
    invitations: cur.invitationId ? setInvitationStatus(s.invitations, cur.invitationId, 'cancelled') : s.invitations,
  }
}

/**
 * Lazily mark ACCEPTED plans the player ignored past their arrival window as
 * `missed` — a real no-show consequence without ever starting the activity
 * (PR#14 blocker 3). Deterministic + exact-once (id keyed on the invitation);
 * called on game-time advancement / phone open, NEVER per frame. Returns the
 * count newly missed.
 */
export function reconcileMissedInvitations(gameDay: number, gameHour: number): number {
  const nowAbs = Math.trunc(gameDay) * 24 + gameHour
  const active = socialRuntime.state.activeActivity
  const due = socialRuntime.state.invitations.filter(
    (i) => i.status === 'accepted' && active?.invitationId !== i.id && nowAbs >= i.proposedDay * 24 + i.proposedHour + INVITATION_GRACE_HOURS,
  )
  for (const inv of due) {
    ingestSocialEvent({ id: `inv_missed:${inv.id}`, kind: 'no_show', actorId: inv.actorId, gameDay, gameHour })
    postFollowUp(inv.actorId, 'followup_noshow', `funs:missed:${inv.id}`, gameDay, gameHour)
    const s = socialRuntime.state
    socialRuntime.state = { ...s, invitations: setInvitationStatus(s.invitations, inv.id, 'missed') }
  }
  return due.length
}

/**
 * Lazily generate deterministic NPC follow-ups (a "check-in" message, sometimes
 * with an invitation) for every eligible contact. Called on day rollover / phone
 * open — NEVER per frame. Exact-once per NPC per day via a stable message id.
 * Returns how many new outreaches were created (0 when nothing is due).
 */
export function reconcileOutreach(gameDay: number, gameHour: number): number {
  let s = socialRuntime.state
  let created = 0
  for (const actor of SOCIAL_ACTORS) {
    const rel = s.relationships[actor.id] ?? defaultRelationshipFor(actor.id)
    if (!npcShouldReachOut(actor, rel, gameDay, s.lastInitiatedDay[actor.id])) continue
    const outId = `out:${actor.id}:${Math.trunc(gameDay)}`
    if (threadHas(s.messages[actor.id], outId)) continue

    const wantsInvite = actor.preferredCategories.includes('invite') && !openInvitationWith(s.invitations, actor.id)
    const kind = preferredActivityKind(actor)
    const token = wantsInvite ? `invite_${kind}` : outreachToken(topMemoryOf(s, actor.id))
    const msg: SocialMessage = { id: outId, actorId: actor.id, dir: 'in', token, gameDay: Math.trunc(gameDay), gameHour, read: false }

    let invitations = s.invitations
    if (wantsInvite) {
      const slot = nextAvailableSlot(actor, gameDay, gameHour)
      invitations = addInvitation(invitations, { id: `ninv:${actor.id}:${Math.trunc(gameDay)}`, actorId: actor.id, source: 'npc', activityKind: kind, proposedDay: slot.day, proposedHour: slot.hour, status: 'pending', createdDay: Math.trunc(gameDay) })
    }
    s = {
      ...s,
      messages: { ...s.messages, [actor.id]: pushMessage(s.messages[actor.id] ?? [], msg) },
      invitations,
      lastInitiatedDay: { ...s.lastInitiatedDay, [actor.id]: Math.trunc(gameDay) },
    }
    created++
  }
  socialRuntime.state = s
  return created
}

/** DEV/observability snapshot (§13): compact, bounded sizes + typed state. */
export function socialSnapshot(): {
  actors: { id: string; name: string; tier: string; hostile: boolean; afraid: boolean; rel: Relationship; memoryCount: number; contact: boolean }[]
  contactCount: number
  appliedEventCount: number
  totalMemories: number
  totalMessages: number
  unread: number
  invitationCount: number
  pendingInvitations: number
} {
  const state = socialRuntime.state
  const actors = Object.keys(state.relationships)
    .concat(state.contacts)
    .filter((id, i, arr) => arr.indexOf(id) === i)
    .sort()
    .map((id) => {
      const rel = getRelationship(id)
      const d = deriveRelationship(rel)
      return {
        id,
        name: getSocialActor(id)?.displayName ?? id,
        tier: d.tier,
        hostile: d.hostile,
        afraid: d.afraid,
        rel,
        memoryCount: state.memories[id]?.length ?? 0,
        contact: state.contacts.includes(id),
      }
    })
  return {
    actors,
    contactCount: state.contacts.length,
    appliedEventCount: state.appliedEventIds.length,
    totalMemories: Object.values(state.memories).reduce((n, m) => n + m.length, 0),
    totalMessages: Object.values(state.messages).reduce((n, m) => n + m.length, 0),
    unread: totalUnread(state.messages),
    invitationCount: state.invitations.length,
    pendingInvitations: pendingForPlayer(state.invitations).length,
  }
}
