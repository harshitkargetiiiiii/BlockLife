import { useGameStore } from '../../game/store/useGameStore'
import { dealershipListings, vehicleStockOf, vehicleTradeValue } from '../../game/vehicles/vehicleDealership'
import { getActiveVehicle, getOwnedVehicles } from '../../game/vehicles/vehicleOwnershipRuntime'
import { getVehicleDef } from '../../game/vehicles/vehicleRegistry'
import { vehicleEligibility } from '../../game/vehicles/vehicleEligibility'
import { repairQuote } from '../../game/vehicles/vehicleService'
import { WHEEL_STYLES, availableUpgradesFor, installedUpgrades } from '../../game/vehicles/vehicleCustomization'
import { cargoCapacityOf, cargoUsedOf } from '../../game/vehicles/vehicleCargo'
import { conditionBand, type OwnedVehicle } from '../../game/vehicles/vehicleOwnershipTypes'
import { getParkingAnchor } from '../../game/vehicles/parkingRegistry'
import { listStacks } from '../../game/items/inventoryService'

function locationLabel(v: OwnedVehicle): string {
  switch (v.location.kind) {
    case 'active': return 'In use — driving'
    case 'parked': return `Parked · ${getParkingAnchor(v.location.anchorId)?.district ?? 'city'}`
    case 'dealership': return 'At the dealership'
    case 'impound': return 'Impounded by police'
    case 'recovery': return 'Safe holding'
  }
}

/**
 * The canonical Garage phone app (issue #19 §4/§11). Shows your owned vehicles with their
 * condition + location and the context actions (retrieve / repair / recover / release), a Park
 * action while driving, and the City Motors dealership with per-class price + stock + eligibility,
 * Buy and Trade-in. It re-renders on `vehicleVersion` (the vehicle runtime lives outside zustand).
 * Every button calls the SAME store action production uses; all gating + money is the store's.
 */
export function PhoneGarage() {
  useGameStore((s) => s.vehicleVersion)
  useGameStore((s) => s.careerVersion) // dealership eligibility depends on career rank/skill/income
  const day = useGameStore((s) => s.stats.day)
  const money = useGameStore((s) => s.stats.money)
  const mode = useGameStore((s) => s.mode)
  const buy = useGameStore((s) => s.buyVehicle)
  const trade = useGameStore((s) => s.tradeInVehicle)
  const retrieve = useGameStore((s) => s.retrieveVehicle)
  const park = useGameStore((s) => s.parkVehicle)
  const repair = useGameStore((s) => s.repairVehicle)
  const recover = useGameStore((s) => s.recoverVehicle)
  const release = useGameStore((s) => s.releaseVehicleFromImpound)
  const install = useGameStore((s) => s.installVehicleUpgrade)
  const paint = useGameStore((s) => s.paintVehicle)
  const setWheels = useGameStore((s) => s.setVehicleWheels)
  const loadCargoAction = useGameStore((s) => s.loadVehicleCargo)
  const unloadCargoAction = useGameStore((s) => s.unloadVehicleCargo)
  const backpack = useGameStore((s) => s.inventory)

  const owned = getOwnedVehicles()
  const active = getActiveVehicle()
  // Vehicles that may be traded in (settled, empty, not the active shell / impounded).
  const tradeable = owned.filter((v) => v.location.kind === 'parked' || v.location.kind === 'recovery')

  return (
    <div className="phone-app" data-testid="phone-garage">
      <div className="phone-section-title">Your vehicles ({owned.length}/4)</div>
      {mode === 'driving' && active && (
        <div className="panel-actions">
          <button className="btn btn-small" data-testid="garage-park" onClick={() => park()}>Park here</button>
        </div>
      )}
      {owned.length === 0 && <div className="phone-card phone-muted" data-testid="garage-empty">No vehicles yet — buy one below.</div>}
      {owned.map((v) => {
        const def = getVehicleDef(v.defId)
        const quote = repairQuote(v)
        return (
          <div className="phone-card" key={v.id} data-testid={`garage-owned-${v.id}`}>
            <div className="phone-job-title">{def?.displayName ?? v.defId}{active?.id === v.id ? ' · active' : ''}</div>
            <div className="phone-job-where">{locationLabel(v)}</div>
            <div className="phone-job-details" data-testid={`garage-condition-${v.id}`}>
              Condition {v.condition}/100 · {conditionBand(v.condition)}
            </div>
            <div className="panel-actions">
              {(v.location.kind === 'parked' || v.location.kind === 'recovery') && v.condition > 0 && (
                <button className="btn btn-small" data-testid={`garage-retrieve-${v.id}`} onClick={() => retrieve(v.id)}>Drive</button>
              )}
              {quote.points > 0 && (
                <button className="btn btn-small" data-testid={`garage-repair-${v.id}`} disabled={money < quote.cost} onClick={() => repair(v.id)}>
                  Repair (${quote.cost})
                </button>
              )}
              {v.location.kind === 'impound' && (
                <button className="btn btn-small" data-testid={`garage-release-${v.id}`} onClick={() => release(v.id)}>Release from impound</button>
              )}
              {(v.location.kind === 'parked') && (
                <button className="btn btn-small" data-testid={`garage-recover-${v.id}`} onClick={() => recover(v.id)}>Send to holding</button>
              )}
            </div>
            {def && v.location.kind !== 'impound' && (
              <details className="garage-customize">
                <summary>Customize &amp; cargo · {cargoUsedOf(v)}/{cargoCapacityOf(v)} slots</summary>
                <div className="garage-paint-row" data-testid={`garage-paint-${v.id}`}>
                  {def.paintPalette.map((color) => (
                    <button
                      key={color}
                      className="garage-swatch"
                      style={{ background: color, outline: v.customization.paint === color ? '2px solid #fff' : 'none' }}
                      title={`Paint ${color}`}
                      data-testid={`garage-paint-${v.id}-${color}`}
                      onClick={() => paint(v.id, color)}
                    />
                  ))}
                </div>
                <div className="panel-actions" data-testid={`garage-wheels-${v.id}`}>
                  {WHEEL_STYLES.map((w) => (
                    <button
                      key={w.id}
                      className="btn btn-small btn-ghost"
                      data-testid={`garage-wheels-${v.id}-${w.id}`}
                      disabled={v.customization.wheels === w.id}
                      onClick={() => setWheels(v.id, w.id)}
                    >
                      {v.customization.wheels === w.id ? `✓ ${w.displayName}` : w.displayName}
                    </button>
                  ))}
                </div>
                <div className="panel-actions">
                  {availableUpgradesFor(def).map((u) => {
                    const has = installedUpgrades(v).some((i) => i.id === u.id)
                    return (
                      <button
                        key={u.id}
                        className="btn btn-small"
                        data-testid={`garage-upgrade-${v.id}-${u.id}`}
                        disabled={has || money < u.price}
                        title={u.description}
                        onClick={() => install(v.id, u.id)}
                      >
                        {has ? `✓ ${u.displayName}` : `${u.displayName} ($${u.price})`}
                      </button>
                    )
                  })}
                </div>
                <div className="panel-actions" data-testid={`garage-cargo-${v.id}`}>
                  {listStacks(v.cargo).map((row) => (
                    <button key={row.def.id} className="btn btn-small btn-ghost" data-testid={`garage-cargo-unload-${v.id}-${row.def.id}`} onClick={() => unloadCargoAction(v.id, row.def.id, 1)}>
                      ↑ {row.def.name} ×{row.quantity}
                    </button>
                  ))}
                  {listStacks(backpack).map((row) => (
                    <button key={row.def.id} className="btn btn-small btn-ghost" data-testid={`garage-cargo-load-${v.id}-${row.def.id}`} onClick={() => loadCargoAction(v.id, row.def.id, 1)}>
                      ↓ {row.def.name}
                    </button>
                  ))}
                </div>
              </details>
            )}
          </div>
        )
      })}

      <div className="phone-section-title">City Motors</div>
      {dealershipListings().map((def) => {
        const elig = vehicleEligibility(def.requirement, day)
        const stock = vehicleStockOf(def.id)
        return (
          <div className="phone-card" key={def.id} data-testid={`garage-listing-${def.id}`}>
            <div className="phone-job-title">{def.displayName} · ${def.basePrice}</div>
            <div className="phone-job-where">{def.listingDescription}</div>
            <div className="phone-job-details">
              Cargo {def.cargoCapacity} · top speed {def.tuning.maxSpeed} · {stock > 0 ? `${stock} in stock` : 'ordering in'}
            </div>
            {!elig.eligible && <div className="phone-muted" data-testid={`garage-locked-${def.id}`}>🔒 {elig.firstUnmetReason}</div>}
            <div className="panel-actions">
              <button className="btn btn-small" data-testid={`garage-buy-${def.id}`} disabled={money < def.basePrice || !elig.eligible || stock <= 0} onClick={() => buy(def.id)}>
                Buy (${def.basePrice})
              </button>
              {tradeable.map((v) => (
                <button
                  className="btn btn-small btn-ghost"
                  key={v.id}
                  data-testid={`garage-trade-${v.id}-${def.id}`}
                  disabled={!elig.eligible || stock <= 0}
                  onClick={() => trade(v.id, def.id)}
                >
                  Trade {getVehicleDef(v.defId)?.displayName ?? v.defId} (−${vehicleTradeValue(v)})
                </button>
              ))}
            </div>
          </div>
        )
      })}
    </div>
  )
}
