import { beforeEach, describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import { HUD } from './HUD'
import { useGameStore, createInitialGameState } from '../game/store/useGameStore'

describe('HUD', () => {
  beforeEach(() => {
    useGameStore.setState({
      ...createInitialGameState(),
      stats: {
        money: 87,
        hunger: 33,
        energy: 71,
        reputation: 12,
        strength: 4,
        day: 3,
        hour: 14.5,
      },
    })
  })

  it('renders money, hunger, energy, reputation, strength, day and hour', () => {
    render(<HUD />)
    expect(screen.getByTestId('stat-money')).toHaveTextContent('$87')
    expect(screen.getByTestId('stat-hunger')).toHaveTextContent('33')
    expect(screen.getByTestId('stat-energy')).toHaveTextContent('71')
    expect(screen.getByTestId('stat-reputation')).toHaveTextContent('12')
    expect(screen.getByTestId('stat-strength')).toHaveTextContent('4')
    expect(screen.getByTestId('stat-day')).toHaveTextContent('3')
    expect(screen.getByTestId('stat-hour')).toHaveTextContent('14:30')
  })

  it('shows the current world mood', () => {
    render(<HUD />)
    expect(screen.getByTestId('hud-mood')).toHaveTextContent('afternoon')
  })

  it('mood follows the clock', () => {
    useGameStore.setState((s) => ({ stats: { ...s.stats, hour: 22 } }))
    render(<HUD />)
    expect(screen.getByTestId('hud-mood')).toHaveTextContent('night')
  })
})
