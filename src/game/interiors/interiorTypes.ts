/**
 * Where the player currently is. City is the default outdoor world; 'apartment'
 * and 'store' are interiors (which specific store is tracked separately by
 * `currentInteriorId`). Old saves lack the field and default to 'city'.
 */
export type PlayerLocationMode = 'city' | 'apartment' | 'store'

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

/**
 * Wardrobe preset swatches (label → css color). The first eight are free; the
 * `locked` premium colours are unlocked by USING a wardrobe-unlock item bought
 * from a store (Personal Economy v1) — the unlock reuses this same palette
 * rather than introducing a new clothing/equipment renderer.
 */
export const APPEARANCE_PRESETS: { id: string; label: string; color: string; locked?: boolean }[] = [
  { id: 'blue', label: 'Blue', color: '#4a7fd4' },
  { id: 'red', label: 'Red', color: '#d1495b' },
  { id: 'green', label: 'Green', color: '#6a994e' },
  { id: 'yellow', label: 'Yellow', color: '#f2b263' },
  { id: 'black', label: 'Black', color: '#2b2d33' },
  { id: 'white', label: 'White', color: '#e8e4da' },
  { id: 'purple', label: 'Purple', color: '#9a5fc0' },
  { id: 'orange', label: 'Orange', color: '#e07a5f' },
  { id: 'teal', label: 'Teal', color: '#2a9d8f', locked: true },
  { id: 'gold', label: 'Gold', color: '#c9a227', locked: true },
]

/** Palette ids that start locked and require a wardrobe-unlock item. */
export const LOCKED_PALETTE_IDS: readonly string[] = APPEARANCE_PRESETS.filter((p) => p.locked).map(
  (p) => p.id,
)

export function isPlayerAppearance(v: unknown): v is PlayerAppearance {
  if (typeof v !== 'object' || v === null) return false
  const a = v as Record<string, unknown>
  return (
    typeof a.shirtColor === 'string' &&
    typeof a.pantsColor === 'string' &&
    typeof a.accentColor === 'string'
  )
}
