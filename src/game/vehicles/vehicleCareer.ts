/**
 * Vehicle → career read-only adapter (issue #19 §10). Exposes whether the player owns a usable
 * delivery-capable vehicle and the bounded pay bonus it earns on a delivery shift. The career
 * settlement authority READS this at finalize time; vehicle ownership NEVER mutates career state,
 * and the bonus is credited exactly once through the shift's existing exact-once attempt key (no
 * free repeatable pay from entering/exiting/parking).
 */
import { getOwnedVehicles } from './vehicleOwnershipRuntime'
import { getVehicleDef } from './vehicleRegistry'

/** Flat, deterministic, bounded delivery bonus (the career finalize also caps it against base pay). */
export const DELIVERY_PAY_BONUS = 40

/** True when the player owns a usable delivery-tagged vehicle (positive condition, not impounded). */
export function ownsUsableDeliveryVehicle(): boolean {
  return getOwnedVehicles().some((v) => {
    const def = getVehicleDef(v.defId)
    return !!def && def.tags.includes('delivery') && v.condition > 0 && v.location.kind !== 'impound'
  })
}

/** The delivery pay bonus the player currently qualifies for (0 when no usable delivery vehicle). */
export function deliveryPayBonus(): number {
  return ownsUsableDeliveryVehicle() ? DELIVERY_PAY_BONUS : 0
}
