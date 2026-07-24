import { useGameStore } from '../../game/store/useGameStore'
import { NPC_DEFS } from '../../data/npcs'
import {
  getDerivedRelationship,
  getMemories,
  getOpenInvitationWith,
  getRelationship,
  getUnread,
  hasMet,
  isContact,
} from '../../game/social/socialRuntime'
import { memorySummary, invitationLabel } from '../../game/social/socialDialogue'
import type { MemoryEntry } from '../../game/social/socialTypes'

const TIER_LABEL: Record<string, string> = {
  stranger: 'Stranger',
  acquaintance: 'Acquaintance',
  friendly: 'Friend',
  trusted: 'Trusted friend',
  close: 'Close friend',
}

/** The most salient stored memory (pins first) — the "you remember…" line. */
function topMemory(id: string): MemoryEntry | undefined {
  return [...getMemories(id)].sort((a, b) => (b.pinned ? 1 : 0) - (a.pinned ? 1 : 0) || b.salience - a.salience)[0]
}

/**
 * People page — the canonical social relationships (issue #13). Each named actor
 * shows their met status, relationship tier, last meaningful moment, most salient
 * memory, unread count, and an Invite action (gated by the store). Reads the
 * social runtime; re-renders via `socialVersion`.
 */
export function PhoneContacts() {
  // Subscribe so social mutations re-render this reader (runtime is outside zustand).
  useGameStore((s) => s.socialVersion)
  const sendPlayerInvite = useGameStore((s) => s.sendPlayerInvite)

  return (
    <div className="phone-app">
      <div className="phone-section-title">People of the Block</div>
      <div className="phone-contacts" data-testid="phone-contacts">
        {NPC_DEFS.map((npc) => {
          const rel = getRelationship(npc.id)
          const derived = getDerivedRelationship(npc.id)
          const met = hasMet(npc.id)
          const contact = isContact(npc.id)
          const unread = getUnread(npc.id)
          const openInv = getOpenInvitationWith(npc.id)
          const top = topMemory(npc.id)
          const hearts = Math.max(0, Math.min(5, Math.round(rel.affinity / 20)))

          return (
            <div key={npc.id} className="phone-card phone-contact" data-testid={`phone-contact-${npc.id}`}>
              <span className="phone-avatar" style={{ background: npc.bodyColor }}>
                {npc.name[0]}
              </span>
              <div className="phone-contact-body">
                <div className="phone-contact-name">
                  {npc.name}
                  {derived.hostile && <span className="contact-flag flag-hostile"> · hostile</span>}
                  {derived.afraid && <span className="contact-flag flag-afraid"> · afraid</span>}
                  {unread > 0 && <span className="contact-unread" data-testid={`contact-unread-${npc.id}`}> {unread}</span>}
                </div>
                <div className="phone-contact-role">{npc.role}</div>
                <div className="phone-contact-meta">
                  {met ? `✓ Met · ${TIER_LABEL[derived.tier]}` : 'Not met yet'}
                  {met && hearts > 0 && <> · {'♥'.repeat(hearts)}</>}
                  {rel.lastMeaningfulInteractionDay >= 0 && <> · Day {rel.lastMeaningfulInteractionDay}</>}
                </div>
                {top && <div className="phone-contact-memory">“{memorySummary(top.summaryToken)}”</div>}
                {openInv && (
                  <div className="phone-contact-plans" data-testid={`contact-plan-${npc.id}`}>
                    📅 {invitationLabel(openInv.activityKind)} · day {openInv.proposedDay}
                    {openInv.status === 'suggested_later' ? ' (rescheduling)' : ''}
                  </div>
                )}
                {contact && (
                  <button
                    className="btn btn-small btn-social contact-invite"
                    data-testid={`contact-invite-${npc.id}`}
                    onClick={() => sendPlayerInvite(npc.id)}
                  >
                    Invite out
                  </button>
                )}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
