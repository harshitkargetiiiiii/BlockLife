import type { Vec2 } from '../world/worldTypes'
import { collectSolidFootprints, type SolidFootprint } from '../world/solidFootprints'

/**
 * Cheap solid avoidance for pursuing police units: nudges a proposed position
 * out of any building/prop footprint it lands inside, along the shallowest
 * penetration axis. Footprints are static (immutable world), so the table is
 * cached once. Buildings are axis-aligned; small oriented props are treated
 * as their bounding box — good enough to stop a cruiser phasing through a
 * wall without a full nav mesh (that's a future extension).
 */

const POLICE_CLEARANCE = 1.3
let cache: SolidFootprint[] | null = null

export function invalidatePoliceAvoidance(): void {
  cache = null
}

export function avoidSolids(pos: Vec2): Vec2 {
  if (!cache) cache = collectSolidFootprints()
  let x = pos[0]
  let z = pos[1]
  for (const f of cache) {
    const hw = f.halfWidth + POLICE_CLEARANCE
    const hl = f.halfLength + POLICE_CLEARANCE
    const dx = x - f.position.x
    const dz = z - f.position.z
    if (Math.abs(dx) < hw && Math.abs(dz) < hl) {
      const penX = hw - Math.abs(dx)
      const penZ = hl - Math.abs(dz)
      if (penX <= penZ) x += dx >= 0 ? penX : -penX
      else z += dz >= 0 ? penZ : -penZ
    }
  }
  return [x, z]
}
