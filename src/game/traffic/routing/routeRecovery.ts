import type { CarSlowdownReason } from '../trafficTypes'
import type { BlockageReason, RoadGraph } from './roadGraphTypes'
import { closestPointOnSegment } from './roadGraphBuilder'
import { measureRouteDeviation, reanchorOnRoute } from './routeProgress'
import type { VehicleRouteState } from './routeRuntime'

/**
 * Blockage classification + staged, bounded recovery.
 *
 * Normal traffic life (red lights, pedestrians, queues, the player parking
 * badly for a moment) NEVER triggers recovery — those reasons reset the
 * clock. Only genuine no-progress states escalate, one stage at a time,
 * with cooldowns so a stuck car cannot thrash through replans.
 */

/** Stage escalation timeline (seconds without progress). */
export const STAGE1_REFRESH_AT = 8
export const STAGE2_REPLAN_AT = 18
export const STAGE3_PROJECT_AT = 26
export const STAGE4_RESPAWN_AT = 35
/** Minimum time between recovery actions. */
export const RECOVERY_COOLDOWN = 6
/** Hard cap: past this many actions the next escalation is a respawn. */
export const MAX_RECOVERY_ATTEMPTS = 6
/** A leader car stalled this long stops counting as "normal following". */
export const LEADER_STALL_TOLERANCE = 20
/**
 * Junction-box holds (downstreamFull) are NORMAL queueing — busy
 * intersections legitimately hold cars for tens of seconds. They never
 * replan (the route isn't the problem; the box is) and only a true
 * gridlock past this threshold triggers the respawn escape hatch.
 */
export const GRIDLOCK_RESPAWN_AT = 45

export interface BlockageInput {
  /** Decision-engine slowdown reason for this frame. */
  reason: CarSlowdownReason
  blockingVehicleKind: 'driven' | 'ambient' | null
  /** True when the junction anti-gridlock hold is active. */
  downstreamHold: boolean
  /** True when the car has drifted off its route corridor. */
  offLane: boolean
  /** True when the route/graph references broke (missing segment…). */
  routeInvalid: boolean
  /** True while the anti-overlap latch freezes the car (bodies touching). */
  emergencyContact?: boolean
  speed: number
  targetSpeed: number
}

/** Map the current frame's context onto a semantic blockage reason. */
export function classifyBlockage(input: BlockageInput, stoppedTime: number): BlockageReason {
  if (input.routeInvalid) return 'routeGeometry'
  if (input.offLane) return 'offLane'
  if (input.speed > 0.5 || input.targetSpeed > 0.5) return 'none'
  // Touching another ambient car is never a normal wait — a driven-car
  // touch stays benign (the player will move; never teleport away from
  // the player), but ambient-vs-ambient contact must resolve quickly.
  if (input.emergencyContact && input.blockingVehicleKind !== 'driven') return 'leader'
  if (input.downstreamHold) return 'downstreamFull'
  switch (input.reason) {
    case 'signal':
    case 'stop_sign':
      return 'signal'
    case 'crosswalk':
    case 'obstacle':
      return 'pedestrian'
    case 'follow':
      if (input.blockingVehicleKind === 'driven') return 'playerVehicle'
      return stoppedTime > LEADER_STALL_TOLERANCE ? 'leader' : 'none'
    default:
      // Stopped with no reason at all IS suspect — the stage-1 threshold
      // already provides the grace period before anything acts on it.
      return 'unknown'
  }
}

/** Reasons that legitimately pause a car forever without recovery. */
export function isBenignBlockage(reason: BlockageReason): boolean {
  return reason === 'none' || reason === 'signal' || reason === 'pedestrian' || reason === 'playerVehicle'
}

export type RecoveryAction =
  | { kind: 'none' }
  | { kind: 'refreshTarget' }
  | { kind: 'replan'; penalizeNextSegment: boolean }
  | { kind: 'projectToLane' }
  | { kind: 'respawn' }

/**
 * One recovery tick. Two clocks:
 * - stoppedTime: total time at standstill (any reason) — feeds leader-stall
 *   classification so a frozen queue eventually counts as blocked
 * - suspectTime: time stopped WITHOUT a legitimate reason — the only clock
 *   that escalates recovery stages
 * A red light accumulates stoppedTime forever but never suspectTime.
 */
export function updateRecovery(
  _graph: RoadGraph,
  state: VehicleRouteState,
  input: BlockageInput,
  now: number,
  dt: number,
): RecoveryAction {
  const moving = input.speed > 0.5 || input.targetSpeed > 0.5
  if (moving) {
    state.stoppedTime = 0
    state.suspectTime = 0
    state.recoveryStage = 0
    state.blockageReason = 'none'
    return { kind: 'none' }
  }
  state.stoppedTime += dt
  const reason = classifyBlockage(input, state.stoppedTime)
  state.blockageReason = reason

  if (isBenignBlockage(reason)) {
    state.suspectTime = 0
    state.recoveryStage = 0
    return { kind: 'none' }
  }
  // Junction-box queueing: no stage machine, no replans — only the bounded
  // gridlock escape hatch after a long continuous standstill.
  if (reason === 'downstreamFull') {
    state.suspectTime = 0
    if (state.stoppedTime >= GRIDLOCK_RESPAWN_AT && now >= state.recoveryCooldownUntil) {
      state.recoveryStage = 4
      state.recoveryCooldownUntil = now + RECOVERY_COOLDOWN
      return { kind: 'respawn' }
    }
    return { kind: 'none' }
  }
  state.suspectTime += dt

  if (now < state.recoveryCooldownUntil) return { kind: 'none' }
  if (state.recoveryAttempts >= MAX_RECOVERY_ATTEMPTS) {
    state.recoveryStage = 4
    state.recoveryCooldownUntil = now + RECOVERY_COOLDOWN
    state.recoveryAttempts = 0
    return { kind: 'respawn' }
  }

  const act = (stage: 1 | 2 | 3 | 4, action: RecoveryAction): RecoveryAction => {
    state.recoveryStage = stage
    state.recoveryCooldownUntil = now + RECOVERY_COOLDOWN
    state.recoveryAttempts += 1
    return action
  }

  if (state.suspectTime >= STAGE4_RESPAWN_AT) return act(4, { kind: 'respawn' })
  // Stage 3 projection frees off-lane cars AND persistent body contact —
  // replanning cannot physically unlatch two touching footprints.
  if (
    (reason === 'offLane' || input.emergencyContact) &&
    state.suspectTime >= STAGE3_PROJECT_AT
  ) {
    return act(3, { kind: 'projectToLane' })
  }
  if (state.suspectTime >= STAGE2_REPLAN_AT || reason === 'routeGeometry') {
    return act(2, { kind: 'replan', penalizeNextSegment: reason !== 'routeGeometry' })
  }
  if (state.suspectTime >= STAGE1_REFRESH_AT) return act(1, { kind: 'refreshTarget' })
  return { kind: 'none' }
}

export interface NearestSegmentHit {
  segmentId: string
  progress: number
  distance: number
}

/** Nearest graph segment to a world position (recovery / teleport anchor). */
export function findNearestSegment(
  graph: RoadGraph,
  x: number,
  z: number,
  maxDistance = 6,
): NearestSegmentHit | null {
  let best: NearestSegmentHit | null = null
  for (const [id, seg] of graph.segments) {
    // Recovery re-anchors onto LANES; junction arcs are transient space.
    if (seg.kind === 'junction') continue
    const near = closestPointOnSegment(seg, x, z)
    if (near.distance <= maxDistance && (!best || near.distance < best.distance)) {
      best = { segmentId: id, progress: near.progress, distance: near.distance }
    }
  }
  return best
}

export interface MissedTurnCheck {
  kind: 'onRoute' | 'reanchored' | 'needsReplan' | 'lost'
}

/**
 * Missed-turn / overshoot handling:
 * 1. still near the planned corridor → nothing to do
 * 2. clearly sitting on ANOTHER segment of the same route → re-anchor
 * 3. on a valid graph lane that is NOT on the route → replan from there
 * 4. nowhere near the network → lost (stage escalation handles it)
 */
export function checkMissedTurn(
  graph: RoadGraph,
  state: VehicleRouteState,
  x: number,
  z: number,
): MissedTurnCheck {
  const deviation = measureRouteDeviation(graph, state, x, z)
  if (!deviation) return { kind: 'lost' }
  if (!deviation.offLane) return { kind: 'onRoute' }
  if (reanchorOnRoute(graph, state, x, z, 2.5)) return { kind: 'reanchored' }
  const nearest = findNearestSegment(graph, x, z, 2.5)
  if (nearest) return { kind: 'needsReplan' }
  return { kind: 'lost' }
}
