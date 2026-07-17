/** Where the player currently is. City is the default outdoor world. */
export type PlayerLocationMode = 'city' | 'apartment'

/**
 * Outfit colors applied to the player mesh (city and apartment alike).
 * Purely cosmetic — never affects gameplay.
 */
export interface PlayerAppearance {
  shirtColor: string
  pantsColor: string
  accentColor: string
}

/** Matches the original hard-coded player look, so old saves change nothing. */
export const DEFAULT_APPEARANCE: PlayerAppearance = {
  shirtColor: '#f4a259',
  pantsColor: '#3d405b',
  accentColor: '#5c4033',
}

/** Wardrobe preset swatches (label → css color). */
export const APPEARANCE_PRESETS: { id: string; label: string; color: string }[] = [
  { id: 'blue', label: 'Blue', color: '#4a7fd4' },
  { id: 'red', label: 'Red', color: '#d1495b' },
  { id: 'green', label: 'Green', color: '#6a994e' },
  { id: 'yellow', label: 'Yellow', color: '#f2b263' },
  { id: 'black', label: 'Black', color: '#2b2d33' },
  { id: 'white', label: 'White', color: '#e8e4da' },
  { id: 'purple', label: 'Purple', color: '#9a5fc0' },
  { id: 'orange', label: 'Orange', color: '#e07a5f' },
]

export function isPlayerAppearance(v: unknown): v is PlayerAppearance {
  if (typeof v !== 'object' || v === null) return false
  const a = v as Record<string, unknown>
  return (
    typeof a.shirtColor === 'string' &&
    typeof a.pantsColor === 'string' &&
    typeof a.accentColor === 'string'
  )
}
