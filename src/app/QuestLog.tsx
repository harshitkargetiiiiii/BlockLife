import { useGameStore } from '../game/store/useGameStore'
import { QUEST_DEFS } from '../data/quests'

const STATE_LABELS: Record<string, string> = {
  not_started: 'New',
  active: 'Active',
  has_coffee: 'In progress',
  completed: 'Done',
}

/** Mini quest tracker pinned to the left edge. */
export function QuestLog() {
  const questStates = useGameStore((s) => s.questStates)
  const quest = QUEST_DEFS[0]
  const state = questStates[quest.id] ?? 'not_started'

  return (
    <div className="quest-log panel" data-testid="quest-log">
      <div className="quest-log-eyebrow">Quest</div>
      <div className="quest-log-header">
        <span className="quest-log-title" data-testid="quest-title">
          {quest.title}
        </span>
        <span
          className={`quest-state-chip quest-state-${state}`}
          data-testid="quest-state"
        >
          {STATE_LABELS[state]}
        </span>
      </div>
      <div className="quest-log-step" data-testid="quest-step">
        {state === 'completed' ? '✓ ' : '▸ '}
        {quest.steps[state]}
      </div>
    </div>
  )
}
