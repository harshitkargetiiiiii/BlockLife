import { useGameStore } from '../../game/store/useGameStore'
import { QUEST_DEFS } from '../../data/quests'
import type { QuestState } from '../../game/quests/questTypes'

const QUEST_STEPS: { state: QuestState; label: string }[] = [
  { state: 'not_started', label: 'Talk to Ravi' },
  { state: 'active', label: 'Buy coffee from Maya' },
  { state: 'has_coffee', label: 'Return the coffee to Ravi' },
]

const ORDER: QuestState[] = ['not_started', 'active', 'has_coffee', 'completed']

export function PhoneQuests() {
  const questStates = useGameStore((s) => s.questStates)

  return (
    <div className="phone-app">
      <div className="phone-section-title">Quests</div>
      {QUEST_DEFS.map((quest) => {
        const state = questStates[quest.id] ?? 'not_started'
        const progress = ORDER.indexOf(state)
        const done = state === 'completed'
        return (
          <div key={quest.id} className="phone-card phone-quest" data-testid={`phone-quest-${quest.id}`}>
            <div className="phone-quest-header">
              <span className="phone-quest-title">{quest.title}</span>
              <span
                className={`phone-quest-state ${done ? 'phone-quest-done' : ''}`}
                data-testid="phone-quest-state"
              >
                {done ? '✓ Completed' : state === 'not_started' ? 'New' : 'In progress'}
              </span>
            </div>
            <ul className="phone-quest-steps">
              {QUEST_STEPS.map((step, i) => {
                const stepDone = progress > i
                const current = progress === i
                return (
                  <li
                    key={step.state}
                    className={stepDone ? 'phone-step-done' : current ? 'phone-step-current' : ''}
                  >
                    {stepDone ? '✓' : current ? '▸' : '○'} {step.label}
                  </li>
                )
              })}
            </ul>
            <div className="phone-quest-rewards" data-testid="phone-quest-rewards">
              Rewards: +${quest.rewards.money} · +{quest.rewards.reputation} reputation
            </div>
          </div>
        )
      })}
    </div>
  )
}
