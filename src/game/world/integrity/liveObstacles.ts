/**
 * Shared, bounded obstacle accessors for the live person-occupancy clamp
 * (World Integrity v1, Slice 2). Reuses the repo's existing oriented-rectangle
 * footprint sources — `trafficRuntime.cars` + `getDrivenCarFootprint()` for
 * vehicles, `collectSolidFootprints()` for buildings/props/fixtures/water — and
 * exposes them as `OrientedBox2D` for the occupancy push-out math.
 *
 * Vehicles change every frame → rebuilt once per frame (cached by frameCount),
 * shared by every actor that frame. Solids are static → indexed once in a
 * spatial hash so a person only tests the few solids near it (never the whole
 * city). Neither allocates per person per frame beyond a reused scratch array.
 */
import { registry } from '../runtimeRegistry'
import { getDrivenCarFootprint, trafficRuntime } from '../../traffic/trafficRuntime'
import { CAR_HALF_LENGTH, CAR_HALF_WIDTH } from '../../traffic/vehicleObstacles'
import { collectSolidFootprints } from '../solidFootprints'
import { pushCircleOutOfOrientedBox } from './occupancy'
import { SpatialHash } from './spatialHash'
import type { OrientedBox2D } from './entityTypes'

// ---- vehicles (dynamic, per-frame cache) ---------------------------------

let vehicleFrame = -1
let vehicleBoxes: OrientedBox2D[] = []

/** Oriented footprints of the driven car + every ambient car, this frame. */
export function getVehicleObstacles(): readonly OrientedBox2D[] {
  if (registry.frameCount === vehicleFrame) return vehicleBoxes
  vehicleFrame = registry.frameCount
  const out: OrientedBox2D[] = []
  const driven = getDrivenCarFootprint()
  if (driven) {
    out.push({
      x: driven.position.x,
      z: driven.position.z,
      halfLength: driven.halfLength,
      halfWidth: driven.halfWidth,
      headingY: driven.heading,
    })
  }
  for (const car of trafficRuntime.cars.values()) {
    out.push({ x: car.x, z: car.z, halfLength: CAR_HALF_LENGTH, halfWidth: CAR_HALF_WIDTH, headingY: car.heading })
  }
  vehicleBoxes = out
  return out
}

// ---- solids (static, built once) -----------------------------------------

let solidHash: SpatialHash | null = null
const solidBoxes = new Map<string, OrientedBox2D>()
/** Largest solid reach (half-diagonal) — so a big building near the query is never missed. */
let maxSolidReach = 0

function ensureSolids(): void {
  if (solidHash) return
  solidHash = new SpatialHash(8)
  solidBoxes.clear()
  maxSolidReach = 0
  for (const s of collectSolidFootprints()) {
    const box: OrientedBox2D = {
      x: s.position.x,
      z: s.position.z,
      halfLength: s.halfLength,
      halfWidth: s.halfWidth,
      headingY: s.heading,
    }
    solidBoxes.set(s.id, box)
    solidHash.insert(s.id, s.position.x, s.position.z)
    const reach = Math.hypot(s.halfLength, s.halfWidth)
    if (reach > maxSolidReach) maxSolidReach = reach
  }
}

const _scratch: { id: string; x: number; z: number }[] = []

/**
 * Solid footprints whose body could be within `radius` of (x,z). Queries by
 * centre with a `maxSolidReach` margin so a large building is never missed, then
 * the caller's push-out no-ops any that don't actually overlap.
 */
export function getNearbySolids(x: number, z: number, radius: number, out: OrientedBox2D[]): OrientedBox2D[] {
  ensureSolids()
  out.length = 0
  solidHash!.queryNeighbours(x, z, radius + maxSolidReach, undefined, _scratch)
  for (const e of _scratch) {
    const b = solidBoxes.get(e.id)
    if (b) out.push(b)
  }
  return out
}

/** Player half-extent used when clearing a spawn/exit/respawn point. */
const SPAWN_RADIUS = 0.5
const _spawnSolids: OrientedBox2D[] = []

/**
 * Nudge a spawn / vehicle-exit / respawn position clear of nearby solids,
 * vehicles AND people, so the player never lands inside a building, on a car,
 * or on a citizen (issue §2 "safe player/vehicle exit + respawn"). A few bounded
 * passes converge; returns the corrected [x, z]. No store dependency (safe to
 * call from the store's exit/respawn actions).
 */
export function findClearPlayerSpawn(x: number, z: number): [number, number] {
  let px = x
  let pz = z
  for (let pass = 0; pass < 3; pass++) {
    // buildings / props / water
    getNearbySolids(px, pz, SPAWN_RADIUS + 0.7, _spawnSolids)
    for (const s of _spawnSolids) [px, pz] = pushCircleOutOfOrientedBox(px, pz, SPAWN_RADIUS, s)
    // vehicles (driven + ambient)
    const vehicles = getVehicleObstacles()
    for (let i = 0; i < vehicles.length; i++) {
      const v = vehicles[i]
      const dx = px - v.x
      const dz = pz - v.z
      if (dx * dx + dz * dz > 36) continue
      ;[px, pz] = pushCircleOutOfOrientedBox(px, pz, SPAWN_RADIUS, v)
    }
    // people
    for (const other of registry.npcPositions.values()) {
      const dx = px - other.x
      const dz = pz - other.z
      const d2 = dx * dx + dz * dz
      const min = SPAWN_RADIUS + 0.36
      if (d2 >= min * min) continue
      if (d2 > 1e-8) {
        const d = Math.sqrt(d2)
        const push = min - d
        px += (dx / d) * push
        pz += (dz / d) * push
      } else {
        // Exactly coincident — no direction; nudge along +x so respawns never
        // land dead-centre on a body.
        px += min
      }
    }
  }
  return [px, pz]
}

/** Rebuild the static solid index on next use (reset/load). */
export function resetLiveObstacles(): void {
  solidHash = null
  solidBoxes.clear()
  maxSolidReach = 0
  vehicleFrame = -1
  vehicleBoxes = []
}
