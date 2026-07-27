import { beforeEach, describe, expect, it } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import { ActivityPanel } from './ActivityPanel'
import { useGameStore, createInitialGameState } from '../game/store/useGameStore'
import { careerRuntime, resetCareers } from '../game/careers/careerRuntime'

function openActivity(id: string) {
  useGameStore.setState({
    ui: { panel: 'activity' as const, dialogueNpcId: null, activityId: id, activePhoneApp: 'home' as const },
  })
}
function grantUnlock(id: string) {
  careerRuntime.state = { ...careerRuntime.state, unlocks: [...careerRuntime.state.unlocks, id] }
}

describe('ActivityPanel', () => {
  beforeEach(() => {
    useGameStore.setState(createInitialGameState())
    resetCareers()
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

  it('the job board opens Careers (not the old work-a-shift vendor)', () => {
    openActivity('job_board')
    render(<ActivityPanel />)
    expect(screen.queryByTestId('action-work_shift')).not.toBeInTheDocument()
    expect(screen.getByTestId('action-open_careers')).toBeInTheDocument()
  })

  it('the Café staff-discount unlock lowers the DISPLAYED meal price and the CHARGED amount (R4)', () => {
    grantUnlock('cafe_staff_discount') // Barista rank benefit
    openActivity('food_truck_01')
    render(<ActivityPanel />)
    // Display: MEAL_COST $10 → 10% staff discount → $9 on the button.
    expect(screen.getByTestId('action-buy_meal')).toHaveTextContent('$9')
    // Execution: buying charges the SAME $9 (50 → 41) — display and charge agree.
    fireEvent.click(screen.getByTestId('action-buy_meal'))
    expect(useGameStore.getState().stats.money).toBe(41)
  })

  it('the Gym free-access unlock enables Train even when too tired (R4)', () => {
    grantUnlock('gym_free_access') // Trainer rank benefit
    useGameStore.setState((s) => ({ stats: { ...s.stats, energy: 5 } }))
    openActivity('gym')
    render(<ActivityPanel />)
    const btn = screen.getByTestId('action-train')
    expect(btn).not.toBeDisabled() // gate waived in the UI…
    const before = useGameStore.getState().stats.strength
    fireEvent.click(btn)
    expect(useGameStore.getState().stats.strength).toBe(before + 1) // …and execution actually trains
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
