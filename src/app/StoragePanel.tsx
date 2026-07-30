import { useGameStore } from '../game/store/useGameStore'
import { listStacks, occupiedSlots, BACKPACK_CAPACITY } from '../game/items/inventoryService'
import { effectiveStorageCapacity } from '../game/housing/housingRuntime'
import type { ResolvedStack } from '../game/items/itemTypes'

/**
 * Apartment storage: a real two-container transfer UI (Personal Economy v1).
 * The bag and the chest are shown side by side; deposit/withdraw move exactly
 * one (or the whole stack), atomically, through the item service — quest-reserved
 * items stay on the player and can't be stored.
 */

function Row({
  stack,
  action,
  actionLabel,
  allLabel,
  side,
}: {
  stack: ResolvedStack
  action: (id: string, qty?: number | 'all') => void
  actionLabel: string
  allLabel: string
  side: 'bag' | 'storage'
}) {
  const blocked = side === 'bag' && (stack.def.questReserved || !stack.def.storable)
  return (
    <li className="storage-row" data-testid={`storage-${side}-${stack.def.id}`}>
      <span className="storage-row-icon" aria-hidden>{stack.def.icon}</span>
      <span className="storage-row-name">
        {stack.def.name} <span className="storage-row-qty">× {stack.quantity}</span>
      </span>
      {blocked ? (
        <span className="storage-row-lock" title="Has to stay on you">🔒</span>
      ) : (
        <span className="storage-row-actions">
          <button
            className="btn btn-tiny"
            data-testid={`storage-${side}-one-${stack.def.id}`}
            aria-label={`${actionLabel} one ${stack.def.name}`}
            onClick={() => action(stack.def.id, 1)}
          >
            {actionLabel}
          </button>
          <button
            className="btn btn-tiny"
            data-testid={`storage-${side}-all-${stack.def.id}`}
            aria-label={`${allLabel} all ${stack.def.name}`}
            onClick={() => action(stack.def.id, 'all')}
          >
            {allLabel}
          </button>
        </span>
      )}
    </li>
  )
}

export function StoragePanel() {
  const open = useGameStore((s) => s.ui.panel === 'storage')
  const inventory = useGameStore((s) => s.inventory)
  const storage = useGameStore((s) => s.storage)
  const depositItem = useGameStore((s) => s.depositItem)
  const withdrawItem = useGameStore((s) => s.withdrawItem)
  const closePanel = useGameStore((s) => s.closePanel)
  useGameStore((s) => s.housingVersion) // effective capacity depends on placed storage furniture

  if (!open) return null
  const chestCapacity = effectiveStorageCapacity()
  const bag = listStacks(inventory)
  const chest = listStacks(storage)

  return (
    <div className="center-panel-wrap">
      <div className="center-panel storage-panel" data-testid="storage-panel" role="dialog" aria-label="Apartment storage">
        <div className="panel-header">
          <div className="activity-title">📦 Storage Chest</div>
          <button className="panel-close" onClick={closePanel} aria-label="Close">
            ✕
          </button>
        </div>
        <div className="storage-columns">
          <section className="storage-col" aria-label="Backpack">
            <div className="phone-section-title">
              🎒 Bag <span className="storage-cap" data-testid="storage-bag-cap">{occupiedSlots(inventory)}/{BACKPACK_CAPACITY}</span>
            </div>
            {bag.length === 0 ? (
              <div className="panel-muted" data-testid="storage-bag-empty">Bag is empty.</div>
            ) : (
              <ul className="storage-list">
                {bag.map((st) => (
                  <Row key={st.def.id} stack={st} action={depositItem} actionLabel="Store" allLabel="All" side="bag" />
                ))}
              </ul>
            )}
          </section>
          <section className="storage-col" aria-label="Storage chest">
            <div className="phone-section-title">
              🗄️ Chest <span className="storage-cap" data-testid="storage-chest-cap">{occupiedSlots(storage)}/{chestCapacity}</span>
            </div>
            {chest.length === 0 ? (
              <div className="panel-muted" data-testid="storage-chest-empty">Chest is empty.</div>
            ) : (
              <ul className="storage-list">
                {chest.map((st) => (
                  <Row key={st.def.id} stack={st} action={withdrawItem} actionLabel="Take" allLabel="All" side="storage" />
                ))}
              </ul>
            )}
          </section>
        </div>
        <div className="panel-muted">Stash what you don't need to carry.</div>
      </div>
    </div>
  )
}
