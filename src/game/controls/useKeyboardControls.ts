import { useEffect } from 'react'

export interface MovementKeys {
  forward: boolean
  back: boolean
  left: boolean
  right: boolean
  run: boolean
}

// Shared movement key state, read every frame by player/vehicle controllers.
// A module singleton (not React state) because it changes at input speed.
const keys: MovementKeys = { forward: false, back: false, left: false, right: false, run: false }

export function getMovementKeys(): MovementKeys {
  return keys
}

/** Test helper: set key state directly (used by unit tests, not gameplay). */
export function setMovementKey(key: keyof MovementKeys, value: boolean): void {
  keys[key] = value
}

/**
 * Edge-triggered combat intents, queued on key-down and drained once per frame
 * by the weapon component. Separate from movement so the two never interfere.
 */
export interface CombatInput {
  fireQueued: boolean
  drawHolsterToggleQueued: boolean
  reloadQueued: boolean
}
const combatInput: CombatInput = {
  fireQueued: false,
  drawHolsterToggleQueued: false,
  reloadQueued: false,
}

export function getCombatInput(): CombatInput {
  return combatInput
}

/** Drain the queued combat edges (call after reading them each frame). */
export function clearCombatEdges(): void {
  combatInput.fireQueued = false
  combatInput.drawHolsterToggleQueued = false
  combatInput.reloadQueued = false
}

function applyKey(code: string, down: boolean): void {
  switch (code) {
    case 'KeyW':
    case 'ArrowUp':
      keys.forward = down
      break
    case 'KeyS':
    case 'ArrowDown':
      keys.back = down
      break
    case 'KeyA':
    case 'ArrowLeft':
      keys.left = down
      break
    case 'KeyD':
    case 'ArrowRight':
      keys.right = down
      break
    case 'ShiftLeft':
    case 'ShiftRight':
      keys.run = down
      break
  }
}

/** Attach global movement listeners. Mount once (GameShell). */
export function useKeyboardControls(): void {
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      // Arrows scroll the page; keep the diorama still.
      if (e.code.startsWith('Arrow')) e.preventDefault()
      if (e.repeat) {
        applyKey(e.code, true)
        return
      }
      // Combat intents are edge-triggered (one action per key press).
      switch (e.code) {
        case 'Space':
          e.preventDefault() // Space would scroll the page.
          combatInput.fireQueued = true
          break
        case 'KeyF':
          combatInput.drawHolsterToggleQueued = true
          break
        case 'KeyR':
          combatInput.reloadQueued = true
          break
      }
      applyKey(e.code, true)
    }
    const onKeyUp = (e: KeyboardEvent) => applyKey(e.code, false)
    const onBlur = () => {
      keys.forward = keys.back = keys.left = keys.right = keys.run = false
    }
    window.addEventListener('keydown', onKeyDown)
    window.addEventListener('keyup', onKeyUp)
    window.addEventListener('blur', onBlur)
    return () => {
      window.removeEventListener('keydown', onKeyDown)
      window.removeEventListener('keyup', onKeyUp)
      window.removeEventListener('blur', onBlur)
    }
  }, [])
}
