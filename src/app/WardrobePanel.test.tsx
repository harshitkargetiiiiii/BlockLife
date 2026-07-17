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

  it('shows the bag contents and the upgrade stub without touching inventory', () => {
    useGameStore.setState({ inventory: { coffee: 2 } })
    openPanel('storage')
    render(<StoragePanel />)
    expect(screen.getByTestId('storage-items')).toHaveTextContent('Coffee × 2')
    expect(screen.getByTestId('storage-stub-note')).toHaveTextContent('coming soon')
    expect(useGameStore.getState().inventory).toEqual({ coffee: 2 })
  })

  it('shows an empty state', () => {
    openPanel('storage')
    render(<StoragePanel />)
    expect(screen.getByTestId('storage-empty')).toBeInTheDocument()
  })
})
