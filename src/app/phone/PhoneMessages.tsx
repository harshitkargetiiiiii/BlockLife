import { useGameStore } from '../../game/store/useGameStore'
import { NPC_BY_ID } from '../../data/npcs'
import type { PlayerStats } from '../../game/player/playerTypes'
import type { QuestState } from '../../game/quests/questTypes'
import { getMood } from '../../game/simulation/worldMoodSystem'
import { COFFEE_QUEST_ID } from '../../data/quests'
import { getConfirmedPlans, getContacts, getMessages, getPendingInvitations } from '../../game/social/socialRuntime'
import { getSocialActor } from '../../game/social/socialActors'
import { invitationStartWindow } from '../../game/social/socialScheduling'
import { invitationLabel, messageText } from '../../game/social/socialDialogue'

interface PhoneMessage {
  npcId: string
  text: string
}

/**
 * Deterministic flavor feed — no real messaging, no APIs. Each resident
 * "texts" one line derived from current game state. (The real, stateful social
 * threads + invitations render above this ambient feed.)
 */
export function buildMessages(
  stats: PlayerStats,
  questStates: Record<string, QuestState>,
): PhoneMessage[] {
  const mood = getMood(stats.hour)
  const quest = questStates[COFFEE_QUEST_ID] ?? 'not_started'

  const ravi: Record<QuestState, string> = {
    not_started: 'yo! swing by when you have a sec, need a tiny favor 👀',
    active: 'any luck with that coffee? ☕ maya makes the best one',
    has_coffee: 'is that coffee I smell?? bring it over!!',
    completed: "you're a legend. next one's on me 🙏",
  }

  const daytime = stats.hour >= 6 && stats.hour < 22

  return [
    { npcId: 'npc_ravi_01', text: ravi[quest] },
    {
      npcId: 'npc_maya_01',
      text: daytime
        ? "truck's open! fresh coffee + hot meals ☀️"
        : 'closing up for tonight — catch me tomorrow!',
    },
    {
      npcId: 'npc_bruno_01',
      text:
        stats.energy >= 50
          ? 'you look ready. come lift something heavy 💪'
          : 'rest up first. the gym will still be here.',
    },
    {
      npcId: 'npc_leo_01',
      text: '3 deliveries left on my loop. this block keeps me FIT',
    },
    {
      npcId: 'npc_kim_01',
      text:
        stats.reputation >= 5
          ? 'hearing good things about you around the block 👍'
          : 'all quiet tonight. keep it friendly out there.',
    },
    {
      npcId: 'npc_nisha_01',
      text:
        mood === 'night'
          ? 'the lamps by the pond look so pretty right now 🌙'
          : 'park bench by the pond. best seat on the block.',
    },
  ]
}

export function PhoneMessages() {
  const stats = useGameStore((s) => s.stats)
  const questStates = useGameStore((s) => s.questStates)
  // Re-render on social mutations (threads / invitations live outside zustand).
  useGameStore((s) => s.socialVersion)
  const respondToInvitation = useGameStore((s) => s.respondToInvitation)
  const markContactRead = useGameStore((s) => s.markContactRead)
  const startSocialActivity = useGameStore((s) => s.startSocialActivity)

  const messages = buildMessages(stats, questStates)
  const pending = getPendingInvitations()
  const confirmed = getConfirmedPlans()
  const threadedContacts = getContacts().filter((id) => getMessages(id).length > 0)

  return (
    <div className="phone-app">
      {pending.length > 0 && (
        <>
          <div className="phone-section-title">Invitations</div>
          <div className="phone-invitations" data-testid="phone-invitations">
            {pending.map((inv) => {
              const actor = getSocialActor(inv.actorId)
              const npc = NPC_BY_ID[inv.actorId]
              return (
                <div key={inv.id} className="phone-card phone-invitation" data-testid={`invitation-${inv.id}`}>
                  <div className="phone-invitation-text">
                    <strong>{actor?.displayName ?? npc?.name}</strong> wants to {invitationLabel(inv.activityKind)} — day {inv.proposedDay}
                  </div>
                  <div className="panel-actions social-actions">
                    <button className="btn btn-small btn-social" data-testid={`invite-accept-${inv.id}`} onClick={() => respondToInvitation(inv.id, 'accepted')}>
                      Accept
                    </button>
                    <button className="btn btn-small btn-ghost" data-testid={`invite-later-${inv.id}`} onClick={() => respondToInvitation(inv.id, 'suggested_later')}>
                      Later
                    </button>
                    <button className="btn btn-small btn-ghost" data-testid={`invite-decline-${inv.id}`} onClick={() => respondToInvitation(inv.id, 'declined')}>
                      Decline
                    </button>
                  </div>
                </div>
              )
            })}
          </div>
        </>
      )}

      {confirmed.length > 0 && (
        <>
          <div className="phone-section-title">Confirmed plans</div>
          <div className="phone-plans" data-testid="phone-plans">
            {confirmed.map((inv) => {
              const actor = getSocialActor(inv.actorId)
              const npc = NPC_BY_ID[inv.actorId]
              const inProgress = inv.status === 'active'
              // A plan can only be started inside its window (1h before → 3h grace).
              const win = invitationStartWindow(inv, stats.day, stats.hour)
              return (
                <div key={inv.id} className="phone-card phone-plan" data-testid={`plan-${inv.id}`}>
                  <div className="phone-invitation-text">
                    📅 {invitationLabel(inv.activityKind)} with <strong>{actor?.displayName ?? npc?.name}</strong> — day {inv.proposedDay}
                    {inProgress && <span className="plan-inprogress"> · in progress</span>}
                  </div>
                  {!inProgress && (
                    <div className="panel-actions social-actions">
                      <button
                        className="btn btn-small btn-social"
                        data-testid={`plan-start-${inv.id}`}
                        disabled={!win.startable}
                        onClick={() => startSocialActivity(inv.id)}
                      >
                        Start plan
                      </button>
                      {!win.startable && win.reason && (
                        <span className="social-action-reason" data-testid={`plan-reason-${inv.id}`}>
                          {win.reason}
                        </span>
                      )}
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        </>
      )}

      {threadedContacts.length > 0 && (
        <>
          <div className="phone-section-title">Conversations</div>
          <div className="phone-threads" data-testid="phone-threads">
            {threadedContacts.map((id) => {
              const actor = getSocialActor(id)
              const npc = NPC_BY_ID[id]
              const thread = getMessages(id)
              return (
                <div
                  key={id}
                  className="phone-card phone-thread"
                  data-testid={`phone-thread-${id}`}
                  onMouseEnter={() => markContactRead(id)}
                >
                  <div className="phone-thread-name">{actor?.displayName ?? npc?.name}</div>
                  {thread.slice(-4).map((m) => (
                    <div key={m.id} className={`phone-thread-line ${m.dir === 'out' ? 'thread-out' : 'thread-in'} ${!m.read && m.dir === 'in' ? 'thread-unread' : ''}`}>
                      {m.dir === 'out' ? 'You: ' : ''}
                      {actor ? messageText(m.token, actor, m.gameDay) : m.token}
                    </div>
                  ))}
                </div>
              )
            })}
          </div>
        </>
      )}

      <div className="phone-section-title">Around the block</div>
      <div className="phone-messages" data-testid="phone-messages">
        {messages.map((m) => {
          const npc = NPC_BY_ID[m.npcId]
          if (!npc) return null
          return (
            <div key={m.npcId} className="phone-message" data-testid={`phone-message-${m.npcId}`}>
              <span className="phone-avatar" style={{ background: npc.bodyColor }}>
                {npc.name[0]}
              </span>
              <div className="phone-message-body">
                <div className="phone-message-name">{npc.name}</div>
                <div className="phone-message-text">{m.text}</div>
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
