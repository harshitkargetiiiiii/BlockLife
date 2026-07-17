import { useGameStore } from '../game/store/useGameStore'
import { getDialogue } from '../game/npc/DialogueSystem'
import { NPC_BY_ID } from '../data/npcs'

/** Conversation window: NPC name, current line, and contextual actions. */
export function DialoguePanel() {
  const ui = useGameStore((s) => s.ui)
  const questStates = useGameStore((s) => s.questStates)
  const npcMemory = useGameStore((s) => s.npcMemory)
  const performDialogueAction = useGameStore((s) => s.performDialogueAction)
  const closePanel = useGameStore((s) => s.closePanel)

  if (ui.panel !== 'dialogue' || !ui.dialogueNpcId) return null
  const npc = NPC_BY_ID[ui.dialogueNpcId]
  if (!npc) return null

  const dialogue = getDialogue(npc, questStates, npcMemory[npc.id])

  return (
    <div className="center-panel-wrap">
      <div className="center-panel dialogue-panel" data-testid="dialogue-panel">
        <div className="panel-header">
          <div>
            <div className="dialogue-npc-name" data-testid="dialogue-npc-name">
              {dialogue.npcName}
            </div>
            <div className="dialogue-npc-role">{dialogue.role}</div>
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
                action.id === 'close'
                  ? closePanel()
                  : performDialogueAction(npc.id, action.id)
              }
            >
              {action.label}
            </button>
          ))}
        </div>
      </div>
    </div>
  )
}
