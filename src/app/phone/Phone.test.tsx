import { beforeEach, describe, expect, it } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import { Phone } from './Phone'
import { useGameStore, createInitialGameState } from '../../game/store/useGameStore'

function openPhone() {
  useGameStore.setState((s) => ({ ui: { ...s.ui, panel: 'phone' as const } }))
}

describe('Phone', () => {
  beforeEach(() => {
    useGameStore.setState(createInitialGameState())
  })

  it('renders nothing while closed', () => {
    render(<Phone />)
    expect(screen.queryByTestId('phone')).not.toBeInTheDocument()
  })

  it('shows status bar with day, hour and money when open', () => {
    openPhone()
    render(<Phone />)
    expect(screen.getByTestId('phone')).toBeInTheDocument()
    expect(screen.getByTestId('phone-status-clock')).toHaveTextContent('Day 1 · 08:00')
    expect(screen.getByTestId('phone-status-money')).toHaveTextContent('$50')
  })

  it('switches apps through the bottom nav', () => {
    openPhone()
    render(<Phone />)
    expect(screen.getByTestId('phone-app-home')).toBeInTheDocument()
    fireEvent.click(screen.getByTestId('phone-nav-quests'))
    expect(screen.getByTestId('phone-app-quests')).toBeInTheDocument()
    fireEvent.click(screen.getByTestId('phone-nav-map'))
    expect(screen.getByTestId('phone-app-map')).toBeInTheDocument()
    expect(useGameStore.getState().ui.activePhoneApp).toBe('map')
  })

  it('remembers the last app across close/open', () => {
    openPhone()
    render(<Phone />)
    fireEvent.click(screen.getByTestId('phone-nav-contacts'))
    fireEvent.click(screen.getByTestId('phone-close'))
    expect(useGameStore.getState().ui.panel).toBe('none')
    openPhone()
    expect(useGameStore.getState().ui.activePhoneApp).toBe('contacts')
  })
})
