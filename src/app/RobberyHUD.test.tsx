import { beforeEach, describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import { RobberyHUD } from './RobberyHUD'
import { useGameStore, createInitialGameState } from '../game/store/useGameStore'
import type { ActivityView } from '../game/criminalActivities/activityTypes'

function setView(over: Partial<ActivityView>) {
  useGameStore.setState({
    activityView: {
      storeId: null,
      storeTitle: null,
      phase: 'idle',
      cashierPhase: 'calm',
      threatProgress: 0,
      canLoot: false,
      alarmArmed: false,
      unsecuredProceeds: 0,
      canSecure: false,
      containmentPhase: 'none',
      breachSeconds: null,
      result: null,
      ...over,
    },
  })
}

describe('RobberyHUD — containment warning', () => {
  beforeEach(() => useGameStore.setState({ ...createInitialGameState() }))

  it('shows nothing containment-related when phase is none', () => {
    setView({ containmentPhase: 'none' })
    render(<RobberyHUD />)
    expect(screen.queryByTestId('robbery-containment')).toBeNull()
  })

  it('warns while police are responding', () => {
    setView({ containmentPhase: 'responding' })
    render(<RobberyHUD />)
    expect(screen.getByTestId('robbery-containment')).toBeInTheDocument()
    expect(screen.getByTestId('robbery-containment-line').textContent).toMatch(/inbound|out/i)
  })

  it('shows a breach countdown in the warning phase', () => {
    setView({ containmentPhase: 'warning', breachSeconds: 3.2 })
    render(<RobberyHUD />)
    const line = screen.getByTestId('robbery-containment-line')
    expect(line.textContent).toMatch(/4s/) // ceil(3.2) = 4
    expect(screen.getByTestId('robbery-containment').className).toContain('robbery-containment-warning')
  })

  it('hides the panel again once breached (player ejected to the street)', () => {
    setView({ containmentPhase: 'breached' })
    render(<RobberyHUD />)
    expect(screen.queryByTestId('robbery-containment')).toBeNull()
  })

  it('still shows the unsecured-proceeds badge independent of containment', () => {
    setView({ unsecuredProceeds: 140, containmentPhase: 'contained' })
    render(<RobberyHUD />)
    expect(screen.getByTestId('robbery-proceeds-amount')).toHaveTextContent('$140')
    expect(screen.getByTestId('robbery-containment')).toBeInTheDocument()
  })
})
