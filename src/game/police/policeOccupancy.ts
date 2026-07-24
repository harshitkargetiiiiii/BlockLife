/**
 * Hard occupancy for dismounted police officers (World Integrity §8 follow-up —
 * closing the deferred actor-clamp gap). Routes every on-foot officer through the
 * SAME per-actor contract citizens/NPCs use — person spacing → on-foot player
 * push → hard oriented vehicle push-out → mandatory static-solid clamp — via
 * `resolvePersonOccupancy`, PLUS a police↔police spacing pass.
 *
 * Why the extra pass: officers live in their own runtime, not `registry.npcPositions`,
 * so `resolvePersonOccupancy`'s shared spacing (which reads `npcPositions`) already
 * separates an officer from CITIZENS but not from OTHER OFFICERS. A burst of units
 * converging on one suspect is exactly the cluster the 300s soak used to filter
 * (`police_*`); this pass opens it. Officers pursue directly (no pedestrian
 * crossing etiquette) → OFF-path, so they take the full vehicle + solid clamps.
 * The best-effort `avoid` inside `stepPoliceDirector` still shapes the path; this
 * is the hard safety net that guarantees no officer ends a frame embedded in a
 * building, standing on a car, or stacked on another officer. Mutates
 * `officer.position` in place; caller runs it on LIVE (non-paused) frames only.
 */
import { PERSON_RADIUS } from '../world/personSeparation'
import { resolvePersonOccupancy } from '../world/integrity/personOccupancy'
import { personSpacingDisplacement, type Occupant } from '../world/integrity/occupancy'
import { policeRuntime } from './policeRuntime'

/** Officers close ranks harder than strolling citizens → a firmer separation cap. */
const POLICE_SEP_PER_SECOND = 1.6

export function resolvePoliceOccupancy(dt: number): void {
  const officers = [...policeRuntime.units.values()].filter((u) => u.kind === 'officer')
  if (officers.length === 0) return

  // (a) police↔police: symmetric separation from a single frame-start snapshot
  // (order-independent), so a converging cluster opens up instead of stacking.
  // Both treated as moving — an on-duty officer is never a stationary obstacle.
  if (officers.length > 1) {
    const snapshot: Occupant[] = officers.map((o) => ({ id: o.id, x: o.position[0], z: o.position[1], radius: PERSON_RADIUS, moving: true }))
    for (let i = 0; i < officers.length; i++) {
      const [dx, dz] = personSpacingDisplacement(
        snapshot[i],
        snapshot.filter((_, j) => j !== i),
        { dt, maxSpacingPerSecond: POLICE_SEP_PER_SECOND, yieldAroundStationary: true },
      )
      officers[i].position[0] += dx
      officers[i].position[1] += dz
    }
  }

  // (b) citizen / on-foot player / vehicle / solid via the shared contract. Reads
  // `npcPositions` for the citizen spacing; off-path ⇒ full vehicle + solid clamps.
  for (const o of officers) {
    resolvePersonOccupancy(o.position, o.id, dt, /* isMoving */ true, /* onPath */ false)
  }
}
