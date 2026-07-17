import { registry } from './runtimeRegistry'
import type { Vec2 } from './worldTypes'

/** Personal space between two MOVING people (each ≈0.35 radius). */
export const PERSON_SEP_RADIUS = 0.72
/**
 * The TOTAL separation nudge a walker may receive in one frame, capped BELOW
 * walk speed (≈0.023/frame). This is the crux: per-neighbour pushes summed
 * unbounded in a dense crowd overpower locomotion and gridlock trips (proven:
 * a 7-citizen soak completed zero trips). Capping the total keeps separation a
 * gentle, advisory nudge that improves visual spacing without ever halting a
 * walker — dense crowds keep flowing and deterministic trips still complete.
 */
export const MAX_SEP_STEP_PER_SECOND = 1.2

/**
 * Soft-separate a MOVING walker from other MOVING people so two walkers don't
 * blatantly walk through each other — best-effort VISUAL spacing, not a hard
 * guarantee. Scoped to moving-vs-moving (never push against a stationary
 * queuer/sitter/idler — that deadlocks trips at chokepoints) and the total
 * push is capped below walk speed (never gridlocks a dense crowd). Perfect
 * non-overlap needs a real crowd-avoidance layer (RVO/ORCA) — a documented
 * future extension. `registry.npcPositions` holds ambient citizens AND named
 * NPCs. Mutates `pos` in place.
 */
export function separateWalkerFromPeople(
  pos: Vec2,
  selfId: string,
  dt: number,
  _heading = 0,
): void {
  const r2 = PERSON_SEP_RADIUS * PERSON_SEP_RADIUS
  let ax = 0
  let az = 0
  for (const [otherId, other] of registry.npcPositions) {
    if (otherId === selfId) continue
    if (!registry.movingPersonIds.has(otherId)) continue
    const dx = pos[0] - other.x
    const dz = pos[1] - other.z
    const d2 = dx * dx + dz * dz
    if (d2 > r2 || d2 < 1e-8) continue
    const dist = Math.sqrt(d2)
    // Weight by penetration depth so close neighbours dominate.
    const weight = (PERSON_SEP_RADIUS - dist) / PERSON_SEP_RADIUS
    ax += (dx / dist) * weight
    az += (dz / dist) * weight
  }
  const mag = Math.hypot(ax, az)
  if (mag < 1e-6) return
  // Cap the TOTAL nudge below walk speed so it can never overpower locomotion.
  const step = Math.min(mag, MAX_SEP_STEP_PER_SECOND * dt)
  pos[0] += (ax / mag) * step
  pos[1] += (az / mag) * step
}
