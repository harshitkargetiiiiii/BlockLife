/**
 * The FULL live person-occupancy contract for one actor (World Integrity Slice 2):
 *
 *   person-person spacing  →  on-foot player  →  [ vehicle push-out  →  MANDATORY
 *   static-solid clamp ]  (bracketed steps apply to OFF-path actors only)
 *
 * Every actor kind and state (walking, idle, queueing, sitting, frozen,
 * panicking; citizens, NPCs, police on foot, ejected drivers, interior
 * civilians) routes through here, so no person ever ends a frame standing on a
 * car or embedded in a building/prop.
 *
 * Person spacing + the player push apply to EVERY actor (capped, trip-safe soft
 * nudges). The HARD vehicle + solid clamps apply to OFF-path actors — idle,
 * queueing, sitting, frozen, panicking or displaced people, which have no
 * per-frame avoidance and are the ones that end up on a car or inside a wall. An
 * actor actively walking an AUTHORED path leg (`onPath`) is skipped: it already
 * gap-crosses roads via the pedestrian etiquette (`decidePedestrian`) and steps
 * out of cars (`CAR_CLEARANCE`), and follows a route validated clear of solids —
 * clamping it every frame fights its crossings and stalls long trips (measured:
 * a cross-district commute regressed from ~3.3min to a timeout under the clamp).
 * See CONVENTIONS #18.
 *
 * Runs only on live (non-paused) frames — callers invoke it after their
 * pause-snap early-return, preserving visual determinism.
 */
import { PERSON_RADIUS, resolvePersonSpacing } from '../personSeparation'
import { registry } from '../runtimeRegistry'
import { useGameStore } from '../../store/useGameStore'
import { centreInsideOrientedBox, pushCircleOutOfOrientedBox } from './occupancy'
import { getNearbySolids, getVehicleObstacles } from './liveObstacles'
import type { OrientedBox2D } from './entityTypes'
import type { Vec2 } from '../worldTypes'

/** Person centre kept at least this far from the on-foot player. */
const PLAYER_CLEARANCE = 0.85
/** How far out to gather nearby solids (person radius + a small margin). */
const SOLID_QUERY_RADIUS = 1.2
/** A car centre farther than this can't overlap a person (car reach ≈2.2 + 0.36). */
const VEHICLE_CULL_SQ = 25

const _solids: OrientedBox2D[] = []

/**
 * @param isMoving True when the actor moved this frame (movement-priority spacing).
 * @param onPath True when the actor is actively walking an AUTHORED path leg this
 *   frame — it has crossing/car avoidance (`decidePedestrian` / `CAR_CLEARANCE`)
 *   and follows a route validated clear of solids, so the hard vehicle/solid
 *   clamps are skipped (they would fight its crossings and stall its trip). Left
 *   false for idle, queueing, sitting, frozen, panicking or displaced actors —
 *   which have no per-frame avoidance and so are fully clamped off cars/solids.
 */
export function resolvePersonOccupancy(
  pos: Vec2,
  selfId: string,
  dt: number,
  isMoving: boolean,
  onPath = false,
): void {
  // (2–4) soft person-person spacing — idle repair + deadlock-safe (trip-safe).
  // Applies to EVERY person (this is the Slice-1 crowd-phasing fix).
  resolvePersonSpacing(pos, selfId, dt, isMoving)

  // Person vs the on-foot player: a citizen must never stand on the player.
  if (useGameStore.getState().mode === 'walking') {
    const dx = pos[0] - registry.playerPosition.x
    const dz = pos[1] - registry.playerPosition.z
    const d2 = dx * dx + dz * dz
    if (d2 < PLAYER_CLEARANCE * PLAYER_CLEARANCE && d2 > 1e-8) {
      const d = Math.sqrt(d2)
      const push = PLAYER_CLEARANCE - d
      pos[0] += (dx / d) * push
      pos[1] += (dz / d) * push
    }
  }

  // (5–6) HARD vehicle + static-solid exclusion apply to actors NOT following an
  // authored path — idle, queueing, sitting, frozen, panicking or displaced
  // people, which lack per-frame avoidance and can end up on a car or embedded
  // in a building. An on-path WALKER is skipped: it already avoids cars via the
  // pedestrian crossing logic (`decidePedestrian` / `CAR_CLEARANCE`) and follows
  // a route validated clear of solids — clamping it every frame would fight its
  // crossings and stall long trips. Both clamps fire only when the CENTRE is
  // inside (genuine embedding); body-grazing an edge is tolerated.
  if (onPath) return

  const vehicles = getVehicleObstacles()
  for (let i = 0; i < vehicles.length; i++) {
    const v = vehicles[i]
    const dx = pos[0] - v.x
    const dz = pos[1] - v.z
    if (dx * dx + dz * dz > VEHICLE_CULL_SQ) continue
    if (!centreInsideOrientedBox(pos[0], pos[1], v)) continue
    const [nx, nz] = pushCircleOutOfOrientedBox(pos[0], pos[1], PERSON_RADIUS, v)
    pos[0] = nx
    pos[1] = nz
  }

  getNearbySolids(pos[0], pos[1], SOLID_QUERY_RADIUS, _solids)
  for (let i = 0; i < _solids.length; i++) {
    if (!centreInsideOrientedBox(pos[0], pos[1], _solids[i])) continue
    const [nx, nz] = pushCircleOutOfOrientedBox(pos[0], pos[1], PERSON_RADIUS, _solids[i])
    pos[0] = nx
    pos[1] = nz
  }
}
