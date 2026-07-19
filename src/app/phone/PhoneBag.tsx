import { useState } from 'react'
import { useGameStore } from '../../game/store/useGameStore'
import { listStacks, occupiedSlots, BACKPACK_CAPACITY } from '../../game/items/inventoryService'
import type { ItemDefinition } from '../../game/items/itemTypes'

/**
 * Phone "Bag" surface (Personal Economy v1). Reads the reactive backpack and
 * drives Use/Discard through the item service. Discarding a valuable item asks
 * for a one-tap confirm. Keyboard accessible + screen-reader labelled.
 */

const CONFIRM_PRICE = 30 // discard confirmation for anything this valuable+

function effectSummary(def: ItemDefinition): string {
  switch (def.effect.kind) {
    case 'feed':
      return `−${def.effect.hunger} hunger`
    case 'refresh':
      return `+${def.effect.energy} energy`
    case 'heal':
      return `+${def.effect.health} health`
    case 'ammo':
      return `+${def.effect.rounds} reserve ammo`
    case 'unlock':
      return `unlocks a wardrobe colour`
    case 'none':
      return def.questReserved ? 'Quest item' : ''
  }
}

export function PhoneBag() {
  const inventory = useGameStore((s) => s.inventory)
  // Alias the store action to a NON-`use*` local: a bare `useItem(...)` call in a
  // callback trips react-hooks/rules-of-hooks (any `use*` identifier reads as a
  // Hook). Member access (`s.useItem`) is fine; a bare same-named local is not.
  const consumeItem = useGameStore((s) => s.useItem)
  const discardItem = useGameStore((s) => s.discardItem)
  const [confirming, setConfirming] = useState<string | null>(null)

  const rows = listStacks(inventory)

  return (
    <div className="phone-app" data-testid="phone-bag">
      <div className="phone-section-title">
        Bag <span className="phone-bag-cap" data-testid="phone-bag-cap">{occupiedSlots(inventory)}/{BACKPACK_CAPACITY}</span>
      </div>
      {rows.length === 0 ? (
        <div className="phone-muted" data-testid="phone-bag-empty">Your bag is empty. Buy supplies at a store.</div>
      ) : (
        <ul className="phone-bag-list">
          {rows.map(({ def, quantity }) => {
            const summary = effectSummary(def)
            const valuable = def.price >= CONFIRM_PRICE
            return (
              <li className="phone-card phone-bag-item" key={def.id} data-testid={`bag-item-${def.id}`}>
                <span className="phone-bag-icon" aria-hidden>{def.icon}</span>
                <div className="phone-bag-main">
                  <div className="phone-bag-name">
                    {def.name} <span className="phone-bag-qty">× {quantity}</span>
                  </div>
                  <div className="phone-bag-desc">{def.description}</div>
                  {summary && <div className="phone-bag-effect">{summary}</div>}
                </div>
                <div className="phone-bag-actions">
                  {def.usable && !def.questReserved ? (
                    <button
                      className="btn btn-small"
                      data-testid={`bag-use-${def.id}`}
                      onClick={() => consumeItem(def.id)}
                    >
                      Use
                    </button>
                  ) : (
                    <span className="phone-bag-locked" data-testid={`bag-locked-${def.id}`}>
                      {def.questReserved ? 'Quest' : '—'}
                    </span>
                  )}
                  {def.discardable && !def.questReserved && (
                    confirming === def.id ? (
                      <span className="phone-bag-confirm">
                        <button
                          className="btn btn-tiny btn-danger"
                          data-testid={`bag-discard-confirm-${def.id}`}
                          onClick={() => {
                            discardItem(def.id, 1)
                            setConfirming(null)
                          }}
                        >
                          Sure?
                        </button>
                        <button className="btn btn-tiny" onClick={() => setConfirming(null)}>Cancel</button>
                      </span>
                    ) : (
                      <button
                        className="btn btn-tiny"
                        data-testid={`bag-discard-${def.id}`}
                        aria-label={`Discard ${def.name}`}
                        onClick={() => (valuable ? setConfirming(def.id) : discardItem(def.id, 1))}
                      >
                        Drop
                      </button>
                    )
                  )}
                </div>
              </li>
            )
          })}
        </ul>
      )}
      <div className="phone-muted">Use items here, or stash extras in your apartment storage.</div>
    </div>
  )
}
