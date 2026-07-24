/**
 * Social save/load + additive fail-safe migration (issue #13 §12). An old save
 * simply lacks the `social` field and loads with canonical defaults; a malformed
 * social blob is sanitized field-by-field so it can never corrupt the wider save.
 * No runtime object references or streaming state are persisted; bounded arrays
 * and clamped ranges throughout; load is idempotent (no duplicate application).
 */
import { clampRelationship, defaultRelationship } from './relationship'
import { isSocialActor } from './socialActors'
import { sanitizeMemories } from './memoryLedger'
import { defaultSocialState, type SocialState } from './socialEvents'
import { loadSocialState, resetSocial, socialRuntime } from './socialRuntime'
import {
  APPLIED_EVENT_ID_MAX,
  INVITATIONS_MAX,
  MESSAGES_MAX_PER_CONTACT,
  SOCIAL_SAVE_VERSION,
  type InvitationActivityKind,
  type InvitationStatus,
  type Relationship,
  type SocialActivity,
  type SocialActivityStep,
  type SocialActivityTemplate,
  type SocialInvitation,
  type SocialMessage,
  type SocialSaveData,
} from './socialTypes'

/** Serialize the live runtime state to a bounded, reference-free save slice. */
export function serializeSocial(): SocialSaveData {
  const s = socialRuntime.state
  return {
    version: SOCIAL_SAVE_VERSION,
    relationships: { ...s.relationships },
    memories: Object.fromEntries(Object.entries(s.memories).map(([id, m]) => [id, m.map((e) => ({ ...e }))])),
    contacts: [...s.contacts],
    appliedEventIds: [...s.appliedEventIds],
    messages: Object.fromEntries(Object.entries(s.messages).map(([id, m]) => [id, m.map((e) => ({ ...e }))])),
    invitations: s.invitations.map((i) => ({ ...i })),
    lastInitiatedDay: { ...s.lastInitiatedDay },
    activeActivity: s.activeActivity ? { ...s.activeActivity } : null,
  }
}

const ACTIVITY_TEMPLATES: SocialActivityTemplate[] = ['meet', 'hangout', 'favor']
const ACTIVITY_STEPS: SocialActivityStep[] = ['travel', 'deliver', 'together', 'done']

/** Sanitize the single active activity (drop it entirely if malformed). */
function sanitizeActivity(raw: unknown): SocialActivity | null {
  if (!raw || typeof raw !== 'object') return null
  const a = raw as Record<string, unknown>
  if (typeof a.id !== 'string' || typeof a.actorId !== 'string' || !isSocialActor(a.actorId)) return null
  if (!ACTIVITY_TEMPLATES.includes(a.template as SocialActivityTemplate)) return null
  if (!ACTIVITY_STEPS.includes(a.step as SocialActivityStep)) return null
  if (!INVITATION_KINDS.includes(a.activityKind as InvitationActivityKind)) return null
  if (typeof a.venueId !== 'string' || typeof a.venueLabel !== 'string') return null
  return {
    id: a.id,
    actorId: a.actorId,
    template: a.template as SocialActivityTemplate,
    activityKind: a.activityKind as InvitationActivityKind,
    venueId: a.venueId,
    venueLabel: a.venueLabel,
    requiredItemId: typeof a.requiredItemId === 'string' ? a.requiredItemId : undefined,
    step: a.step as SocialActivityStep,
    startedDay: Number.isFinite(a.startedDay) ? Math.trunc(a.startedDay as number) : 0,
  }
}

const INVITATION_KINDS: InvitationActivityKind[] = ['coffee', 'food', 'workout', 'hangout', 'walk']
const INVITATION_STATUSES: InvitationStatus[] = ['pending', 'accepted', 'declined', 'suggested_later']

/** Sanitize one contact's message thread (drop malformed, bound the length). */
function sanitizeMessages(raw: unknown, actorId: string): SocialMessage[] {
  if (!Array.isArray(raw)) return []
  const out: SocialMessage[] = []
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue
    const m = item as Record<string, unknown>
    if (typeof m.id !== 'string' || typeof m.token !== 'string') continue
    if (m.dir !== 'in' && m.dir !== 'out') continue
    out.push({
      id: m.id,
      actorId,
      dir: m.dir,
      token: m.token,
      gameDay: Number.isFinite(m.gameDay) ? Math.trunc(m.gameDay as number) : 0,
      gameHour: Number.isFinite(m.gameHour) ? (m.gameHour as number) : 0,
      read: m.read === true,
    })
    if (out.length >= MESSAGES_MAX_PER_CONTACT) break
  }
  return out
}

/** Sanitize the invitation list (drop unknown actors/kinds/statuses, bound length). */
function sanitizeInvitations(raw: unknown): SocialInvitation[] {
  if (!Array.isArray(raw)) return []
  const out: SocialInvitation[] = []
  const seen = new Set<string>()
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue
    const i = item as Record<string, unknown>
    if (typeof i.id !== 'string' || seen.has(i.id)) continue
    if (typeof i.actorId !== 'string' || !isSocialActor(i.actorId)) continue
    if (i.source !== 'npc' && i.source !== 'player') continue
    if (!INVITATION_KINDS.includes(i.activityKind as InvitationActivityKind)) continue
    if (!INVITATION_STATUSES.includes(i.status as InvitationStatus)) continue
    seen.add(i.id)
    out.push({
      id: i.id,
      actorId: i.actorId,
      source: i.source,
      activityKind: i.activityKind as InvitationActivityKind,
      proposedDay: Number.isFinite(i.proposedDay) ? Math.trunc(i.proposedDay as number) : 0,
      proposedHour: Number.isFinite(i.proposedHour) ? Math.trunc(i.proposedHour as number) : 0,
      status: i.status as InvitationStatus,
      createdDay: Number.isFinite(i.createdDay) ? Math.trunc(i.createdDay as number) : 0,
    })
    if (out.length >= INVITATIONS_MAX) break
  }
  return out
}

function sanitizeRelationship(raw: unknown): Relationship | null {
  if (!raw || typeof raw !== 'object') return null
  const r = raw as Record<string, unknown>
  const num = (v: unknown, d: number) => (Number.isFinite(v) ? (v as number) : d)
  return clampRelationship({
    familiarity: num(r.familiarity, 0),
    affinity: num(r.affinity, 0),
    trust: num(r.trust, 0),
    fear: num(r.fear, 0),
    lastMeaningfulInteractionDay: num(r.lastMeaningfulInteractionDay, -1),
  })
}

/**
 * Fail-safe migration from an untrusted save blob to a canonical {@link SocialState}.
 * Unknown/malformed actors, relationships, memories, contacts, and event ids are
 * dropped rather than propagated. Always returns a valid state.
 */
export function sanitizeSocialSave(raw: unknown): SocialState {
  if (!raw || typeof raw !== 'object') return defaultSocialState()
  const data = raw as Partial<SocialSaveData>

  const relationships: Record<string, Relationship> = {}
  if (data.relationships && typeof data.relationships === 'object') {
    for (const [id, rel] of Object.entries(data.relationships)) {
      if (!isSocialActor(id)) continue
      const clean = sanitizeRelationship(rel)
      if (clean) relationships[id] = clean
    }
  }

  const memories: Record<string, ReturnType<typeof sanitizeMemories>> = {}
  if (data.memories && typeof data.memories === 'object') {
    for (const [id, mem] of Object.entries(data.memories)) {
      if (!isSocialActor(id)) continue
      const clean = sanitizeMemories(mem, id)
      if (clean.length > 0) memories[id] = clean
    }
  }

  const contacts = Array.isArray(data.contacts)
    ? [...new Set(data.contacts.filter((c): c is string => typeof c === 'string' && isSocialActor(c)))]
    : []

  const appliedEventIds = Array.isArray(data.appliedEventIds)
    ? data.appliedEventIds.filter((e): e is string => typeof e === 'string').slice(-APPLIED_EVENT_ID_MAX)
    : []

  const messages: Record<string, SocialMessage[]> = {}
  if (data.messages && typeof data.messages === 'object') {
    for (const [id, thread] of Object.entries(data.messages)) {
      if (!isSocialActor(id)) continue
      const clean = sanitizeMessages(thread, id)
      if (clean.length > 0) messages[id] = clean
    }
  }

  const invitations = sanitizeInvitations(data.invitations)

  const lastInitiatedDay: Record<string, number> = {}
  if (data.lastInitiatedDay && typeof data.lastInitiatedDay === 'object') {
    for (const [id, day] of Object.entries(data.lastInitiatedDay)) {
      if (isSocialActor(id) && Number.isFinite(day)) lastInitiatedDay[id] = Math.trunc(day as number)
    }
  }

  return { relationships, memories, contacts, appliedEventIds, messages, invitations, lastInitiatedDay, activeActivity: sanitizeActivity(data.activeActivity) }
}

/** Apply a save blob to the runtime (sanitized). Missing field → canonical reset. */
export function applySocialSave(raw: unknown): void {
  if (raw === undefined) {
    resetSocial()
    return
  }
  loadSocialState(sanitizeSocialSave(raw))
}

// Re-export the default for callers that want a canonical starting point.
export { defaultRelationship }
