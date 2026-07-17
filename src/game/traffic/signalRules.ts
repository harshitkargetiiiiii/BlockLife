import type { Point2 } from '../world/trafficAvoidance'
import type { Vec2 } from '../world/worldTypes'
import { gradeSpeedForDistance } from './trafficAwareness'

/**
 * One deterministic signal cycle drives both painted crosswalks: vehicles
 * and pedestrians alternate, with yellow + all-red + clearance buffers so
 * nobody gets caught mid-intersection. Pure functions over elapsed seconds —
 * no timers, fully unit-testable, deterministic when the world pauses.
 */
export type TrafficSignalPhase =
  | 'vehicle_green'
  | 'vehicle_yellow'
  | 'all_red'
  | 'pedestrian_walk'
  | 'pedestrian_clearance'

export type VehicleSignal = 'green' | 'yellow' | 'red'
export type PedestrianSignal = 'walk' | 'clearance' | 'dont_walk'

export interface SignalCycleStep {
  phase: TrafficSignalPhase
  duration: number
}

export const SIGNAL_CYCLE: SignalCycleStep[] = [
  { phase: 'vehicle_green', duration: 14 },
  { phase: 'vehicle_yellow', duration: 2.5 },
  { phase: 'all_red', duration: 1.5 },
  { phase: 'pedestrian_walk', duration: 7 },
  { phase: 'pedestrian_clearance', duration: 4 },
]

export const SIGNAL_CYCLE_LENGTH = SIGNAL_CYCLE.reduce((sum, s) => sum + s.duration, 0)

export interface PhaseAt {
  phase: TrafficSignalPhase
  /** Seconds until the next phase begins. */
  remaining: number
}

export function getPhaseAt(elapsedSeconds: number): PhaseAt {
  let t = ((elapsedSeconds % SIGNAL_CYCLE_LENGTH) + SIGNAL_CYCLE_LENGTH) % SIGNAL_CYCLE_LENGTH
  for (const step of SIGNAL_CYCLE) {
    if (t < step.duration) return { phase: step.phase, remaining: step.duration - t }
    t -= step.duration
  }
  // Unreachable (t < cycle length), but keeps the types honest.
  return { phase: SIGNAL_CYCLE[0].phase, remaining: SIGNAL_CYCLE[0].duration }
}

/** Elapsed-seconds offset at which a phase starts (for the dev/test API). */
export function getPhaseStartOffset(phase: TrafficSignalPhase): number {
  let offset = 0
  for (const step of SIGNAL_CYCLE) {
    if (step.phase === phase) return offset
    offset += step.duration
  }
  return 0
}

export function getVehicleSignal(phase: TrafficSignalPhase): VehicleSignal {
  if (phase === 'vehicle_green') return 'green'
  if (phase === 'vehicle_yellow') return 'yellow'
  return 'red'
}

export function getPedestrianSignal(phase: TrafficSignalPhase): PedestrianSignal {
  if (phase === 'pedestrian_walk') return 'walk'
  if (phase === 'pedestrian_clearance') return 'clearance'
  return 'dont_walk'
}

export interface StopLine {
  laneId: string
  /** Car center should halt here — one car-length short of the zone. */
  position: Vec2
  /** Unit direction of lane travel across this line. */
  direction: Vec2
}

/** Committed to the intersection: a yellow this close doesn't brake. */
export const YELLOW_COMMIT_DISTANCE = 4
/** Signals begin braking cars inside this distance of the stop line. */
export const SIGNAL_SLOW_DISTANCE = 6

/**
 * Target speed imposed by a signal for one stop line, or null when the
 * signal doesn't constrain the car (green, already past the line, heading
 * elsewhere, or committed on yellow).
 */
export function getSignalStopDecision(
  position: Point2,
  heading: number,
  signal: VehicleSignal,
  stopLine: StopLine,
  cruiseSpeed: number,
): number | null {
  if (signal === 'green') return null
  // Only lines we're actually driving toward apply.
  const fx = Math.sin(heading)
  const fz = Math.cos(heading)
  if (fx * stopLine.direction[0] + fz * stopLine.direction[1] < 0.5) return null
  const d =
    (stopLine.position[0] - position.x) * stopLine.direction[0] +
    (stopLine.position[1] - position.z) * stopLine.direction[1]
  if (d < -0.5) return null // already past — clear the intersection
  if (signal === 'yellow' && d <= YELLOW_COMMIT_DISTANCE) return null
  return gradeSpeedForDistance(d, 0.4, SIGNAL_SLOW_DISTANCE, cruiseSpeed)
}
