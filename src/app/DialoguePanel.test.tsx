import { beforeEach, describe, expect, it } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import { DialoguePanel } from './DialoguePanel'
import { useGameStore, createInitialGameState } from '../game/store/useGameStore'
import { COFFEE_QUEST_ID } from '../data/quests'

describe('DialoguePanel', () => {
  beforeEach(() => {
    useGameStore.setState(createInitialGameState())
  })

  it('renders nothing when no dialogue is open', () => {
    render(<DialoguePanel />)
    expect(screen.queryByTestId('dialogue-panel')).not.toBeInTheDocument()
  })

  it('shows the NPC name and dialogue text', () => {
    useGameStore.setState({
      ui: { panel: 'dialogue' as const, dialogueNpcId: 'npc_ravi_01', activityId: null, activePhoneApp: 'home' as const },
    })
    render(<DialoguePanel />)
    expect(screen.getByTestId('dialogue-npc-name')).toHaveTextContent('Ravi')
    expect(screen.getByTestId('dialogue-text')).toHaveTextContent(/coffee/i)
  })

  it('accepting the quest activates it and closes the panel', () => {
    useGameStore.setState({
      ui: { panel: 'dialogue' as const, dialogueNpcId: 'npc_ravi_01', activityId: null, activePhoneApp: 'home' as const },
    })
    render(<DialoguePanel />)
    fireEvent.click(document.querySelector('[data-action-id="accept_quest"]')!)
    expect(useGameStore.getState().questStates[COFFEE_QUEST_ID]).toBe('active')
    expect(useGameStore.getState().ui.panel).toBe('none')
  })

  it('shows other residents with a friendly line', () => {
    useGameStore.setState({
      ui: { panel: 'dialogue' as const, dialogueNpcId: 'npc_maya_01', activityId: null, activePhoneApp: 'home' as const },
    })
    render(<DialoguePanel />)
    expect(screen.getByTestId('dialogue-npc-name')).toHaveTextContent('Maya')
  })
})
