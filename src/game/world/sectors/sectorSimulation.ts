import { worldToSectorId } from './worldGrid'
import { getSectorRuntimeState, isSectorMounted, isStreamingActive } from './sectorStreaming'
import type { SimulationTier } from './sectorRegistry'

/**
 * Simulation LOD helper for per-entity frame loops (citizens, named NPCs).
 *
 * Tier contract (v1, documented honestly):
 * - full:     current behavior, every frame (sector ACTIVE)
 * - reduced:  behavior stepped at ~15 Hz with batched dt — identical logic,
 *   lower cadence; animation/bubbles keep working (sector WARM/COOLING)
 * - dormant:  entity hidden, logic paused; identity, position, schedule
 *   phase and memory persist untouched (sector not mounted). Dormant
 *   citizens do NOT advance their routine analytically in v1 — the pause is
 *   the documented policy, not a simulation claim.
 */

export interface EntitySimulationGate {
  /** False → hide the entity and skip its frame work entirely. */
  simulate: boolean
  /** Batched dt to step with (0 → skip this frame, reduced cadence). */
  stepDt: number
  tier: SimulationTier
}

const REDUCED_STEP_SECONDS = 1 / 15

/** Per-entity accumulator lives in the caller's ref. */
export function gateEntitySimulation(
  x: number,
  z: number,
  dt: number,
  accumulator: { reducedDt: number },
): EntitySimulationGate {
  // Streaming not running (standalone component tests, boot frames): the
  // world is fully simulated exactly as before this system existed.
  if (!isStreamingActive()) return { simulate: true, stepDt: dt, tier: 'full' }
  const state = getSectorRuntimeState(worldToSectorId(x, z))
  // Unauthored void or registry gap: simulate fully (never strand gameplay).
  if (!state) return { simulate: true, stepDt: dt, tier: 'full' }
  if (!isSectorMounted(state)) {
    return { simulate: false, stepDt: 0, tier: 'dormant' }
  }
  if (state.simulationTier === 'reduced') {
    accumulator.reducedDt += dt
    if (accumulator.reducedDt >= REDUCED_STEP_SECONDS) {
      const step = accumulator.reducedDt
      accumulator.reducedDt = 0
      return { simulate: true, stepDt: step, tier: 'reduced' }
    }
    return { simulate: true, stepDt: 0, tier: 'reduced' }
  }
  return { simulate: true, stepDt: dt, tier: 'full' }
}
