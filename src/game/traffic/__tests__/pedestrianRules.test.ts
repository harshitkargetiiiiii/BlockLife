import { describe, expect, it } from 'vitest'
import { decidePedestrian } from '../pedestrianRules'
import { isCrosswalkSafeToEnter, pointInZone, segmentCrossesZone } from '../crosswalkUtils'
import { decideCarTargetSpeed } from '../trafficRules'
import { CROSSWALKS_BY_ID, LANES_BY_ID, TRAFFIC_TUNING } from '../trafficData'
import { CAR_HALF_LENGTH, CAR_HALF_WIDTH, type VehicleFootprint } from '../vehicleObstacles'
import type { CarAgentView, PedestrianState } from '../trafficTypes'

const northCw = CROSSWALKS_BY_ID['crosswalk_north']
const safetyOpts = {
  dangerDistance: TRAFFIC_TUNING.pedestrianDangerDistance,
  stoppedSpeed: TRAFFIC_TUNING.stoppedSpeed,
}

/** A car on the inner lane, `d` units west of the north crosswalk, heading east. */
function approachingCar(d: number, speed: number): CarAgentView {
  return { position: { x: -d, z: -24.6 }, heading: Math.PI / 2, speed }
}

describe('crosswalk geometry', () => {
  it('detects points and crossing segments', () => {
    expect(pointInZone({ x: 0, z: -26 }, northCw)).toBe(true)
    expect(pointInZone({ x: 4, z: -26 }, northCw)).toBe(false)
    expect(segmentCrossesZone([0, -22.2], [0, -29.8], northCw)).toBe(true)
    expect(segmentCrossesZone([-10, -21.8], [10, -21.8], northCw)).toBe(false)
    expect(segmentCrossesZone([30, -30], [-30, -30], northCw)).toBe(false)
  })
})

describe('pedestrian crossing safety', () => {
  it('waits while a car approaches the crosswalk', () => {
    expect(isCrosswalkSafeToEnter(northCw, [approachingCar(5, 5)], safetyOpts)).toBe(false)
  })

  it('crosses when no car is near', () => {
    expect(isCrosswalkSafeToEnter(northCw, [approachingCar(20, 5)], safetyOpts)).toBe(true)
    expect(isCrosswalkSafeToEnter(northCw, [], safetyOpts)).toBe(true)
  })

  it('crosses when the approaching car has already stopped/yielded', () => {
    expect(isCrosswalkSafeToEnter(northCw, [approachingCar(5, 0.1)], safetyOpts)).toBe(true)
  })

  it('a car driving away from the crossing is not a danger', () => {
    const leaving: CarAgentView = { position: { x: -5, z: -24.6 }, heading: -Math.PI / 2, speed: 5 }
    expect(isCrosswalkSafeToEnter(northCw, [leaving], safetyOpts)).toBe(true)
  })
})

describe('pedestrian state decisions', () => {
  const base = {
    position: [0, -22.2] as [number, number],
    target: [0, -29.8] as [number, number],
    waitTime: 1, // past the curb pause
    crosswalks: [northCw],
    pedestrianSignal: 'walk' as const,
  }

  it('waits at the curb when the segment crosses and a car approaches', () => {
    const d = decidePedestrian({ ...base, state: 'walking_sidewalk', cars: [approachingCar(5, 5)] })
    expect(d.state).toBe('waiting_to_cross')
    expect(d.crosswalkId).toBe('crosswalk_north')
    expect(d.mayMove).toBe(false)
  })

  it('cannot start crossing during dont_walk, even with an empty road', () => {
    const d = decidePedestrian({
      ...base,
      state: 'waiting_to_cross',
      cars: [],
      pedestrianSignal: 'dont_walk',
    })
    expect(d.state).toBe('waiting_to_cross')
  })

  it('cannot start during clearance, but a committed crosser finishes', () => {
    const waiting = decidePedestrian({
      ...base,
      state: 'waiting_to_cross',
      cars: [],
      pedestrianSignal: 'clearance',
    })
    expect(waiting.state).toBe('waiting_to_cross')
    const committed = decidePedestrian({
      ...base,
      state: 'crossing',
      cars: [approachingCar(3, 5)],
      pedestrianSignal: 'clearance',
    })
    expect(committed.state).toBe('crossing')
    expect(committed.mayMove).toBe(true)
  })

  it('crosses during walk when clear and past the curb pause', () => {
    const d = decidePedestrian({ ...base, state: 'waiting_to_cross', cars: [] })
    expect(d.state).toBe('crossing')
    expect(d.mayMove).toBe(true)
  })

  it('pauses briefly at the curb even when everything is clear', () => {
    const d = decidePedestrian({ ...base, state: 'walking_sidewalk', waitTime: 0, cars: [] })
    expect(d.state).toBe('waiting_to_cross')
    const after = decidePedestrian({
      ...base,
      state: 'waiting_to_cross',
      waitTime: TRAFFIC_TUNING.curbPause + 0.05,
      cars: [],
    })
    expect(after.state).toBe('crossing')
  })

  it('keeps walking on non-crossing segments', () => {
    const stroll = decidePedestrian({
      ...base,
      target: [10, -21.8],
      position: [-10, -21.8],
      state: 'walking_sidewalk',
      waitTime: 0,
      cars: [approachingCar(3, 5)],
    })
    expect(stroll.state).toBe('walking_sidewalk')
  })

  it('max-wait failsafe eventually commits the crossing (even on dont_walk)', () => {
    const d = decidePedestrian({
      ...base,
      state: 'waiting_to_cross',
      waitTime: TRAFFIC_TUNING.pedestrianMaxWait + 1,
      cars: [approachingCar(5, 5)],
      pedestrianSignal: 'dont_walk',
    })
    expect(d.state).toBe('crossing')
  })
})

describe('no deadlock: signalled crossing handshake completes', () => {
  it('ped crosses on walk, car stops at red, car resumes on green', () => {
    const lane = LANES_BY_ID['lane_inner_cw']
    const dt = 0.1
    const self: VehicleFootprint = {
      id: 'self',
      kind: 'ambient',
      position: { x: -12, z: -24.6 },
      heading: Math.PI / 2,
      halfLength: CAR_HALF_LENGTH,
      halfWidth: CAR_HALF_WIDTH,
      speed: 0,
    }
    let carX = -12
    let carSpeed = lane.speedLimit
    let pedZ = -22.2
    let pedState: PedestrianState = 'walking_sidewalk'
    let pedDone = false
    let pedWait = 0
    const pedSpeed = 2.4
    // Scripted signal: red+walk for the first 6 seconds, then green.
    const signalAt = (time: number) =>
      time < 6
        ? { vehicle: 'red' as const, pedestrian: 'walk' as const }
        : { vehicle: 'green' as const, pedestrian: 'dont_walk' as const }

    let resumed = false
    for (let step = 0; step < 600 && !resumed; step++) {
      const time = step * dt
      const signal = signalAt(time)

      if (!pedDone) {
        const d = decidePedestrian({
          state: pedState,
          position: [0, pedZ],
          target: [0, -29.8],
          waitTime: pedWait,
          crosswalks: [northCw],
          cars: [{ position: { x: carX, z: -24.6 }, heading: Math.PI / 2, speed: carSpeed }],
          pedestrianSignal: signal.pedestrian,
        })
        pedState = d.state
        if (d.state === 'waiting_to_cross') pedWait += dt
        if (d.mayMove) {
          pedZ -= pedSpeed * dt
          if (pedZ <= -29.8) pedDone = true
        }
      }

      self.position.x = carX
      self.speed = carSpeed
      const decision = decideCarTargetSpeed({
        position: self.position,
        heading: Math.PI / 2,
        cruiseSpeed: lane.speedLimit,
        lane,
        obstacles: pedDone ? [] : [{ x: 0, z: pedZ }],
        vehicles: [],
        selfFootprint: self,
        crosswalks: [
          {
            id: northCw.id,
            center: { x: 0, z: -26 },
            occupied: !pedDone && pedState === 'crossing',
            hasWaitingPedestrian: !pedDone && pedState === 'waiting_to_cross',
          },
        ],
        vehicleSignal: signal.vehicle,
        stopLines: [{ laneId: lane.id, position: [-3.6, -24.6], direction: [1, 0] }],
      })
      carSpeed = Math.max(
        0,
        carSpeed +
          Math.sign(decision.targetSpeed - carSpeed) *
            Math.min(Math.abs(decision.targetSpeed - carSpeed), 16 * dt),
      )
      carX += carSpeed * dt

      if (pedDone && carX > 4 && carSpeed > 1) resumed = true
    }

    expect(resumed, 'car should pass the crosswalk after the walk phase ends').toBe(true)
  })
})

describe('per-crossing signal + failsafe resolution (signalized intersections)', () => {
  const base = {
    position: [0, -22.2] as [number, number],
    target: [0, -29.8] as [number, number],
    waitTime: 1,
    crosswalks: [northCw],
    cars: [] as CarAgentView[],
    pedestrianSignal: 'walk' as const,
    signalledCrosswalkIds: new Set([northCw.id]),
  }

  it('the per-crossing resolver overrides the shared cycle in both directions', () => {
    // Shared cycle says walk, the intersection's own plan says dont_walk.
    const held = decidePedestrian({
      ...base,
      state: 'walking_sidewalk',
      signalForCrosswalk: () => 'dont_walk',
    })
    expect(held.state).toBe('waiting_to_cross')
    expect(held.mayMove).toBe(false)
    // Shared cycle says dont_walk, the intersection releases the curb.
    const released = decidePedestrian({
      ...base,
      state: 'waiting_to_cross',
      pedestrianSignal: 'dont_walk',
      signalForCrosswalk: () => 'walk',
    })
    expect(released.state).toBe('crossing')
  })

  it('clearance never admits a NEW pedestrian, but a committed one keeps going', () => {
    const waiting = decidePedestrian({
      ...base,
      state: 'waiting_to_cross',
      signalForCrosswalk: () => 'clearance',
    })
    expect(waiting.state).toBe('waiting_to_cross')
    const committed = decidePedestrian({
      ...base,
      state: 'crossing',
      position: [0, -26],
      signalForCrosswalk: () => 'dont_walk',
    })
    expect(committed.state).toBe('crossing')
    expect(committed.mayMove).toBe(true)
  })

  it('the jaywalk failsafe respects a per-crossing ceiling above the split-phase cycle', () => {
    // A 41s wait would trip the global 40s failsafe — but a signalized
    // intersection's normal red can run 38s, so its ceiling is higher.
    const still = decidePedestrian({
      ...base,
      state: 'waiting_to_cross',
      waitTime: 41,
      signalForCrosswalk: () => 'dont_walk',
      maxWaitForCrosswalk: () => 58,
    })
    expect(still.state).toBe('waiting_to_cross')
    const finallyCrosses = decidePedestrian({
      ...base,
      state: 'waiting_to_cross',
      waitTime: 59,
      signalForCrosswalk: () => 'dont_walk',
      maxWaitForCrosswalk: () => 58,
    })
    expect(finallyCrosses.state).toBe('crossing')
  })
})
