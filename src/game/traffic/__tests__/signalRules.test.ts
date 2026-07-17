import { describe, expect, it } from 'vitest'
import {
  getPedestrianSignal,
  getPhaseAt,
  getPhaseStartOffset,
  getSignalStopDecision,
  getVehicleSignal,
  SIGNAL_CYCLE,
  SIGNAL_CYCLE_LENGTH,
  YELLOW_COMMIT_DISTANCE,
  type StopLine,
} from '../signalRules'

const line: StopLine = { laneId: 'lane_inner_cw', position: [0, 5], direction: [0, 1] }
const CRUISE = 5.5

describe('signal cycle', () => {
  it('cycles phases in the defined order and wraps', () => {
    let t = 0
    for (const step of SIGNAL_CYCLE) {
      expect(getPhaseAt(t + 0.01).phase).toBe(step.phase)
      expect(getPhaseAt(t + step.duration - 0.01).phase).toBe(step.phase)
      t += step.duration
    }
    expect(getPhaseAt(SIGNAL_CYCLE_LENGTH + 0.01).phase).toBe(SIGNAL_CYCLE[0].phase)
    expect(getPhaseAt(0.01).remaining).toBeCloseTo(SIGNAL_CYCLE[0].duration - 0.01)
  })

  it('maps phases to vehicle and pedestrian indications', () => {
    expect(getVehicleSignal('vehicle_green')).toBe('green')
    expect(getVehicleSignal('vehicle_yellow')).toBe('yellow')
    expect(getVehicleSignal('all_red')).toBe('red')
    expect(getVehicleSignal('pedestrian_walk')).toBe('red')
    expect(getVehicleSignal('pedestrian_clearance')).toBe('red')
    expect(getPedestrianSignal('pedestrian_walk')).toBe('walk')
    expect(getPedestrianSignal('pedestrian_clearance')).toBe('clearance')
    expect(getPedestrianSignal('vehicle_green')).toBe('dont_walk')
  })

  it('phase start offsets land on the right phase', () => {
    for (const step of SIGNAL_CYCLE) {
      expect(getPhaseAt(getPhaseStartOffset(step.phase) + 0.01).phase).toBe(step.phase)
    }
  })
})

describe('stop decisions', () => {
  it('red returns a graded stop for an approaching car', () => {
    const target = getSignalStopDecision({ x: 0, z: 0 }, 0, 'red', line, CRUISE)
    expect(target).not.toBeNull()
    expect(target!).toBeLessThan(CRUISE)
    // At the line: fully stopped.
    expect(getSignalStopDecision({ x: 0, z: 4.8 }, 0, 'red', line, CRUISE)).toBe(0)
  })

  it('green never stops the car', () => {
    expect(getSignalStopDecision({ x: 0, z: 0 }, 0, 'green', line, CRUISE)).toBeNull()
  })

  it('yellow stops a car that is far enough, lets a committed car continue', () => {
    const far = getSignalStopDecision({ x: 0, z: 5 - YELLOW_COMMIT_DISTANCE - 1.5 }, 0, 'yellow', line, CRUISE)
    expect(far).not.toBeNull()
    const committed = getSignalStopDecision(
      { x: 0, z: 5 - YELLOW_COMMIT_DISTANCE + 0.5 },
      0,
      'yellow',
      line,
      CRUISE,
    )
    expect(committed).toBeNull()
  })

  it('cars already past the line, or heading elsewhere, are unconstrained', () => {
    expect(getSignalStopDecision({ x: 0, z: 6 }, 0, 'red', line, CRUISE)).toBeNull()
    // Heading west across a north-bound line: not our line.
    expect(getSignalStopDecision({ x: 0, z: 0 }, -Math.PI / 2, 'red', line, CRUISE)).toBeNull()
  })
})
