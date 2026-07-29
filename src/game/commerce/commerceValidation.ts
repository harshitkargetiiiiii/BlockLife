import { STORE_DEFINITIONS } from './storeDefinitions'
import type { StoreDefinition } from './commerceTypes'

/**
 * Pure store-definition validation. World facts (which items, interiors,
 * interactables, and robbery activities exist) are injected, so it runs in the
 * unit suite AND against the live registries.
 */

export interface CommerceValidationContext {
  itemIds: ReadonlySet<string>
  interiorIds: ReadonlySet<string>
  interactableIds: ReadonlySet<string>
  activityIds: ReadonlySet<string>
}

function validateStore(def: StoreDefinition, ctx: CommerceValidationContext, errs: string[]): void {
  const where = `store ${def.id}`
  // Robbable convenience stores MUST have a real interior, register, and robbery activity
  // (the furniture showroom is a retail store and is validated separately, not here).
  if (!def.interiorId || !ctx.interiorIds.has(def.interiorId)) errs.push(`${where}: unknown interior '${def.interiorId}'`)
  if (!def.registerInteractableId || !ctx.interactableIds.has(def.registerInteractableId)) {
    errs.push(`${where}: unknown register interactable '${def.registerInteractableId}'`)
  }
  if (!def.activityId || !ctx.activityIds.has(def.activityId)) errs.push(`${where}: unknown robbery activity '${def.activityId}'`)
  if (!(def.restockGameHours > 0)) errs.push(`${where}: restockGameHours must be > 0`)
  if (def.listings.length === 0) errs.push(`${where}: has no listings`)
  const seen = new Set<string>()
  for (const l of def.listings) {
    if (seen.has(l.itemId)) errs.push(`${where}: duplicate listing '${l.itemId}'`)
    seen.add(l.itemId)
    if (!ctx.itemIds.has(l.itemId)) errs.push(`${where}: listing references unknown item '${l.itemId}'`)
    if (!Number.isInteger(l.maxStock) || l.maxStock < 1) errs.push(`${where}/${l.itemId}: maxStock must be >= 1`)
    if (!Number.isInteger(l.restockAmount) || l.restockAmount < 1) {
      errs.push(`${where}/${l.itemId}: restockAmount must be >= 1`)
    }
    if (l.priceOverride !== undefined && !(l.priceOverride >= 0)) {
      errs.push(`${where}/${l.itemId}: priceOverride must be >= 0`)
    }
  }
}

export function validateStores(ctx: CommerceValidationContext): string[] {
  const errs: string[] = []
  const seen = new Set<string>()
  for (const def of STORE_DEFINITIONS) {
    if (seen.has(def.id)) errs.push(`duplicate store id '${def.id}'`)
    seen.add(def.id)
    validateStore(def, ctx, errs)
  }
  return errs
}
