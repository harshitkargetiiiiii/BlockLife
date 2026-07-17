import { beforeEach, describe, expect, it } from 'vitest'
import { render } from '@testing-library/react'
import { useActionKeys } from './useActionKeys'
import { useGameStore, createInitialGameState, isGameplayInputBlocked } from '../game/store/useGameStore'

function KeysHarness() {
  useActionKeys()
  return null
}

function press(code: string) {
  window.dispatchEvent(new KeyboardEvent('keydown', { code, bubbles: true, cancelable: true }))
}

describe('useActionKeys — phone bindings', () => {
  beforeEach(() => {
    useGameStore.setState(createInitialGameState())
  })

  it('Tab opens and closes the phone', () => {
    render(<KeysHarness />)
    press('Tab')
    expect(useGameStore.getState().ui.panel).toBe('phone')
    press('Tab')
    expect(useGameStore.getState().ui.panel).toBe('none')
  })

  it('P is a fallback phone toggle (Tab can be swallowed by the browser)', () => {
    render(<KeysHarness />)
    press('KeyP')
    expect(useGameStore.getState().ui.panel).toBe('phone')
    press('KeyP')
    expect(useGameStore.getState().ui.panel).toBe('none')
  })

  it('Escape closes the phone', () => {
    render(<KeysHarness />)
    press('Tab')
    expect(useGameStore.getState().ui.panel).toBe('phone')
    press('Escape')
    expect(useGameStore.getState().ui.panel).toBe('none')
  })

  it('gameplay input is flagged blocked exactly while the phone is open', () => {
    render(<KeysHarness />)
    expect(isGameplayInputBlocked(useGameStore.getState().ui.panel)).toBe(false)
    press('Tab')
    expect(isGameplayInputBlocked(useGameStore.getState().ui.panel)).toBe(true)
    press('Escape')
    expect(isGameplayInputBlocked(useGameStore.getState().ui.panel)).toBe(false)
    // Dialogue/activity panels do not block movement.
    expect(isGameplayInputBlocked('dialogue')).toBe(false)
    expect(isGameplayInputBlocked('activity')).toBe(false)
  })

  it('E interact is ignored while the phone is open', () => {
    render(<KeysHarness />)
    useGameStore.setState({ activeInteractableId: 'food_truck_01' })
    press('Tab')
    press('KeyE')
    // Still on the phone — no activity panel opened over it.
    expect(useGameStore.getState().ui.panel).toBe('phone')
    expect(useGameStore.getState().ui.activityId).toBeNull()
  })
})
