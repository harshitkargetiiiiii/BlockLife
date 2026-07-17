import { beforeEach, describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import { InteractionPrompt } from './InteractionPrompt'
import { useGameStore, createInitialGameState } from '../game/store/useGameStore'

describe('InteractionPrompt', () => {
  beforeEach(() => {
    useGameStore.setState(createInitialGameState())
  })

  it('renders nothing without an active interactable', () => {
    render(<InteractionPrompt />)
    expect(screen.queryByTestId('interaction-prompt')).not.toBeInTheDocument()
  })

  it('appears when an interactable is in range', () => {
    useGameStore.setState({ activeInteractableId: 'food_truck_01' })
    render(<InteractionPrompt />)
    const prompt = screen.getByTestId('interaction-prompt')
    expect(prompt).toHaveTextContent(/Press/)
    expect(prompt).toHaveTextContent("Maya's Snack Truck")
  })

  it('uses "talk to" phrasing for NPCs', () => {
    useGameStore.setState({ activeInteractableId: 'npc_ravi_01' })
    render(<InteractionPrompt />)
    expect(screen.getByTestId('interaction-prompt')).toHaveTextContent(/talk to/)
  })

  it('offers to exit the car while driving', () => {
    useGameStore.setState({ mode: 'driving' })
    render(<InteractionPrompt />)
    expect(screen.getByTestId('interaction-prompt')).toHaveTextContent(/exit the car/)
  })

  it('hides while a panel is open', () => {
    useGameStore.setState({
      activeInteractableId: 'food_truck_01',
      ui: { panel: 'activity' as const, dialogueNpcId: null, activityId: 'food_truck_01', activePhoneApp: 'home' as const },
    })
    render(<InteractionPrompt />)
    expect(screen.queryByTestId('interaction-prompt')).not.toBeInTheDocument()
  })
})
