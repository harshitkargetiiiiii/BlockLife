import { useGameStore } from '../game/store/useGameStore'
import { getDialogue } from '../game/npc/DialogueSystem'
import { NPC_BY_ID } from '../data/npcs'
import { getItemDefinition } from '../game/items/itemCatalog'
import { getActiveActivity, getDerivedRelationship, isContact } from '../game/social/socialRuntime'
import { tierAtLeast } from '../game/social/socialScheduling'
import { appearanceForId } from '../game/characters/populationAppearance'

/** Conversation window: NPC name, current line, quest actions, and — for named
 *  social actors — the contextual social menu (talk / check in / gift / favor /
 *  apologize / threaten). The social menu reads the social runtime; every action
 *  bumps a toast, which re-renders this panel so the menu reflects new state. */
export function DialoguePanel() {
  const ui = useGameStore((s) => s.ui)
  const questStates = useGameStore((s) => s.questStates)
  const npcMemory = useGameStore((s) => s.npcMemory)
  const performDialogueAction = useGameStore((s) => s.performDialogueAction)
  const performSocialAction = useGameStore((s) => s.performSocialAction)
  const getSocialMenu = useGameStore((s) => s.getSocialMenu)
  const startFavorFor = useGameStore((s) => s.startFavorFor)
  const closePanel = useGameStore((s) => s.closePanel)
  // Re-render after a social action: each one bumps the toast (and gifts change
  // inventory). Subscribing keeps the menu's enabled/disabled state live.
  useGameStore((s) => s.toast)
  useGameStore((s) => s.inventory)
  useGameStore((s) => s.socialVersion)

  if (ui.panel !== 'dialogue' || !ui.dialogueNpcId) return null
  const npc = NPC_BY_ID[ui.dialogueNpcId]
  if (!npc) return null

  const dialogue = getDialogue(npc, questStates, npcMemory[npc.id])
  const social = getSocialMenu(npc.id)
  // Issue #23: the speaker's own registry identity — the same colors their in-world
  // character wears — shown as a small avatar. Presentation only; the gameplay/social
  // id (npc.id) is the registry key and is never derived from these colors.
  const look = appearanceForId(npc.id)
  const known = isContact(npc.id)
  const relationshipTier = known ? getDerivedRelationship(npc.id).tier : null

  return (
    <div className="center-panel-wrap">
      <div className="center-panel dialogue-panel" data-testid="dialogue-panel">
        <div className="panel-header">
          <div className="dialogue-speaker">
            <div className="dialogue-avatar" data-testid="dialogue-avatar" aria-hidden="true">
              <span className="dialogue-avatar-body" style={{ background: look.shirtColor }} />
              <span
                className="dialogue-avatar-head"
                style={{ background: look.skinColor ?? '#e8b98a' }}
              />
              <span className="dialogue-avatar-hair" style={{ background: look.accentColor }} />
            </div>
            <div>
              <div className="dialogue-name-row">
                <span className="dialogue-npc-name" data-testid="dialogue-npc-name">
                  {dialogue.npcName}
                </span>
                {relationshipTier && (
                  <span className="dialogue-tier-badge" data-testid="dialogue-tier-badge">
                    {relationshipTier}
                  </span>
                )}
              </div>
              <div className="dialogue-npc-role">{dialogue.role}</div>
            </div>
          </div>
          <button className="panel-close" onClick={closePanel} aria-label="Close">
            ✕
          </button>
        </div>
        <p className="dialogue-text" data-testid="dialogue-text">
          {dialogue.text}
        </p>
        <div className="panel-actions">
          {dialogue.actions.map((action) => (
            <button
              key={action.id}
              className={action.id === 'close' ? 'btn btn-ghost' : 'btn btn-primary'}
              data-action-id={action.id}
              onClick={() =>
                action.id === 'close' ? closePanel() : performDialogueAction(npc.id, action.id)
              }
            >
              {action.label}
            </button>
          ))}
        </div>

        {social && (
          <div className="social-menu" data-testid="social-menu">
            <div className="social-menu-title">Social</div>
            <div className="panel-actions social-actions">
              {social.actions.map((action) =>
                action.id === 'gift' && action.enabled ? (
                  social.giftableItemIds.map((itemId) => {
                    const def = getItemDefinition(itemId)
                    return (
                      <button
                        key={`gift-${itemId}`}
                        className="btn btn-social"
                        data-social-action="gift"
                        data-item-id={itemId}
                        onClick={() => performSocialAction(npc.id, 'gift', { itemId })}
                      >
                        🎁 Give {def?.name ?? itemId}
                      </button>
                    )
                  })
                ) : (
                  <span key={action.id} className="social-action-wrap">
                    <button
                      className="btn btn-social"
                      data-social-action={action.id}
                      disabled={!action.enabled}
                      title={action.hint}
                      onClick={() => performSocialAction(npc.id, action.id)}
                    >
                      {action.label}
                    </button>
                    {/* §5: a readable reason for a disabled/refused action. */}
                    {!action.enabled && action.hint && (
                      <span className="social-action-reason" data-testid={`social-reason-${action.id}`}>
                        {action.hint}
                      </span>
                    )}
                  </span>
                ),
              )}
              {/* Offer to run an errand FOR a friend — starts a favor activity
                  (Slice 4). Shown only for friends, when nothing else is running. */}
              {isContact(npc.id) &&
                tierAtLeast(getDerivedRelationship(npc.id).tier, 'friendly') &&
                !getActiveActivity() && (
                  <button
                    className="btn btn-social"
                    data-social-action="offer_help"
                    onClick={() => {
                      startFavorFor(npc.id)
                      closePanel()
                    }}
                  >
                    🤝 Offer to help
                  </button>
                )}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
