import type { Vec2 } from '../world/worldTypes'
import type { PoliceUnit } from './policeTypes'

/**
 * Pure decision for when a cruiser should put an officer on the street. A
 * cruiser dismounts ONE officer when it has closed to within range of an
 * ON-FOOT suspect and hasn't already dismounted — bounded by the wanted
 * level's officer cap. Unit-testable without any scene or spawn side effects.
 */

/** A cruiser within this of an on-foot suspect dismounts an officer. */
export const POLICE_DISMOUNT_RANGE = 20

/** How far to the curbside of the cruiser an officer steps out. */
export const CRUISER_EXIT_OFFSET = 2.2

/**
 * Raw curbside exit point for an officer stepping out of a cruiser at
 * (x,z,heading) — offset to the vehicle's right so the officer clears the
 * body. The live driver pushes this out of any solid before spawning; kept
 * pure here so the geometry is unit-testable.
 */
export function cruiserExit(x: number, z: number, heading: number): Vec2 {
  // Forward is (sin h, cos h); the right-hand perpendicular is (cos h, -sin h).
  return [x + Math.cos(heading) * CRUISER_EXIT_OFFSET, z - Math.sin(heading) * CRUISER_EXIT_OFFSET]
}

export interface DismountPlan {
  cruiserId: string
  incidentId: string
}

export function planDismounts(input: {
  units: PoliceUnit[]
  suspectPos: Vec2
  suspectOnFoot: boolean
  officerCap: number
  currentOfficers: number
}): DismountPlan[] {
  // Officers only make sense when the suspect is out of a vehicle (on foot).
  if (!input.suspectOnFoot) return []
  let budget = input.officerCap - input.currentOfficers
  if (budget <= 0) return []
  const plans: DismountPlan[] = []
  for (const u of input.units) {
    if (budget <= 0) break
    if (u.kind !== 'vehicle') continue
    // Already dismounted an officer from this cruiser?
    if (input.units.some((o) => o.kind === 'officer' && o.cruiserId === u.id)) continue
    const d = Math.hypot(u.position[0] - input.suspectPos[0], u.position[1] - input.suspectPos[1])
    if (d <= POLICE_DISMOUNT_RANGE) {
      plans.push({ cruiserId: u.id, incidentId: u.incidentId })
      budget -= 1
    }
  }
  return plans
}
