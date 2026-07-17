import type { Point2 } from '../world/trafficAvoidance'
import { isObstacleNear } from '../world/trafficAvoidance'
import type {
  CarSlowdownReason,
  CarTrafficState,
  CrosswalkStatusView,
  RoadLane,
} from './trafficTypes'
import { TRAFFIC_TUNING, type StopSign } from './trafficData'
import { getObstacleAhead, gradeSpeedForDistance, isHeadingToward } from './trafficAwareness'
import {
  getSignalStopDecision,
  type StopLine,
  type VehicleSignal,
} from './signalRules'
import {
  getVehicleObstacleAhead,
  hasEmergencyVehicleContact,
  type VehicleFootprint,
} from './vehicleObstacles'

export { gradeSpeedForDistance } from './trafficAwareness'

export interface CarDecisionInput {
  position: Point2
  heading: number
  /** Per-car cruise speed (lane limit × car's speed factor). */
  cruiseSpeed: number
  lane: RoadLane
  /** Small point obstacles: pedestrians and the on-foot player. */
  obstacles: Point2[]
  /** Vehicle footprints: the driven car and other ambient cars. */
  vehicles: VehicleFootprint[]
  /** Own footprint (for the emergency anti-overlap test). */
  selfFootprint: VehicleFootprint
  /** Status of the crosswalks on this car's lane. */
  crosswalks: CrosswalkStatusView[]
  /** Current vehicle signal, or null for unsignalled streets. */
  vehicleSignal: VehicleSignal | null
  /** This lane's stop lines (only consulted when a signal is present). */
  stopLines: StopLine[]
  /** This lane's stop signs (behave like red until held-and-cleared). */
  stopSigns?: StopSign[]
  /** Sign ids this car has already stopped for and may roll through. */
  clearedStopSigns?: ReadonlySet<string>
  /** Crosswalk ids whose courtesy yield (to a waiting ped) has expired. */
  expiredYields?: ReadonlySet<string>
}

export interface CarDecision {
  targetSpeed: number
  reason: CarSlowdownReason
  /** Set when the reason is 'crosswalk'. */
  crosswalkId: string | null
  /** Set when the reason is 'stop_sign'. */
  stopSignId: string | null
  /** Which kind of vehicle is blocking when reason is 'follow'. */
  blockingVehicleKind: 'driven' | 'ambient' | null
  /**
   * True when footprints already touch: the caller must hold at zero and
   * must NOT advance along the path this frame (anti-overlap recovery).
   */
  emergencyContact: boolean
}

/**
 * One car's speed decision for this frame: the minimum of cruise speed, the
 * pedestrian envelope, the vehicle-following envelope, crosswalk etiquette
 * and the signal's stop-line demand — plus a hard emergency latch when
 * vehicle footprints actually touch.
 */
export function decideCarTargetSpeed(input: CarDecisionInput): CarDecision {
  const { lane } = input
  const t = TRAFFIC_TUNING
  let target = input.cruiseSpeed
  let reason: CarSlowdownReason = 'clear'
  let crosswalkId: string | null = null
  let stopSignId: string | null = null
  let blockingVehicleKind: CarDecision['blockingVehicleKind'] = null

  // Pedestrians / on-foot player in the corridor ahead.
  const obstacle = getObstacleAhead(input.position, input.heading, input.obstacles, {
    lookAhead: lane.slowDistance,
    laneHalfWidth: lane.laneWidth / 2,
    obstacleRadius: t.obstacleRadius,
  })
  if (obstacle) {
    const graded = gradeSpeedForDistance(
      obstacle.distance,
      lane.stopDistance,
      lane.slowDistance,
      input.cruiseSpeed,
    )
    if (graded < target) {
      target = graded
      reason = 'obstacle'
    }
  }
  // Pedestrian emergency: someone essentially touching the car.
  if (target > 0 && isObstacleNear(input.position, input.obstacles, t.emergencyRadius)) {
    target = 0
    reason = 'obstacle'
  }

  // Vehicles ahead (driven car and same-direction ambient cars), measured
  // to their true near edge so bodies never interpenetrate.
  const vehicleAhead = getVehicleObstacleAhead(input.position, input.heading, input.vehicles, {
    lookAhead: t.vehicleLookAhead,
    laneHalfWidth: t.vehicleLaneHalfWidth,
    ownHalfLength: input.selfFootprint.halfLength,
    selfId: input.selfFootprint.id,
  })
  if (vehicleAhead) {
    const graded = gradeSpeedForDistance(
      vehicleAhead.distance,
      t.vehicleStopDistance,
      t.vehicleSlowDistance,
      input.cruiseSpeed,
    )
    if (graded < target) {
      target = graded
      reason = 'follow'
      blockingVehicleKind = vehicleAhead.kind
    }
  }

  // Crosswalk etiquette: an occupied crossing stops the car regardless of
  // the light; the courtesy stop for a *waiting* pedestrian applies only on
  // unsignalled streets (signals already sequence waiting pedestrians).
  for (const cw of input.crosswalks) {
    const distance = Math.hypot(cw.center.x - input.position.x, cw.center.z - input.position.z)
    const approaching =
      distance <= t.crosswalkYieldDistance &&
      isHeadingToward(input.position, input.heading, cw.center)
    if (!approaching) continue
    const courtesy =
      input.vehicleSignal === null &&
      cw.hasWaitingPedestrian &&
      !input.expiredYields?.has(cw.id)
    if ((cw.occupied || courtesy) && target > 0) {
      target = 0
      reason = 'crosswalk'
      crosswalkId = cw.id
    }
  }

  // Signal stop lines.
  if (input.vehicleSignal !== null) {
    for (const line of input.stopLines) {
      const signalTarget = getSignalStopDecision(
        input.position,
        input.heading,
        input.vehicleSignal,
        line,
        input.cruiseSpeed,
      )
      if (signalTarget !== null && signalTarget < target) {
        target = signalTarget
        reason = 'signal'
        blockingVehicleKind = null
      }
    }
  }

  // Stop signs: behave like a red light until the car has held at the sign;
  // once cleared, the sign is ignored until the car passes it.
  for (const sign of input.stopSigns ?? []) {
    if (input.clearedStopSigns?.has(sign.id)) continue
    const signTarget = getSignalStopDecision(
      input.position,
      input.heading,
      'red',
      { laneId: sign.laneId, position: sign.position, direction: sign.direction },
      input.cruiseSpeed,
    )
    if (signTarget !== null && signTarget < target) {
      target = signTarget
      reason = 'stop_sign'
      stopSignId = sign.id
      blockingVehicleKind = null
    }
  }

  // Emergency anti-overlap latch: footprints touching → freeze in place.
  const emergencyContact = hasEmergencyVehicleContact(input.selfFootprint, input.vehicles)
  if (emergencyContact && target > 0) {
    target = 0
    if (reason === 'clear') {
      reason = 'follow'
      blockingVehicleKind = blockingVehicleKind ?? 'ambient'
    }
  }

  // Commit to a full stop instead of creeping asymptotically down the ramp.
  if (target > 0 && target < t.minMovingSpeed && reason !== 'clear') {
    target = 0
  }

  return { targetSpeed: target, reason, crosswalkId, stopSignId, blockingVehicleKind, emergencyContact }
}

export interface CarStateInput {
  speed: number
  targetSpeed: number
  cruiseSpeed: number
  reason: CarSlowdownReason
  blockedTime: number
}

/** Human-readable car state for debug + tests, derived from the decision. */
export function classifyCarState(input: CarStateInput): CarTrafficState {
  const stopped = input.speed < 0.2
  if (input.targetSpeed === 0) {
    if (stopped && input.reason === 'crosswalk') return 'yielding'
    if (stopped) return input.blockedTime >= TRAFFIC_TUNING.honkAfterBlocked ? 'blocked' : 'stopped'
    return 'slowing'
  }
  if (input.targetSpeed < input.speed - 0.3) return 'slowing'
  if (input.speed < input.targetSpeed - 0.3) return 'resuming'
  return 'cruising'
}

/** Honk when blocked past the threshold, respecting the spam cooldown. */
export function shouldHonk(blockedTime: number, now: number, lastHonkAt: number): boolean {
  return (
    blockedTime >= TRAFFIC_TUNING.honkAfterBlocked &&
    now - lastHonkAt >= TRAFFIC_TUNING.honkCooldown
  )
}
