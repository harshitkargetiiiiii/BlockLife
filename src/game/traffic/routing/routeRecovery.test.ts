import { beforeEach, describe, expect, it } from 'vitest'
import { getRoadGraph } from './roadGraphBuilder'
import { planRoute, resetRouteSequence } from './routePlanner'
import { createRng } from './routeRng'
import {
  MAX_RECOVERY_ATTEMPTS,
  RECOVERY_COOLDOWN,
  STAGE1_REFRESH_AT,
  STAGE2_REPLAN_AT,
  STAGE4_RESPAWN_AT,
  checkMissedTurn,
  classifyBlockage,
  findNearestSegment,
  isBenignBlockage,
  updateRecovery,
  type BlockageInput,
} from './routeRecovery'
import { createVehicleRouteState, type VehicleRouteState } from './routeRuntime'

const graph = getRoadGraph()

function stoppedInput(overrides: Partial<BlockageInput> = {}): BlockageInput {
  return {
    reason: 'clear',
    blockingVehicleKind: null,
    downstreamHold: false,
    offLane: false,
    routeInvalid: false,
    speed: 0,
    targetSpeed: 0,
    ...overrides,
  }
}

function routedState(): VehicleRouteState {
  const state = createVehicleRouteState('rec_car', 'crossDistrict', createRng(5))
  const plan = planRoute(graph, 'ring_in_n_a', 0.2, 'dest_freight_yard')
  if (!plan.ok) throw new Error('plan failed')
  state.route = plan.plan
  state.destinationId = 'dest_freight_yard'
  return state
}

beforeEach(() => resetRouteSequence())

describe('blockage classification', () => {
  it('red lights and stop signs are signal — always benign', () => {
    expect(classifyBlockage(stoppedInput({ reason: 'signal' }), 100)).toBe('signal')
    expect(classifyBlockage(stoppedInput({ reason: 'stop_sign' }), 100)).toBe('signal')
    expect(isBenignBlockage('signal')).toBe(true)
  })

  it('pedestrians and crossings are benign', () => {
    expect(classifyBlockage(stoppedInput({ reason: 'crosswalk' }), 100)).toBe('pedestrian')
    expect(classifyBlockage(stoppedInput({ reason: 'obstacle' }), 100)).toBe('pedestrian')
    expect(isBenignBlockage('pedestrian')).toBe(true)
  })

  it('the player parking in the lane is playerVehicle — benign (no teleporting away)', () => {
    const reason = classifyBlockage(
      stoppedInput({ reason: 'follow', blockingVehicleKind: 'driven' }),
      100,
    )
    expect(reason).toBe('playerVehicle')
    expect(isBenignBlockage(reason)).toBe(true)
  })

  it('a normal queue is not a blockage; a very long leader stall is', () => {
    const queueing = classifyBlockage(
      stoppedInput({ reason: 'follow', blockingVehicleKind: 'ambient' }),
      5,
    )
    expect(queueing).toBe('none')
    const stalled = classifyBlockage(
      stoppedInput({ reason: 'follow', blockingVehicleKind: 'ambient' }),
      30,
    )
    expect(stalled).toBe('leader')
    expect(isBenignBlockage(stalled)).toBe(false)
  })

  it('moving cars never classify as blocked', () => {
    expect(classifyBlockage(stoppedInput({ speed: 3 }), 100)).toBe('none')
  })
})

describe('staged recovery', () => {
  it('a red light never escalates, no matter how long', () => {
    const state = routedState()
    let now = 0
    for (let i = 0; i < 600; i++) {
      const action = updateRecovery(graph, state, stoppedInput({ reason: 'signal' }), now, 0.1)
      expect(action.kind).toBe('none')
      now += 0.1
    }
    expect(state.recoveryStage).toBe(0)
    // The suspect clock (which drives stages) never accumulates at a red
    // light; the total stopped clock legitimately does.
    expect(state.suspectTime).toBe(0)
    expect(state.stoppedTime).toBeGreaterThan(0)
  })

  it('unknown blockage escalates stage by stage with cooldowns', () => {
    const state = routedState()
    const actions: string[] = []
    let now = 0
    const dt = 0.5
    for (let i = 0; i < 100; i++) {
      const action = updateRecovery(graph, state, stoppedInput(), now, dt)
      if (action.kind !== 'none') actions.push(action.kind)
      now += dt
    }
    expect(actions[0]).toBe('refreshTarget') // stage 1
    expect(actions).toContain('replan') // stage 2
    expect(actions[actions.length - 1]).toBe('respawn') // stage 4 eventually
    // Cooldown: no two actions can occur within RECOVERY_COOLDOWN of each
    // other, so the count is bounded.
    expect(actions.length).toBeLessThanOrEqual(
      Math.ceil((100 * dt) / RECOVERY_COOLDOWN) + 1,
    )
  })

  it('stage thresholds follow the timeline constants', () => {
    const state = routedState()
    let now = 0
    const dt = 1
    let firstActionAt = -1
    for (let i = 0; i < 60; i++) {
      const action = updateRecovery(graph, state, stoppedInput(), now, dt)
      if (action.kind !== 'none' && firstActionAt < 0) firstActionAt = state.stoppedTime
      now += dt
    }
    expect(firstActionAt).toBeGreaterThanOrEqual(STAGE1_REFRESH_AT)
    expect(firstActionAt).toBeLessThan(STAGE2_REPLAN_AT)
  })

  it('progress resets the stage machine completely', () => {
    const state = routedState()
    let now = 0
    for (let i = 0; i < 12; i++) {
      updateRecovery(graph, state, stoppedInput(), now, 1)
      now += 1
    }
    expect(state.stoppedTime).toBeGreaterThan(0)
    updateRecovery(graph, state, stoppedInput({ speed: 3, targetSpeed: 3 }), now, 1)
    expect(state.stoppedTime).toBe(0)
    expect(state.recoveryStage).toBe(0)
  })

  it('attempts are bounded: the cap forces a respawn instead of looping', () => {
    const state = routedState()
    state.recoveryAttempts = MAX_RECOVERY_ATTEMPTS
    state.suspectTime = STAGE1_REFRESH_AT + 1
    const action = updateRecovery(graph, state, stoppedInput(), 100, 0.5)
    expect(action.kind).toBe('respawn')
    expect(state.recoveryAttempts).toBe(0) // reset after the escape hatch
  })

  it('a broken route replans immediately (routeGeometry)', () => {
    const state = routedState()
    state.stoppedTime = 1
    const action = updateRecovery(graph, state, stoppedInput({ routeInvalid: true }), 50, 0.5)
    expect(action.kind).toBe('replan')
    expect(state.blockageReason).toBe('routeGeometry')
  })

  it('respawn fires after the stage-4 threshold', () => {
    const state = routedState()
    state.suspectTime = STAGE4_RESPAWN_AT
    const action = updateRecovery(graph, state, stoppedInput(), 200, 0.5)
    expect(action.kind).toBe('respawn')
    expect(state.recoveryStage).toBe(4)
  })
})

describe('missed-turn handling', () => {
  it('on-corridor positions report onRoute', () => {
    const state = routedState()
    expect(checkMissedTurn(graph, state, -10, -24.6).kind).toBe('onRoute')
  })

  it('overshoot onto a later route segment re-anchors', () => {
    const state = routedState()
    // Physically on the connector while the cursor is still on the ring.
    expect(checkMissedTurn(graph, state, 13.4, -35).kind).toBe('reanchored')
  })

  it('a wrong-but-valid lane triggers a replan', () => {
    const state = routedState()
    // On the residential south street — valid lane, not on this route.
    expect(checkMissedTurn(graph, state, 0, 49.4).kind).toBe('needsReplan')
  })

  it('nowhere near the network reports lost', () => {
    const state = routedState()
    expect(checkMissedTurn(graph, state, 0, 0).kind).toBe('lost')
  })

  it('findNearestSegment anchors teleports to lanes, never junction arcs', () => {
    const hit = findNearestSegment(graph, 12, -26, 6)
    expect(hit).not.toBeNull()
    expect(graph.segments.get(hit!.segmentId)!.kind).not.toBe('junction')
  })
})
