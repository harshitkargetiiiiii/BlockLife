import type { MissionDefinition, MissionObjectiveDefinition } from './missionTypes'
import { MISSION_DEFINITIONS } from './missionDefinitions'
import { MISSION_ANCHORS } from './missionAnchors'

/**
 * Mission-definition + world-integration validation. Pure: all world facts
 * (which interactables/anchors/sectors exist, whether ground is clear) are
 * injected, so it runs in the unit suite AND against the live registries. An
 * invalid mission fails a test with a source-referenced message — never a play
 * session. Errors name the mission id, objective id, and the offending ref.
 */

export interface MissionValidationContext {
  anchorIds: ReadonlySet<string>
  interactableIds: ReadonlySet<string>
  registeredSectorIds: ReadonlySet<string>
  phoneJobIds: ReadonlySet<string>
  /** Optional ground check per anchor id (clear of solids + not in a lane). */
  isAnchorGroundClear?: (anchorId: string) => boolean
}

function validateObjectiveRefs(
  def: MissionDefinition,
  obj: MissionObjectiveDefinition,
  ctx: MissionValidationContext,
  varsSoFar: Set<string>,
  errs: string[],
): void {
  const where = `mission ${def.id} / objective ${obj.id}`
  switch (obj.kind) {
    case 'reach_zone':
    case 'drive_vehicle_to_zone':
      if (!ctx.anchorIds.has(obj.anchorId)) errs.push(`${where}: unknown anchor '${obj.anchorId}'`)
      break
    case 'interact':
    case 'return_to_giver':
    case 'deliver_vehicle':
      if (!ctx.interactableIds.has(obj.interactableId)) {
        errs.push(`${where}: unknown interactable '${obj.interactableId}'`)
      }
      break
  }
  // A drive/deliver/exit objective that reads a target variable requires an
  // earlier objective to have written it.
  const readsVar =
    obj.kind === 'drive_vehicle_to_zone'
      ? obj.targetVehicleFromVariable
      : obj.kind === 'deliver_vehicle'
        ? obj.targetVehicleFromVariable
        : obj.kind === 'exit_vehicle'
          ? obj.vehicleFromVariable
          : obj.kind === 'enter_vehicle'
            ? obj.vehicleFromVariable
            : undefined
  if (readsVar && !varsSoFar.has(readsVar)) {
    errs.push(`${where}: reads variable '${readsVar}' created by no earlier objective`)
  }
  if (obj.kind === 'steal_vehicle') varsSoFar.add(obj.writeTargetToVariable)
}

export function validateMissionDefinitions(ctx: MissionValidationContext): string[] {
  const errs: string[] = []
  const seenMissionIds = new Set<string>()

  for (const def of MISSION_DEFINITIONS) {
    if (seenMissionIds.has(def.id)) errs.push(`duplicate mission id '${def.id}'`)
    seenMissionIds.add(def.id)
    if (!Number.isInteger(def.version) || def.version < 1) {
      errs.push(`mission ${def.id}: version must be a positive integer`)
    }
    if (def.objectives.length === 0) errs.push(`mission ${def.id}: has no objectives`)

    // Offer source.
    if (def.offerSource.kind === 'interactable') {
      if (!ctx.interactableIds.has(def.offerSource.interactableId)) {
        errs.push(`mission ${def.id}: offer interactable '${def.offerSource.interactableId}' unknown`)
      }
    } else if (!def.offerSource.jobId) {
      errs.push(`mission ${def.id}: phone_job offer needs a jobId`)
    }

    // Objectives: unique ids + valid refs + variable ordering.
    const seenObjIds = new Set<string>()
    const varsSoFar = new Set<string>()
    for (const obj of def.objectives) {
      if (seenObjIds.has(obj.id)) errs.push(`mission ${def.id}: duplicate objective id '${obj.id}'`)
      seenObjIds.add(obj.id)
      validateObjectiveRefs(def, obj, ctx, varsSoFar, errs)
    }

    // Rewards.
    for (const r of def.rewards) {
      if (r.kind === 'money' && !(r.amount > 0)) errs.push(`mission ${def.id}: money reward must be > 0`)
      if (r.kind === 'item' && !(r.quantity > 0)) errs.push(`mission ${def.id}: item reward qty must be > 0`)
    }
    if (def.repeatable && def.cooldownGameHours !== undefined && !(def.cooldownGameHours > 0)) {
      errs.push(`mission ${def.id}: cooldownGameHours must be > 0 when set`)
    }
  }
  return errs
}

export function validateMissionAnchors(ctx: MissionValidationContext): string[] {
  const errs: string[] = []
  const seen = new Set<string>()
  for (const a of MISSION_ANCHORS) {
    if (seen.has(a.id)) errs.push(`duplicate anchor id '${a.id}'`)
    seen.add(a.id)
    if (!ctx.registeredSectorIds.has(a.sectorId)) {
      errs.push(`anchor ${a.id}: sector '${a.sectorId}' is not registered`)
    }
    if (!(a.radius > 0)) errs.push(`anchor ${a.id}: radius must be > 0`)
    if (ctx.isAnchorGroundClear && !ctx.isAnchorGroundClear(a.id)) {
      errs.push(`anchor ${a.id}: not on clear, accessible ground`)
    }
  }
  return errs
}

/** Convenience: all mission validation errors in one list. */
export function validateMissions(ctx: MissionValidationContext): string[] {
  return [...validateMissionDefinitions(ctx), ...validateMissionAnchors(ctx)]
}
