import { useGameStore } from '../game/store/useGameStore'
import { APPEARANCE_PRESETS, type PlayerAppearance } from '../game/interiors/interiorTypes'

const SLOTS: { key: keyof PlayerAppearance; label: string; icon: string }[] = [
  { key: 'shirtColor', label: 'Shirt', icon: '👕' },
  { key: 'pantsColor', label: 'Pants', icon: '👖' },
  { key: 'accentColor', label: 'Hair', icon: '💇' },
]

/**
 * Wardrobe & mirror: pick preset colors per outfit slot. Changes apply to the
 * player mesh immediately and persist with the save.
 */
export function WardrobePanel() {
  const open = useGameStore((s) => s.ui.panel === 'wardrobe')
  const appearance = useGameStore((s) => s.appearance)
  const setAppearance = useGameStore((s) => s.setAppearance)
  const closePanel = useGameStore((s) => s.closePanel)

  if (!open) return null

  return (
    <div className="center-panel-wrap">
      <div className="center-panel wardrobe-panel" data-testid="wardrobe-panel">
        <div className="panel-header">
          <div className="activity-title">👕 Wardrobe & Mirror</div>
          <button className="panel-close" onClick={closePanel} aria-label="Close">
            ✕
          </button>
        </div>
        {SLOTS.map((slot) => (
          <div className="wardrobe-slot" key={slot.key} data-testid={`wardrobe-slot-${slot.key}`}>
            <div className="wardrobe-slot-label">
              {slot.icon} {slot.label}
            </div>
            <div className="wardrobe-swatches">
              {APPEARANCE_PRESETS.map((preset) => (
                <button
                  key={preset.id}
                  className={`wardrobe-swatch${appearance[slot.key] === preset.color ? ' wardrobe-swatch-active' : ''}`}
                  style={{ background: preset.color }}
                  title={preset.label}
                  aria-label={`${slot.label}: ${preset.label}`}
                  data-testid={`swatch-${slot.key}-${preset.id}`}
                  onClick={() => setAppearance({ [slot.key]: preset.color })}
                />
              ))}
            </div>
          </div>
        ))}
        <div className="panel-muted">Looking sharp. Changes are saved with your game.</div>
      </div>
    </div>
  )
}
