import { beforeEach, describe, expect, it } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import { WardrobePanel } from './WardrobePanel'
import { StoragePanel } from './StoragePanel'
import { createInitialGameState, useGameStore } from '../game/store/useGameStore'
import { APPEARANCE_PRESETS } from '../game/interiors/interiorTypes'

function openPanel(panel: 'wardrobe' | 'storage') {
  useGameStore.setState({
    ui: { panel, dialogueNpcId: null, activityId: null, activePhoneApp: 'home' as const },
  })
}

describe('WardrobePanel', () => {
  beforeEach(() => {
    useGameStore.setState(createInitialGameState())
  })

  it('renders nothing when closed', () => {
    render(<WardrobePanel />)
    expect(screen.queryByTestId('wardrobe-panel')).not.toBeInTheDocument()
  })

  it('shows all preset swatches for every outfit slot', () => {
    openPanel('wardrobe')
    render(<WardrobePanel />)
    for (const slot of ['shirtColor', 'pantsColor', 'accentColor']) {
      expect(screen.getByTestId(`wardrobe-slot-${slot}`)).toBeInTheDocument()
      for (const preset of APPEARANCE_PRESETS) {
        expect(screen.getByTestId(`swatch-${slot}-${preset.id}`)).toBeInTheDocument()
      }
    }
  })

  it('clicking a swatch updates the appearance immediately', () => {
    openPanel('wardrobe')
    render(<WardrobePanel />)
    fireEvent.click(screen.getByTestId('swatch-shirtColor-red'))
    expect(useGameStore.getState().appearance.shirtColor).toBe(
      APPEARANCE_PRESETS.find((p) => p.id === 'red')!.color,
    )
    fireEvent.click(screen.getByTestId('swatch-accentColor-purple'))
    expect(useGameStore.getState().appearance.accentColor).toBe(
      APPEARANCE_PRESETS.find((p) => p.id === 'purple')!.color,
    )
  })
})

describe('StoragePanel', () => {
  beforeEach(() => {
    useGameStore.setState(createInitialGameState())
  })

  it('deposits a storable item from the bag into the chest atomically', () => {
    useGameStore.setState({ inventory: { snack: 3 }, storage: {} })
    openPanel('storage')
    render(<StoragePanel />)
    expect(screen.getByTestId('storage-bag-snack')).toBeInTheDocument()
    fireEvent.click(screen.getByTestId('storage-bag-one-snack'))
    expect(useGameStore.getState().inventory).toEqual({ snack: 2 })
    expect(useGameStore.getState().storage).toEqual({ snack: 1 })
  })

  it('shows a quest-reserved item as locked (cannot be stored)', () => {
    useGameStore.setState({ inventory: { coffee: 1 }, storage: {} })
    openPanel('storage')
    render(<StoragePanel />)
    expect(screen.getByTestId('storage-bag-coffee')).toBeInTheDocument()
    expect(screen.queryByTestId('storage-bag-one-coffee')).toBeNull() // no deposit button
    expect(useGameStore.getState().inventory).toEqual({ coffee: 1 })
  })

  it('shows empty states for both containers', () => {
    useGameStore.setState({ inventory: {}, storage: {} })
    openPanel('storage')
    render(<StoragePanel />)
    expect(screen.getByTestId('storage-bag-empty')).toBeInTheDocument()
    expect(screen.getByTestId('storage-chest-empty')).toBeInTheDocument()
  })
})
