import { useGameStore } from '../game/store/useGameStore'
import { INTERACTABLE_BY_ID } from '../data/interactables'

/** "Press E ..." helper shown whenever something interactable is in range. */
export function InteractionPrompt() {
  const activeId = useGameStore((s) => s.activeInteractableId)
  const mode = useGameStore((s) => s.mode)
  const panel = useGameStore((s) => s.ui.panel)

  if (panel !== 'none') return null

  if (mode === 'driving') {
    return (
      <div className="interaction-prompt" data-testid="interaction-prompt">
        Press <kbd>E</kbd> to exit the car
      </div>
    )
  }

  if (!activeId) return null
  const def = INTERACTABLE_BY_ID[activeId]
  if (!def) return null

  const verb = def.kind === 'npc' ? 'talk to' : def.kind === 'vehicle' ? 'drive' : 'interact with'
  return (
    <div className="interaction-prompt" data-testid="interaction-prompt">
      {def.icon && <span className="prompt-icon">{def.icon}</span>}
      Press <kbd>E</kbd> to {verb} <strong>{def.name}</strong>
    </div>
  )
}
