import { useEffect } from 'react'
import { useGameStore } from '../game/store/useGameStore'

/**
 * Global non-movement keys: interact, close, phone, debug.
 * Extracted from GameShell so the bindings can be tested in isolation.
 */
export function useActionKeys(): void {
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.repeat) return
      const store = useGameStore.getState()
      switch (e.code) {
        case 'KeyE':
          store.interact()
          break
        case 'Escape':
          store.closePanel()
          break
        case 'Tab':
        // P is the fallback binding: some browser setups (extensions,
        // focus-in-chrome, macOS full-keyboard-access) swallow Tab.
        case 'KeyP':
          e.preventDefault()
          store.togglePhone()
          break
        case 'Backquote':
          store.toggleDebug()
          break
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [])
}
