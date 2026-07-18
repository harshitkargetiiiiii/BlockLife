import type { RobberyActivityDefinition } from './activityTypes'
import { ROBBERY_DEFINITIONS } from './activityDefinitions'

/**
 * Validate robbery definitions against injected world facts. Pure and
 * dependency-injected (same shape as missionValidation) so it runs in unit
 * tests against the REAL registries and is exposed to the dev test API. Returns
 * a list of human-readable problems; empty means every definition is shippable.
 */

export interface ActivityValidationContext {
  interiorIds: ReadonlySet<string>
  /** Interior geometry for bounds checks: id → {origin, halfWidth, halfDepth}. */
  interiorBounds: ReadonlyMap<string, { origin: [number, number]; halfWidth: number; halfDepth: number }>
  registeredSectorIds: ReadonlySet<string>
  interactableIds: ReadonlySet<string>
  /** Quest-critical / named NPC ids that must NOT be used as cashiers. */
  questCriticalNpcIds: ReadonlySet<string>
}

function validateOne(def: RobberyActivityDefinition, ctx: ActivityValidationContext): string[] {
  const errs: string[] = []
  const p = `${def.id}`

  if (!def.id || !def.seedKey) errs.push(`${p}: missing id/seedKey`)
  if (def.version < 1) errs.push(`${p}: version must be >= 1`)

  // Interior + geometry.
  if (!ctx.interiorIds.has(def.interiorId)) {
    errs.push(`${p}: interiorId '${def.interiorId}' is not a registered interior`)
  }
  const bounds = ctx.interiorBounds.get(def.interiorId)
  if (bounds) {
    const inside = (pos: [number, number], what: string) => {
      const dx = Math.abs(pos[0] - bounds.origin[0])
      const dz = Math.abs(pos[1] - bounds.origin[1])
      if (dx > bounds.halfWidth || dz > bounds.halfDepth) {
        errs.push(`${p}: ${what} ${JSON.stringify(pos)} is outside interior '${def.interiorId}'`)
      }
    }
    inside(def.registerPosition, 'registerPosition')
    inside(def.cashierPosition, 'cashierPosition')
  }

  // Sector ownership of the exterior entrance.
  if (!ctx.registeredSectorIds.has(def.sectorId)) {
    errs.push(`${p}: sectorId '${def.sectorId}' is not a registered sector`)
  }

  // Interactables.
  if (!ctx.interactableIds.has(def.entranceInteractableId)) {
    errs.push(`${p}: entranceInteractableId '${def.entranceInteractableId}' is not registered`)
  }
  if (!ctx.interactableIds.has(def.secureInteractableId)) {
    errs.push(`${p}: secureInteractableId '${def.secureInteractableId}' is not registered`)
  }

  // Cashier must not be a quest-critical / named NPC.
  if (ctx.questCriticalNpcIds.has(def.cashierId)) {
    errs.push(`${p}: cashierId '${def.cashierId}' is a quest-critical NPC (forbidden)`)
  }

  // Cash range + cooldown sanity.
  if (!(def.cashRange.min > 0) || def.cashRange.max < def.cashRange.min) {
    errs.push(`${p}: invalid cashRange ${JSON.stringify(def.cashRange)}`)
  }
  if (!(def.cooldownGameHours > 0)) errs.push(`${p}: cooldownGameHours must be > 0`)

  // Threat thresholds.
  if (!(def.threat.holdSeconds > 0)) errs.push(`${p}: threat.holdSeconds must be > 0`)
  if (!(def.threat.range > 0)) errs.push(`${p}: threat.range must be > 0`)
  if (def.threat.aimDotMin <= 0 || def.threat.aimDotMin > 1) {
    errs.push(`${p}: threat.aimDotMin must be in (0,1]`)
  }

  return errs
}

export function validateRobberies(ctx: ActivityValidationContext): string[] {
  const errs: string[] = []
  const seen = new Set<string>()
  for (const def of ROBBERY_DEFINITIONS) {
    if (seen.has(def.id)) errs.push(`${def.id}: duplicate robbery id`)
    seen.add(def.id)
    errs.push(...validateOne(def, ctx))
  }
  return errs
}
