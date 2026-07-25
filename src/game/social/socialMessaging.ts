/**
 * Pure reducers for the phone's social messaging + invitations (issue #13 §phone).
 * Every operation returns NEW arrays/records (replay + save safe), keeps threads
 * bounded, and stores only template TOKENS — never free text. No logic about WHO
 * reaches out lives here (that is `socialScheduling.npcShouldReachOut`); this file
 * only records + mutates the bounded state.
 */
import {
  INVITATIONS_MAX,
  MESSAGES_MAX_PER_CONTACT,
  type InvitationStatus,
  type SocialActorId,
  type SocialInvitation,
  type SocialMessage,
} from './socialTypes'

// ---- messages -------------------------------------------------------------

/** Append a message to a contact's thread, trimming the oldest past the cap. */
export function pushMessage(thread: readonly SocialMessage[], msg: SocialMessage, max = MESSAGES_MAX_PER_CONTACT): SocialMessage[] {
  const next = [...thread, msg]
  return next.length > max ? next.slice(next.length - max) : next
}

/** True if this exact message id already exists (idempotent outreach guard). */
export function threadHas(thread: readonly SocialMessage[] | undefined, id: string): boolean {
  return !!thread?.some((m) => m.id === id)
}

/** Mark every inbound message in a thread as read (opening the conversation). */
export function markThreadRead(thread: readonly SocialMessage[]): SocialMessage[] {
  return thread.map((m) => (m.dir === 'in' && !m.read ? { ...m, read: true } : m))
}

/** Unread inbound messages in one thread. */
export function unreadCount(thread: readonly SocialMessage[] | undefined): number {
  return thread?.reduce((n, m) => n + (m.dir === 'in' && !m.read ? 1 : 0), 0) ?? 0
}

/** Total unread across every thread (the phone badge). */
export function totalUnread(messages: Record<SocialActorId, SocialMessage[]>): number {
  let n = 0
  for (const thread of Object.values(messages)) n += unreadCount(thread)
  return n
}

// ---- invitations ----------------------------------------------------------

/** An invitation is "open" while it still needs a decision or a reschedule. */
export function isOpen(inv: SocialInvitation): boolean {
  return inv.status === 'pending' || inv.status === 'suggested_later'
}

/** The current open invitation with an actor (at most one), if any. */
export function openInvitationWith(invitations: readonly SocialInvitation[], actorId: SocialActorId): SocialInvitation | undefined {
  return invitations.find((i) => i.actorId === actorId && isOpen(i))
}

/** All pending invitations awaiting the PLAYER's decision (incoming from NPCs). */
export function pendingForPlayer(invitations: readonly SocialInvitation[]): SocialInvitation[] {
  return invitations.filter((i) => i.source === 'npc' && i.status === 'pending')
}

/**
 * Add an invitation, keeping the list bounded. When full, the oldest RESOLVED
 * (non-open) invitation is dropped first so pending plans are never silently lost;
 * only if all are open does the oldest overall go.
 */
export function addInvitation(invitations: readonly SocialInvitation[], inv: SocialInvitation, max = INVITATIONS_MAX): SocialInvitation[] {
  const next = [...invitations, inv]
  if (next.length <= max) return next
  const resolvedIdx = next.findIndex((i) => !isOpen(i))
  const dropIdx = resolvedIdx >= 0 ? resolvedIdx : 0
  return next.filter((_, i) => i !== dropIdx)
}

/**
 * Set an invitation's status. `suggested_later` reschedules to a new proposed
 * slot (kept open); accept/decline resolve it. Unknown id → unchanged.
 */
export function setInvitationStatus(
  invitations: readonly SocialInvitation[],
  id: string,
  status: InvitationStatus,
  reslot?: { day: number; hour: number },
): SocialInvitation[] {
  return invitations.map((i) =>
    i.id === id
      ? { ...i, status, ...(reslot ? { proposedDay: reslot.day, proposedHour: reslot.hour } : {}) }
      : i,
  )
}
