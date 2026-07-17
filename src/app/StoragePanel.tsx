import { useGameStore } from '../game/store/useGameStore'

const ITEM_NAMES: Record<string, string> = {
  coffee: '☕ Coffee',
}

/**
 * Storage chest v1: a read-only view of the player's bag plus a teaser for
 * future upgrades. Deliberately does NOT move items — quest inventory
 * (Coffee for Ravi) must keep working exactly as before.
 */
export function StoragePanel() {
  const open = useGameStore((s) => s.ui.panel === 'storage')
  const inventory = useGameStore((s) => s.inventory)
  const closePanel = useGameStore((s) => s.closePanel)

  if (!open) return null
  const items = Object.entries(inventory).filter(([, qty]) => qty > 0)

  return (
    <div className="center-panel-wrap">
      <div className="center-panel storage-panel" data-testid="storage-panel">
        <div className="panel-header">
          <div className="activity-title">📦 Storage Chest</div>
          <button className="panel-close" onClick={closePanel} aria-label="Close">
            ✕
          </button>
        </div>
        <div className="phone-section-title">Your bag</div>
        {items.length === 0 ? (
          <div className="panel-muted" data-testid="storage-empty">
            Nothing in your bag yet.
          </div>
        ) : (
          <ul className="phone-bag" data-testid="storage-items">
            {items.map(([id, qty]) => (
              <li key={id}>
                {ITEM_NAMES[id] ?? id} × {qty}
              </li>
            ))}
          </ul>
        )}
        <div className="panel-muted" data-testid="storage-stub-note">
          Storage upgrades coming soon.
        </div>
      </div>
    </div>
  )
}
