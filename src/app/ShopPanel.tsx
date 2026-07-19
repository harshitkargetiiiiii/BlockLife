import { useGameStore } from '../game/store/useGameStore'
import type { PurchaseFailure } from '../game/commerce/commerceTypes'

/**
 * Store Shop UI (Personal Economy v1). Reads only the bounded `shopView` mirror
 * — never the commerce runtime — and drives the atomic `buyItem` action. Shown
 * when interacting with a recovered store register during normal gameplay.
 */

const REASON: Record<PurchaseFailure, string> = {
  unknown_store: 'Unavailable',
  unknown_item: 'Unavailable',
  not_sold_here: 'Not sold here',
  store_closed: 'Store closed',
  out_of_stock: 'Out of stock',
  insufficient_funds: 'Not enough money',
  backpack_full: 'Bag full',
  item_restricted: 'Restricted',
}

export function ShopPanel() {
  const open = useGameStore((s) => s.ui.panel === 'shop')
  const view = useGameStore((s) => s.shopView)
  const buyItem = useGameStore((s) => s.buyItem)
  const closePanel = useGameStore((s) => s.closePanel)

  if (!open || !view) return null

  return (
    <div className="center-panel-wrap">
      <div className="center-panel shop-panel" data-testid="shop-panel" role="dialog" aria-label={`${view.storeName} shop`}>
        <div className="panel-header">
          <div className="activity-title">🛒 {view.storeName}</div>
          <button className="panel-close" onClick={closePanel} aria-label="Close">
            ✕
          </button>
        </div>
        <div className="shop-meta">
          <span data-testid="shop-money">💵 ${view.money}</span>
          <span data-testid="shop-capacity">🎒 {view.occupied}/{view.capacity}</span>
        </div>
        {view.closed && (
          <div className="shop-closed" data-testid="shop-closed">
            The store is closed after a recent incident.
          </div>
        )}
        <ul className="shop-list" data-testid="shop-list">
          {view.rows.map((row) => (
            <li className="shop-row" key={row.itemId} data-testid={`shop-row-${row.itemId}`}>
              <span className="shop-row-icon" aria-hidden>{row.icon}</span>
              <div className="shop-row-main">
                <div className="shop-row-name">{row.name}</div>
                <div className="shop-row-desc">{row.description}</div>
                <div className="shop-row-meta">
                  <span className="shop-row-price">${row.price}</span>
                  <span className="shop-row-stock" data-testid={`shop-stock-${row.itemId}`}>
                    {row.stock > 0 ? `${row.stock} in stock` : 'out of stock'}
                  </span>
                </div>
              </div>
              <button
                className="btn btn-small shop-buy"
                data-testid={`shop-buy-${row.itemId}`}
                disabled={!row.canBuy}
                title={row.canBuy ? `Buy ${row.name}` : (row.reason ? REASON[row.reason] : 'Unavailable')}
                onClick={() => buyItem(view.storeId, row.itemId)}
              >
                {row.canBuy ? 'Buy' : row.reason ? REASON[row.reason] : '—'}
              </button>
            </li>
          ))}
        </ul>
        <div className="panel-muted">Buying adds to your bag. Watch your carry limit.</div>
      </div>
    </div>
  )
}
