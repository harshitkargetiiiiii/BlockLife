import type { Vec2 } from '../world/worldTypes'

/**
 * Robbery Pursuit & Getaway Polish v1 — police containment + breach escalation
 * (pure, deterministic, real-clamped-delta timers). This owns NO police or
 * pursuit logic; it only decides the CONTAINMENT PHASE around a robbed store's
 * exterior while the player is inside, and when a fair forced-exit "breach"
 * fires. The police director reads the containment target (the entrance) and
 * routes/contains through the EXISTING dispatch + dismount stack — this file
 * never spawns police or sets wanted.
 *
 * Flow: alarm/report → responding → contained → warning → breach (forced exit).
 * The interior is a scene the police can't enter in v1, so "breach" is the
 * smallest safe repository-compatible pressure: after a readable warning the
 * store forcibly ejects the player into the contained exterior (i.e. straight
 * into the pursuit). No instant spawns, no wall phasing — the player and police
 * are never in the same scene until the exit.
 */

export type ContainmentPhase = 'none' | 'responding' | 'contained' | 'warning' | 'breached'

/** Seconds police take to arrive + contain once a wanted robbery is inside. */
export const RESPOND_SECONDS = 6
/** Seconds of containment before the breach warning starts. */
export const CONTAIN_SECONDS = 8
/** Readable warning window before the forced-exit breach. */
export const WARNING_SECONDS = 6

export interface ContainmentState {
  /** The robbed store being contained, or null. */
  storeId: string | null
  phase: ContainmentPhase
  /** Time accumulated in the current phase (seconds, real clamped delta). */
  phaseSeconds: number
  /** Idempotent: the forced-exit breach has already fired. */
  breached: boolean
}

export function freshContainment(): ContainmentState {
  return { storeId: null, phase: 'none', phaseSeconds: 0, breached: false }
}

export interface ContainmentContext {
  /** The robbed store the player is currently inside with wanted > 0, or null. */
  activeStoreId: string | null
  /** At least one responder is near the entrance (drives responding→contained). */
  respondersOnScene: boolean
}

export interface ContainmentStep {
  /** Force the player out of the store now (breach). Fired exactly once. */
  forceExit: boolean
}

/**
 * Advance the containment phase machine one tick. Deterministic given
 * (state, ctx, dt). Returns whether a forced exit should fire this tick.
 */
export function stepContainment(
  state: ContainmentState,
  ctx: ContainmentContext,
  dt: number,
): ContainmentStep {
  // No wanted robbery in a store → containment stands down.
  if (ctx.activeStoreId === null) {
    if (state.phase !== 'none') resetContainment(state)
    return { forceExit: false }
  }

  // Entering / switching stores (re)starts the flow deterministically.
  if (state.storeId !== ctx.activeStoreId) {
    state.storeId = ctx.activeStoreId
    state.phase = 'responding'
    state.phaseSeconds = 0
    state.breached = false
  }

  state.phaseSeconds += dt
  switch (state.phase) {
    case 'responding':
      // Contain once responders arrive, or after the fallback response time.
      if (ctx.respondersOnScene || state.phaseSeconds >= RESPOND_SECONDS) {
        advance(state, 'contained')
      }
      break
    case 'contained':
      if (state.phaseSeconds >= CONTAIN_SECONDS) advance(state, 'warning')
      break
    case 'warning':
      if (state.phaseSeconds >= WARNING_SECONDS && !state.breached) {
        state.breached = true
        advance(state, 'breached')
        return { forceExit: true }
      }
      break
    case 'breached':
      // Terminal until the player leaves (handled by activeStoreId → null).
      break
  }
  return { forceExit: false }
}

/** Seconds remaining before the breach forces an exit, or null if not warning. */
export function breachCountdown(state: ContainmentState): number | null {
  if (state.phase !== 'warning') return null
  return Math.max(0, WARNING_SECONDS - state.phaseSeconds)
}

/** Deterministic containment positions around a store entrance (entrance + two
 *  side angles), so officers form up rather than pile on one spot. */
export function containmentPositions(entrance: Vec2, heading: number): Vec2[] {
  const [ex, ez] = entrance
  const fx = Math.sin(heading)
  const fz = Math.cos(heading)
  // Right-hand perpendicular.
  const px = fz
  const pz = -fx
  const FRONT = 3.5
  const SIDE = 3.0
  return [
    [ex + fx * FRONT, ez + fz * FRONT], // dead ahead of the door
    [ex + fx * FRONT + px * SIDE, ez + fz * FRONT + pz * SIDE], // right angle
    [ex + fx * FRONT - px * SIDE, ez + fz * FRONT - pz * SIDE], // left angle
  ]
}

function advance(state: ContainmentState, phase: ContainmentPhase): void {
  state.phase = phase
  state.phaseSeconds = 0
}

export function resetContainment(state: ContainmentState): void {
  state.storeId = null
  state.phase = 'none'
  state.phaseSeconds = 0
  state.breached = false
}
