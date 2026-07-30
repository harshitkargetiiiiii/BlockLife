import { useGameStore } from '../game/store/useGameStore'
import { FURNITURE_DEFS, getFurnitureDef } from '../game/housing/furnitureCatalog'
import { getAsset, getCurrentPropertyId, getPlacements, getStoredAssetIds } from '../game/housing/housingRuntime'
import { getProperty, getPropertySlots, slotAccepts } from '../game/housing/propertyRegistry'
import { canBuyFurniture } from '../game/housing/housingCommerce'
import type { FurnitureDef, SlotDef } from '../game/housing/housingTypes'

/**
 * Production Furnish mode (issue #17 §6). A DOM panel shown while inside the current
 * home. Buy furniture (money through the economy), then place / rotate / move /
 * replace / store owned pieces into authored slots. Every button calls the SAME
 * store action the DEV hooks use; the 3D placed-furniture renderer updates on the
 * resulting `housingVersion` bump. Leaving (Done) clears the slot selection.
 */
export function FurnishPanel() {
  const open = useGameStore((s) => s.ui.panel === 'furnish')
  useGameStore((s) => s.housingVersion) // re-render on every place/move/buy/store
  const money = useGameStore((s) => s.stats.money)
  const selectedSlot = useGameStore((s) => s.furnishSelectedSlot)
  const buy = useGameStore((s) => s.buyFurniture)
  const place = useGameStore((s) => s.placeFurniture)
  const rotate = useGameStore((s) => s.rotateFurniture)
  const move = useGameStore((s) => s.moveFurniture)
  const store = useGameStore((s) => s.storeFurniture)
  const select = useGameStore((s) => s.selectFurnishSlot)
  const done = useGameStore((s) => s.exitFurnishMode)
  if (!open) return null

  const propertyId = getCurrentPropertyId()
  const property = getProperty(propertyId)
  const slots = getPropertySlots(propertyId)
  const placementMap = getPlacements()

  const stored = getStoredAssetIds()
    .map((assetId) => ({ assetId, def: getFurnitureDef(getAsset(assetId)?.defId ?? '') }))
    .filter((x): x is { assetId: string; def: FurnitureDef } => x.def !== undefined)

  const moveSourceAssetId = selectedSlot ? placementMap[selectedSlot] : undefined
  const moveSourceDef = moveSourceAssetId ? getFurnitureDef(getAsset(moveSourceAssetId)?.defId ?? '') : undefined

  const compatibleStored = (slot: SlotDef) => stored.filter((s) => slotAccepts(slot, s.def.category, s.def.size))

  return (
    <div className="center-panel-wrap">
      <div className="center-panel furnish-panel" data-testid="furnish-panel" role="dialog" aria-label="Furnish home">
      <div className="furnish-head">
        <h3>Furnish — {property?.displayName}</h3>
        <button className="btn btn-small" data-testid="furnish-done" onClick={() => done()}>
          Done
        </button>
      </div>

      <div className="furnish-cols">
        <div className="furnish-col">
          <div className="phone-section-title">Slots</div>
          {slots.map((slot) => {
            const placedAssetId = placementMap[slot.id]
            const placedDef = placedAssetId ? getFurnitureDef(getAsset(placedAssetId)?.defId ?? '') : undefined
            const isMoveSource = selectedSlot === slot.id
            const canMoveHere =
              !placedAssetId && moveSourceDef !== undefined && selectedSlot !== slot.id && slotAccepts(slot, moveSourceDef.category, moveSourceDef.size)
            return (
              <div key={slot.id} className="furnish-slot" data-testid={`furnish-slot-${slot.id}`}>
                <div className="furnish-slot-head">
                  {slot.room} · {slot.allowedCategories.join('/')}
                </div>
                {placedDef ? (
                  <div className="furnish-slot-body">
                    <span data-testid={`furnish-placed-${slot.id}`} data-def={placedDef.id}>
                      {placedDef.displayName}
                    </span>
                    <div className="panel-actions">
                      <button className="btn btn-tiny" data-testid={`furnish-rotate-${slot.id}`} onClick={() => rotate(slot.id)}>Rotate</button>
                      <button className="btn btn-tiny" data-testid={`furnish-store-${slot.id}`} onClick={() => store(slot.id)}>Store</button>
                      <button className="btn btn-tiny" data-testid={`furnish-move-${slot.id}`} onClick={() => select(isMoveSource ? null : slot.id)}>
                        {isMoveSource ? 'Cancel' : 'Move'}
                      </button>
                    </div>
                    {compatibleStored(slot).length > 0 && <div className="furnish-hint">Replace with:</div>}
                    {compatibleStored(slot).map((s) => (
                      <button key={s.assetId} className="btn btn-tiny" data-testid={`furnish-place-${slot.id}-${s.assetId}`} onClick={() => place(slot.id, s.assetId)}>
                        {s.def.displayName}
                      </button>
                    ))}
                  </div>
                ) : (
                  <div className="furnish-slot-body">
                    {canMoveHere && (
                      <button className="btn btn-tiny btn-social" data-testid={`furnish-moveto-${slot.id}`} onClick={() => move(selectedSlot!, slot.id)}>
                        Move here
                      </button>
                    )}
                    {compatibleStored(slot).length === 0 ? (
                      <span className="furnish-hint" data-testid={`furnish-empty-${slot.id}`}>Empty — buy a piece that fits.</span>
                    ) : (
                      <>
                        <div className="furnish-hint">Place:</div>
                        {compatibleStored(slot).map((s) => (
                          <button key={s.assetId} className="btn btn-tiny" data-testid={`furnish-place-${slot.id}-${s.assetId}`} onClick={() => place(slot.id, s.assetId)}>
                            {s.def.displayName}
                          </button>
                        ))}
                      </>
                    )}
                  </div>
                )}
              </div>
            )
          })}
        </div>

        <div className="furnish-col">
          <div className="phone-section-title">Furniture Shop</div>
          {FURNITURE_DEFS.map((def) => {
            const check = canBuyFurniture(def.id, money)
            const soldOut = !check.ok && check.reason === 'out_of_stock'
            return (
              <div key={def.id} className="furnish-shop-item">
                <span className="furnish-shop-name">{def.displayName}</span>
                <span className="furnish-shop-cat">{def.category}</span>
                {soldOut && (
                  <span className="furnish-shop-soldout phone-muted" data-testid={`furnish-soldout-${def.id}`}>Sold out</span>
                )}
                <button className="btn btn-tiny btn-social" data-testid={`furnish-buy-${def.id}`} disabled={!check.ok} onClick={() => buy(def.id)}>
                  ${def.price}
                </button>
              </div>
            )
          })}
        </div>
      </div>
      </div>
    </div>
  )
}
