import { ITEM_DEFINITIONS } from './itemCatalog'
import type { ItemCategory, ItemDefinition } from './itemTypes'

/**
 * Pure catalog validation. All world facts (which wardrobe palettes exist) are
 * injected, so it runs in the unit suite AND against the live registries. An
 * invalid catalog fails a test with a source-referenced message — never a play
 * session.
 */

export interface ItemValidationContext {
  /** Palette ids a wardrobe-unlock effect may reference. */
  paletteIds: ReadonlySet<string>
  /** Palette ids that START LOCKED (an unlock item must target one of these). */
  lockedPaletteIds: ReadonlySet<string>
}

const VALID_CATEGORIES: ReadonlySet<ItemCategory> = new Set<ItemCategory>([
  'food',
  'drink',
  'medical',
  'ammo',
  'quest',
  'cosmetic',
  'supply',
])

function validateOne(def: ItemDefinition, ctx: ItemValidationContext, errs: string[]): void {
  const where = `item ${def.id}`
  if (!def.name) errs.push(`${where}: missing name`)
  if (!VALID_CATEGORIES.has(def.category)) errs.push(`${where}: invalid category '${def.category}'`)
  if (!Number.isInteger(def.stackLimit) || def.stackLimit < 1) {
    errs.push(`${where}: stackLimit must be an integer >= 1`)
  }
  if (!(def.price >= 0) || !Number.isFinite(def.price)) errs.push(`${where}: price must be >= 0`)

  // Effect ↔ usability consistency.
  const hasEffect = def.effect.kind !== 'none'
  if (def.usable && !hasEffect) errs.push(`${where}: usable item has no effect`)
  if (!def.usable && hasEffect) errs.push(`${where}: has effect '${def.effect.kind}' but is not usable`)

  // Effect payloads.
  switch (def.effect.kind) {
    case 'feed':
      if (!(def.effect.hunger > 0)) errs.push(`${where}: feed.hunger must be > 0`)
      break
    case 'refresh':
      if (!(def.effect.energy > 0)) errs.push(`${where}: refresh.energy must be > 0`)
      break
    case 'heal':
      if (!(def.effect.health > 0)) errs.push(`${where}: heal.health must be > 0`)
      break
    case 'ammo':
      if (!Number.isInteger(def.effect.rounds) || def.effect.rounds <= 0) {
        errs.push(`${where}: ammo.rounds must be a positive integer`)
      }
      break
    case 'unlock': {
      const pid = def.effect.paletteId
      if (!ctx.paletteIds.has(pid)) errs.push(`${where}: unlock references unknown palette '${pid}'`)
      else if (!ctx.lockedPaletteIds.has(pid)) {
        errs.push(`${where}: unlock targets palette '${pid}' that is not lock-gated`)
      }
      if (def.category !== 'cosmetic') errs.push(`${where}: unlock effect must be a cosmetic item`)
      break
    }
    case 'none':
      break
  }

  // Quest-reserved policy (smallest safe): protected from use/discard/store so a
  // required interaction can never be made impossible.
  if (def.questReserved && (def.usable || def.discardable || def.storable)) {
    errs.push(`${where}: quest-reserved items must not be usable/discardable/storable`)
  }
}

export function validateItemCatalog(ctx: ItemValidationContext): string[] {
  const errs: string[] = []
  const seen = new Set<string>()
  for (const def of ITEM_DEFINITIONS) {
    if (seen.has(def.id)) errs.push(`duplicate item id '${def.id}'`)
    seen.add(def.id)
    validateOne(def, ctx, errs)
  }
  return errs
}
