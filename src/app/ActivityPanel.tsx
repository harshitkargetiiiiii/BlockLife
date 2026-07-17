import { useGameStore } from '../game/store/useGameStore'
import { getActionsFor } from '../game/interactables/interactionHandlers'
import { INTERACTABLE_BY_ID } from '../data/interactables'

/** Action menu for places: food truck, gym, job board, apartment. */
export function ActivityPanel() {
  const ui = useGameStore((s) => s.ui)
  const stats = useGameStore((s) => s.stats)
  const inventory = useGameStore((s) => s.inventory)
  const questStates = useGameStore((s) => s.questStates)
  const performActivityAction = useGameStore((s) => s.performActivityAction)
  const closePanel = useGameStore((s) => s.closePanel)

  if (ui.panel !== 'activity' || !ui.activityId) return null
  const def = INTERACTABLE_BY_ID[ui.activityId]
  if (!def) return null

  const actions = getActionsFor(def.kind, { stats, inventory, questStates })

  return (
    <div className="center-panel-wrap">
      <div className="center-panel activity-panel" data-testid="activity-panel">
        <div className="panel-header">
          <div className="activity-title" data-testid="activity-title">
            {def.icon} {def.name}
          </div>
          <button className="panel-close" onClick={closePanel} aria-label="Close">
            ✕
          </button>
        </div>
        <div className="panel-actions panel-actions-column">
          {actions.map((action) => (
            <button
              key={action.id}
              className="btn btn-activity"
              data-testid={`action-${action.id}`}
              disabled={action.disabled}
              title={action.disabled ? action.disabledReason : undefined}
              onClick={() => performActivityAction(action.id)}
            >
              <span className="btn-activity-label">{action.label}</span>
              <span className="btn-activity-detail">
                {action.disabled ? action.disabledReason : action.detail}
              </span>
            </button>
          ))}
        </div>
      </div>
    </div>
  )
}
