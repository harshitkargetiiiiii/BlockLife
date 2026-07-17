import { beforeEach, describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import { QuestLog } from './QuestLog'
import { useGameStore, createInitialGameState } from '../game/store/useGameStore'
import { COFFEE_QUEST_ID } from '../data/quests'

describe('QuestLog', () => {
  beforeEach(() => {
    useGameStore.setState(createInitialGameState())
  })

  it('shows the quest title and the current step', () => {
    render(<QuestLog />)
    expect(screen.getByTestId('quest-title')).toHaveTextContent('Coffee for Ravi')
    expect(screen.getByTestId('quest-step')).toHaveTextContent(/Talk to Ravi/)
  })

  it('updates the step as the quest progresses', () => {
    useGameStore.setState({ questStates: { [COFFEE_QUEST_ID]: 'active' } })
    render(<QuestLog />)
    expect(screen.getByTestId('quest-step')).toHaveTextContent(/Buy a coffee/)
  })

  it('shows the completed state', () => {
    useGameStore.setState({ questStates: { [COFFEE_QUEST_ID]: 'completed' } })
    render(<QuestLog />)
    expect(screen.getByTestId('quest-state')).toHaveTextContent('Done')
    expect(screen.getByTestId('quest-step')).toHaveTextContent(/Completed/)
  })
})
