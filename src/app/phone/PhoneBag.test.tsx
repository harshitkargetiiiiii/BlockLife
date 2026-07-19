import { beforeEach, describe, expect, it } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import { PhoneBag } from './PhoneBag'
import { useGameStore, createInitialGameState } from '../../game/store/useGameStore'

describe('PhoneBag', () => {
  beforeEach(() => useGameStore.setState({ ...createInitialGameState() }))

  it('shows an empty state', () => {
    render(<PhoneBag />)
    expect(screen.getByTestId('phone-bag-empty')).toBeInTheDocument()
  })

  it('lists items with effect summaries and a Use action', () => {
    useGameStore.setState({ inventory: { snack: 3, first_aid: 1 } })
    render(<PhoneBag />)
    expect(screen.getByTestId('phone-bag-cap')).toHaveTextContent('2/10')
    expect(screen.getByTestId('bag-item-snack')).toHaveTextContent('−12 hunger')
    // Using a snack reduces hunger (starts at 20) and consumes one.
    fireEvent.click(screen.getByTestId('bag-use-snack'))
    expect(useGameStore.getState().inventory.snack).toBe(2)
    expect(useGameStore.getState().stats.hunger).toBe(8)
  })

  it('shows a quest item as locked (no Use/Discard)', () => {
    useGameStore.setState({ inventory: { coffee: 1 } })
    render(<PhoneBag />)
    expect(screen.getByTestId('bag-locked-coffee')).toHaveTextContent('Quest')
    expect(screen.queryByTestId('bag-use-coffee')).toBeNull()
    expect(screen.queryByTestId('bag-discard-coffee')).toBeNull()
  })

  it('asks for confirmation before discarding a valuable item', () => {
    useGameStore.setState({ inventory: { first_aid: 1 } })
    render(<PhoneBag />)
    fireEvent.click(screen.getByTestId('bag-discard-first_aid'))
    // A first-aid kit ($35) is valuable → a confirm step appears, not an instant drop.
    expect(useGameStore.getState().inventory.first_aid).toBe(1)
    fireEvent.click(screen.getByTestId('bag-discard-confirm-first_aid'))
    expect(useGameStore.getState().inventory.first_aid ?? 0).toBe(0)
  })

  it('discards a cheap item immediately (no confirm)', () => {
    useGameStore.setState({ inventory: { snack: 2 } })
    render(<PhoneBag />)
    fireEvent.click(screen.getByTestId('bag-discard-snack'))
    expect(useGameStore.getState().inventory.snack).toBe(1)
  })
})
