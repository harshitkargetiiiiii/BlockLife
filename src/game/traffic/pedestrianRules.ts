import type { Vec2 } from '../world/worldTypes'
import type { CarAgentView, CrosswalkZone, PedestrianState } from './trafficTypes'
import { findCrosswalkOnSegment, isCrosswalkSafeToEnter } from './crosswalkUtils'
import { TRAFFIC_TUNING } from './trafficData'
import type { PedestrianSignal } from './signalRules'

export interface PedestrianDecisionInput {
  state: PedestrianState
  position: Vec2
  /** The waypoint the pedestrian is currently walking toward. */
  target: Vec2
  /** Seconds spent in waiting_to_cross. */
  waitTime: number
  crosswalks: CrosswalkZone[]
  cars: CarAgentView[]
  /** Walk indicator for signal-controlled crossings ('walk' when unsignalled). */
  pedestrianSignal: PedestrianSignal
  /**
   * Which crosswalks the shared signal governs. Unsignalled crossings (stop
   * signs, connector mouths) ignore the walk indicator and rely on the car
   * safety check alone. Omitted = treat every crossing as signalled.
   */
  signalledCrosswalkIds?: ReadonlySet<string>
  /**
   * Per-crosswalk walk indicator (signalized intersections run their own
   * plans on the global clock). Falls back to `pedestrianSignal`.
   */
  signalForCrosswalk?: (crosswalkId: string) => PedestrianSignal
  /**
   * Per-crosswalk jaywalk failsafe override. Intersection crossings need a
   * ceiling above their full cycle (a 46s split-phase red is a NORMAL wait,
   * not a stand-off). Falls back to TRAFFIC_TUNING.pedestrianMaxWait.
   */
  maxWaitForCrosswalk?: (crosswalkId: string) => number
}

export interface PedestrianDecision {
  state: PedestrianState
  /** Crosswalk relevant to the current state (waiting or crossing). */
  crosswalkId: string | null
  /** False while waiting: hold position at the wait spot. */
  mayMove: boolean
}

/**
 * One pedestrian's etiquette decision for this frame.
 *
 * - Walking toward a waypoint whose straight segment passes through a
 *   crosswalk: stop at the near side and wait.
 * - Waiting: cross when the signal says walk AND no rolling car threatens
 *   the zone AND a short curb pause has passed (organic, not robotic).
 *   Pedestrians may NOT start during clearance or don't-walk.
 * - Committed crossers keep going (clearance exists for exactly this).
 * - Failsafe: after `pedestrianMaxWait` (longer than a full signal cycle,
 *   so it never fires in normal operation) cross anyway — cars brake for
 *   pedestrians, so this breaks any pathological stand-off.
 */
export function decidePedestrian(input: PedestrianDecisionInput): PedestrianDecision {
  const t = TRAFFIC_TUNING
  const crossing = findCrosswalkOnSegment(input.position, input.target, input.crosswalks)

  if (input.state === 'crossing') {
    // Committed: finish the crossing (caller clears the state on arrival).
    return { state: 'crossing', crosswalkId: crossing?.id ?? null, mayMove: true }
  }

  if (!crossing) {
    return { state: 'walking_sidewalk', crosswalkId: null, mayMove: true }
  }

  const pausedLongEnough = input.waitTime >= t.curbPause
  const signalControlled = input.signalledCrosswalkIds?.has(crossing.id) ?? true
  const signal = input.signalForCrosswalk?.(crossing.id) ?? input.pedestrianSignal
  const signalAllows = !signalControlled || signal === 'walk'
  const safe = isCrosswalkSafeToEnter(crossing, input.cars, {
    dangerDistance: t.pedestrianDangerDistance,
    stoppedSpeed: t.stoppedSpeed,
  })
  const failsafe = input.waitTime >= (input.maxWaitForCrosswalk?.(crossing.id) ?? t.pedestrianMaxWait)

  if ((pausedLongEnough && signalAllows && safe) || failsafe) {
    return { state: 'crossing', crosswalkId: crossing.id, mayMove: true }
  }
  return { state: 'waiting_to_cross', crosswalkId: crossing.id, mayMove: false }
}
