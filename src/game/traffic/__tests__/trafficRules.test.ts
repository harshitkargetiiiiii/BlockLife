import { describe, expect, it } from 'vitest'
import { getObstacleAhead } from '../trafficAwareness'
import {
  classifyCarState,
  decideCarTargetSpeed,
  gradeSpeedForDistance,
  shouldHonk,
  type CarDecisionInput,
} from '../trafficRules'
import { LANES_BY_ID, TRAFFIC_TUNING } from '../trafficData'
import {
  CAR_HALF_LENGTH,
  CAR_HALF_WIDTH,
  type VehicleFootprint,
} from '../vehicleObstacles'

const lane = LANES_BY_ID['lane_inner_cw']

export function footprint(overrides: Partial<VehicleFootprint>): VehicleFootprint {
  return {
    id: 'other',
    kind: 'ambient',
    position: { x: 0, z: 0 },
    heading: 0,
    halfLength: CAR_HALF_LENGTH,
    halfWidth: CAR_HALF_WIDTH,
    speed: 0,
    ...overrides,
  }
}

/** Car at origin heading +z (heading angle 0), cruising at the lane limit. */
function baseInput(overrides: Partial<CarDecisionInput> = {}): CarDecisionInput {
  return {
    position: { x: 0, z: 0 },
    heading: 0,
    cruiseSpeed: lane.speedLimit,
    lane,
    obstacles: [],
    vehicles: [],
    selfFootprint: footprint({ id: 'self' }),
    crosswalks: [],
    vehicleSignal: null,
    stopLines: [],
    ...overrides,
  }
}

describe('car lookahead (pedestrians)', () => {
  it('detects an obstacle ahead but ignores one behind', () => {
    const opts = { lookAhead: 6, laneHalfWidth: 1.3, obstacleRadius: 0.8 }
    expect(getObstacleAhead({ x: 0, z: 0 }, 0, [{ x: 0, z: 4 }], opts)?.distance).toBeCloseTo(4)
    expect(getObstacleAhead({ x: 0, z: 0 }, 0, [{ x: 0, z: -4 }], opts)).toBeNull()
    expect(getObstacleAhead({ x: 0, z: 0 }, Math.PI, [{ x: 0, z: -4 }], opts)).not.toBeNull()
  })

  it('ignores obstacles outside the lane width', () => {
    const opts = { lookAhead: 6, laneHalfWidth: 1.3, obstacleRadius: 0.8 }
    expect(getObstacleAhead({ x: 0, z: 0 }, 0, [{ x: 3, z: 4 }], opts)).toBeNull()
    expect(getObstacleAhead({ x: 0, z: 0 }, 0, [{ x: 1, z: 4 }], opts)).not.toBeNull()
  })
})

describe('car speed decisions', () => {
  it('cruises at full speed when the road is clear', () => {
    const d = decideCarTargetSpeed(baseInput())
    expect(d.targetSpeed).toBe(lane.speedLimit)
    expect(d.reason).toBe('clear')
    expect(d.emergencyContact).toBe(false)
  })

  it('slows smoothly for a pedestrian within slowDistance, stops within stopDistance', () => {
    const midway = (lane.stopDistance + lane.slowDistance) / 2
    const slowing = decideCarTargetSpeed(baseInput({ obstacles: [{ x: 0, z: midway }] }))
    expect(slowing.reason).toBe('obstacle')
    expect(slowing.targetSpeed).toBeGreaterThan(0)
    expect(slowing.targetSpeed).toBeLessThan(lane.speedLimit)
    const stopped = decideCarTargetSpeed(
      baseInput({ obstacles: [{ x: 0, z: lane.stopDistance - 0.4 }] }),
    )
    expect(stopped.targetSpeed).toBe(0)
  })

  it('keeps following distance from a same-direction car ahead', () => {
    const t = TRAFFIC_TUNING
    // Near edge at (vehicleStop+vehicleSlow)/2: z = that + halfLength.
    const mid = (t.vehicleStopDistance + t.vehicleSlowDistance) / 2
    const following = decideCarTargetSpeed(
      baseInput({ vehicles: [footprint({ position: { x: 0, z: mid + CAR_HALF_LENGTH } })] }),
    )
    expect(following.reason).toBe('follow')
    expect(following.blockingVehicleKind).toBe('ambient')
    expect(following.targetSpeed).toBeGreaterThan(0)
    expect(following.targetSpeed).toBeLessThan(lane.speedLimit)

    const tooClose = decideCarTargetSpeed(
      baseInput({
        vehicles: [
          footprint({ position: { x: 0, z: t.vehicleStopDistance + CAR_HALF_LENGTH - 0.3 } }),
        ],
      }),
    )
    expect(tooClose.targetSpeed).toBe(0)
  })

  it('stops before overlapping the driven car — near-edge math leaves a real gap', () => {
    const t = TRAFFIC_TUNING
    // Driven car dead ahead: near edge at stop distance → target 0 while
    // bumper gap is still vehicleStopDistance − ownHalfLength ≈ 1.25 units.
    const d = decideCarTargetSpeed(
      baseInput({
        vehicles: [
          footprint({
            id: 'vehicle_compact_car_01',
            kind: 'driven',
            position: { x: 0, z: t.vehicleStopDistance + CAR_HALF_LENGTH },
          }),
        ],
      }),
    )
    expect(d.targetSpeed).toBe(0)
    expect(d.reason).toBe('follow')
    expect(d.blockingVehicleKind).toBe('driven')
    expect(t.vehicleStopDistance - CAR_HALF_LENGTH).toBeGreaterThan(1)
  })

  it('ignores the driven car far outside the lane corridor', () => {
    const d = decideCarTargetSpeed(
      baseInput({
        vehicles: [footprint({ kind: 'driven', position: { x: 6, z: 5 } })],
      }),
    )
    expect(d.reason).toBe('clear')
    expect(d.targetSpeed).toBe(lane.speedLimit)
  })

  it('ignores oncoming ambient traffic in the adjacent lane', () => {
    const oncoming = decideCarTargetSpeed(
      baseInput({
        vehicles: [footprint({ position: { x: 2.8, z: 5 }, heading: Math.PI })],
      }),
    )
    expect(oncoming.reason).toBe('clear')
  })

  it('emergency-stops when the driven car is already touching — and latches no-advance', () => {
    const d = decideCarTargetSpeed(
      baseInput({
        vehicles: [footprint({ kind: 'driven', position: { x: 0.5, z: 2 } })],
      }),
    )
    expect(d.targetSpeed).toBe(0)
    expect(d.emergencyContact).toBe(true)
  })

  it('stops for an occupied crosswalk even on a green light', () => {
    const cw = {
      id: 'crosswalk_north',
      center: { x: 0, z: 4 },
      occupied: true,
      hasWaitingPedestrian: false,
    }
    const d = decideCarTargetSpeed(baseInput({ crosswalks: [cw], vehicleSignal: 'green' }))
    expect(d.targetSpeed).toBe(0)
    expect(d.reason).toBe('crosswalk')
  })

  it('courtesy-stops for a waiting pedestrian only on unsignalled streets', () => {
    const cw = {
      id: 'crosswalk_north',
      center: { x: 0, z: 4 },
      occupied: false,
      hasWaitingPedestrian: true,
    }
    expect(
      decideCarTargetSpeed(baseInput({ crosswalks: [cw], vehicleSignal: null })).targetSpeed,
    ).toBe(0)
    // With a signal, the light sequences the pedestrian — no courtesy stop.
    expect(
      decideCarTargetSpeed(baseInput({ crosswalks: [cw], vehicleSignal: 'green' })).targetSpeed,
    ).toBe(lane.speedLimit)
    // Courtesy expiry still honored when unsignalled.
    expect(
      decideCarTargetSpeed(
        baseInput({
          crosswalks: [cw],
          vehicleSignal: null,
          expiredYields: new Set(['crosswalk_north']),
        }),
      ).targetSpeed,
    ).toBe(lane.speedLimit)
  })

  it('signal and obstacle demands combine as the minimum', () => {
    // Red stop line 5 ahead grades low; a pedestrian 2 ahead grades to zero.
    const d = decideCarTargetSpeed(
      baseInput({
        vehicleSignal: 'red',
        stopLines: [{ laneId: lane.id, position: [0, 5], direction: [0, 1] }],
        obstacles: [{ x: 0, z: 2 }],
      }),
    )
    expect(d.targetSpeed).toBe(0)
    expect(d.reason).toBe('obstacle')
    // Signal alone: graded stop toward the line.
    const signalOnly = decideCarTargetSpeed(
      baseInput({
        vehicleSignal: 'red',
        stopLines: [{ laneId: lane.id, position: [0, 5], direction: [0, 1] }],
      }),
    )
    expect(signalOnly.reason).toBe('signal')
    expect(signalOnly.targetSpeed).toBeLessThan(lane.speedLimit)
  })
})

describe('car state + honk', () => {
  it('classifies the state lifecycle', () => {
    const base = { cruiseSpeed: 5.5, blockedTime: 0 }
    expect(classifyCarState({ ...base, speed: 5.5, targetSpeed: 5.5, reason: 'clear' })).toBe('cruising')
    expect(classifyCarState({ ...base, speed: 5.5, targetSpeed: 2, reason: 'obstacle' })).toBe('slowing')
    expect(classifyCarState({ ...base, speed: 0.05, targetSpeed: 0, reason: 'signal' })).toBe('stopped')
    expect(classifyCarState({ ...base, speed: 0.05, targetSpeed: 0, reason: 'crosswalk' })).toBe('yielding')
    expect(classifyCarState({ ...base, speed: 1, targetSpeed: 5.5, reason: 'clear' })).toBe('resuming')
    expect(
      classifyCarState({ ...base, speed: 0.05, targetSpeed: 0, reason: 'obstacle', blockedTime: 3 }),
    ).toBe('blocked')
  })

  it('honk can trigger while stopped behind the driven car, respecting cooldown', () => {
    // The decision reports the driven blocker; the controller accrues
    // blockedTime for it and shouldHonk gates the bubble/audio.
    const d = decideCarTargetSpeed(
      baseInput({
        vehicles: [
          footprint({
            kind: 'driven',
            position: { x: 0, z: TRAFFIC_TUNING.vehicleStopDistance + CAR_HALF_LENGTH - 0.5 },
          }),
        ],
      }),
    )
    expect(d.targetSpeed).toBe(0)
    expect(d.blockingVehicleKind).toBe('driven')
    expect(shouldHonk(1, 100, 0)).toBe(false)
    expect(shouldHonk(3, 100, 0)).toBe(true)
    expect(shouldHonk(3, 100, 97)).toBe(false)
    expect(shouldHonk(3, 104, 97)).toBe(true)
  })
})

describe('braking envelope', () => {
  it('grades linearly between stop and slow distances', () => {
    expect(gradeSpeedForDistance(1, 2, 6, 8)).toBe(0)
    expect(gradeSpeedForDistance(6, 2, 6, 8)).toBe(8)
    expect(gradeSpeedForDistance(4, 2, 6, 8)).toBeCloseTo(4)
  })

  it('sub-crawl targets commit to a full stop (no asymptotic creep)', () => {
    // Pedestrian a hair outside stopDistance grades to ~0.19 — must clamp
    // to zero so blocked/honk/state logic can latch behind obstacles.
    const d = decideCarTargetSpeed(
      baseInput({ obstacles: [{ x: 0, z: lane.stopDistance + 0.1 }] }),
    )
    expect(d.targetSpeed).toBe(0)
  })
})
