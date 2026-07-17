import { beforeEach, describe, expect, it } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import { ActivityPanel } from './ActivityPanel'
import { useGameStore, createInitialGameState } from '../game/store/useGameStore'

function openActivity(id: string) {
  useGameStore.setState({
    ui: { panel: 'activity' as const, dialogueNpcId: null, activityId: id, activePhoneApp: 'home' as const },
  })
}

describe('ActivityPanel', () => {
  beforeEach(() => {
    useGameStore.setState(createInitialGameState())
  })

  it('renders nothing when closed', () => {
    render(<ActivityPanel />)
    expect(screen.queryByTestId('activity-panel')).not.toBeInTheDocument()
  })

  it('food truck shows buy meal and buy coffee', () => {
    openActivity('food_truck_01')
    render(<ActivityPanel />)
    expect(screen.getByTestId('action-buy_meal')).toBeInTheDocument()
    expect(screen.getByTestId('action-buy_coffee')).toBeInTheDocument()
  })

  it('gym shows train', () => {
    openActivity('gym')
    render(<ActivityPanel />)
    expect(screen.getByTestId('action-train')).toBeInTheDocument()
  })

  it('job board shows work shift', () => {
    openActivity('job_board')
    render(<ActivityPanel />)
    expect(screen.getByTestId('action-work_shift')).toBeInTheDocument()
  })

  it('the apartment bed shows sleep (Home Base v1 moved it indoors)', () => {
    openActivity('apartment_bed')
    render(<ActivityPanel />)
    expect(screen.getByTestId('action-sleep')).toBeInTheDocument()
  })

  it('buying a meal updates the store', () => {
    openActivity('food_truck_01')
    render(<ActivityPanel />)
    fireEvent.click(screen.getByTestId('action-buy_meal'))
    expect(useGameStore.getState().stats.money).toBe(40)
  })

  it('disables unaffordable actions', () => {
    useGameStore.setState((s) => ({ stats: { ...s.stats, money: 2 } }))
    openActivity('food_truck_01')
    render(<ActivityPanel />)
    expect(screen.getByTestId('action-buy_meal')).toBeDisabled()
  })
})
