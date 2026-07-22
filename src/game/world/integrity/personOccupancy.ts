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
 *   frame — it has crossing/car avoidance (`decidePedestrian` / `CAR_CLEARANCE`),
 *   so the hard VEHICLE push-out is skipped for it (it would fight its road
 *   crossings and stall its trip). The mandatory static-solid clamp still runs —
 *   a walker can drive its own centre into a building, so that guarantee is
 *   universal. Left false for idle, queueing, sitting, frozen, panicking or
 *   displaced actors — which additionally get the vehicle clamp.
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

  // (5) HARD oriented vehicle push-out applies to actors NOT following an
  // authored path — idle, queueing, sitting, frozen, panicking or displaced
  // people, which lack per-frame avoidance and can end up standing on a car. An
  // on-path WALKER is skipped here: it gap-crosses BETWEEN cars via the pedestrian
  // etiquette (`decidePedestrian` / `CAR_CLEARANCE`), and a per-frame push-out of
  // a car it is legitimately passing fights that crossing and stalls the trip
  // (measured: a cross-district commute regressed to a timeout). See CONVENTIONS
  // #18. Fires only when the CENTRE is inside (genuine embedding).
  if (!onPath) {
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
  }

  // (6) MANDATORY static-solid clamp — for EVERY actor, on-path or not, so the
  // "no person ever ends a frame embedded in a building/prop" contract actually
  // holds. It runs UNCONDITIONALLY: a walker can drive its OWN centre into a
  // building under its own locomotion (measured — a plaza stroller shoved off its
  // route then walked itself deep into an apartment: inside=1, clampDepth=2.87,
  // moving=true), which no "was I pushed by spacing/the player this frame" guard
  // can catch, so gating the clamp on displacement let on-path embeddings persist.
  // The cost is bounded: `getNearbySolids` is a spatial-hash lookup that returns
  // empty for a walker in the open (the common case) — the whole-fleet iteration
  // that regressed the commute is the VEHICLE clamp above, which stays off-path.
  // Unlike the vehicle push-out this never fights a road crossing (roads carry no
  // solids). Fires only on genuine centre-embedding; a body grazing an edge is
  // tolerated (kept consistent with the detector's `embedTolerance`).
  getNearbySolids(pos[0], pos[1], SOLID_QUERY_RADIUS, _solids)
  for (let i = 0; i < _solids.length; i++) {
    if (!centreInsideOrientedBox(pos[0], pos[1], _solids[i])) continue
    const [nx, nz] = pushCircleOutOfOrientedBox(pos[0], pos[1], PERSON_RADIUS, _solids[i])
    pos[0] = nx
    pos[1] = nz
  }
}
