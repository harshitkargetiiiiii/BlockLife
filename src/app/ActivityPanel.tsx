import { useGameStore } from '../game/store/useGameStore'
import { getActionsFor } from '../game/interactables/interactionHandlers'
import { INTERACTABLE_BY_ID } from '../data/interactables'
import { careerActivityBenefits } from '../game/careers/careerBenefits'

/** Action menu for places: food truck, gym, job board, apartment. */
export function ActivityPanel() {
  const ui = useGameStore((s) => s.ui)
  const stats = useGameStore((s) => s.stats)
  const inventory = useGameStore((s) => s.inventory)
  const questStates = useGameStore((s) => s.questStates)
  const performActivityAction = useGameStore((s) => s.performActivityAction)
  const closePanel = useGameStore((s) => s.closePanel)
  // Re-render on relationship + career-unlock changes so prices/gates show live.
  useGameStore((s) => s.socialVersion)
  useGameStore((s) => s.careerVersion)

  if (ui.panel !== 'activity' || !ui.activityId) return null
  const def = INTERACTABLE_BY_ID[ui.activityId]
  if (!def) return null

  // The SAME benefits drive display here and execution in the store, so a shown price
  // or gate can never disagree with what's charged/allowed (§8, R4): Maya's loyalty +
  // Café staff discount on food prices; gym free access on the Train gate.
  const benefits = careerActivityBenefits()
  const foodDiscount = def.kind === 'food_truck' ? benefits.foodDiscountPct : 0
  const actions = getActionsFor(def.kind, { stats, inventory, questStates }, foodDiscount, { gymFreeAccess: benefits.gymFreeAccess })

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
