import { beforeEach, describe, expect, it } from 'vitest'
import { getRoadGraph } from './roadGraphBuilder'
import { planRoute, resetRouteSequence } from './routePlanner'
import { createRng } from './routeRng'
import {
  advanceRouteCursor,
  currentSegment,
  getCurrentRouteTarget,
  isOnFinalSegment,
  measureRouteDeviation,
  reanchorOnRoute,
} from './routeProgress'
import { createVehicleRouteState, type VehicleRouteState } from './routeRuntime'

const graph = getRoadGraph()

function routedState(origin: string, progress: number, destination: string): VehicleRouteState {
  const state = createVehicleRouteState('test_car', 'crossDistrict', createRng(1))
  const plan = planRoute(graph, origin, progress, destination)
  if (!plan.ok) throw new Error(`plan failed: ${plan.failure}`)
  state.route = plan.plan
  state.destinationId = destination
  return state
}

beforeEach(() => resetRouteSequence())

describe('route progress cursor', () => {
  it('the current segment is authoritative and targets come from its polyline', () => {
    const state = routedState('ring_in_n_a', 0, 'dest_freight_yard')
    const seg = currentSegment(graph, state)!
    expect(seg.id).toBe('ring_in_n_a')
    const target = getCurrentRouteTarget(graph, state)!
    expect(target).toEqual(seg.points[1])
  })

  it('advances exactly one step per call and one segment per endpoint', () => {
    const state = routedState('ring_in_n_a', 0, 'dest_freight_yard')
    const first = currentSegment(graph, state)!
    // Walk the whole first segment's waypoints.
    let advance = advanceRouteCursor(graph, state)
    let steps = 1
    while (advance.kind === 'waypoint') {
      advance = advanceRouteCursor(graph, state)
      steps += 1
      expect(steps).toBeLessThan(50)
    }
    expect(advance.kind).toBe('segment')
    if (advance.kind === 'segment') {
      expect(advance.segmentId).toBe(state.route!.segmentIds[1])
    }
    expect(state.segmentIndex).toBe(1)
    expect(currentSegment(graph, state)!.id).not.toBe(first.id)
    // Progress reset at the segment boundary.
    expect(state.segmentProgress).toBe(0)
  })

  it('progress is monotonic within a segment', () => {
    const state = routedState('ring_out_s_b', 0, 'dest_market_strip')
    let last = -1
    for (let i = 0; i < 30; i++) {
      const advance = advanceRouteCursor(graph, state)
      if (advance.kind !== 'waypoint') break
      expect(state.segmentProgress).toBeGreaterThanOrEqual(last)
      last = state.segmentProgress
    }
  })

  it('destination completion fires exactly once, on the final segment', () => {
    const state = routedState('art_nb_a', 0.1, 'dest_freight_yard')
    expect(isOnFinalSegment(state)).toBe(true)
    let arrivals = 0
    for (let i = 0; i < 20; i++) {
      const advance = advanceRouteCursor(graph, state)
      if (advance.kind === 'arrived') {
        arrivals += 1
        break
      }
    }
    expect(arrivals).toBe(1)
    expect(state.segmentProgress).toBeCloseTo(state.route!.destinationProgress)
  })

  it('proximity alone NEVER completes a route (must be the final segment)', () => {
    // A route that passes the freight yard early cannot complete there.
    const state = routedState('ring_in_n_a', 0, 'dest_freight_yard')
    expect(isOnFinalSegment(state)).toBe(false)
    const advance = advanceRouteCursor(graph, state)
    expect(advance.kind).not.toBe('arrived')
  })

  it('deviation detection flags positions far from the corridor', () => {
    const state = routedState('ring_in_n_a', 0, 'dest_freight_yard')
    const onLane = measureRouteDeviation(graph, state, -20, -24.6)!
    expect(onLane.offLane).toBe(false)
    const offLane = measureRouteDeviation(graph, state, 0, 0)! // plaza center
    expect(offLane.offLane).toBe(true)
  })

  it('re-anchoring snaps the cursor to the matching route segment', () => {
    const state = routedState('ring_in_n_a', 0, 'dest_freight_yard')
    // Simulate an overshoot: the car is physically on the SECOND route
    // segment while the cursor still points at the first.
    const secondId = state.route!.segmentIds[2]
    const second = graph.segments.get(secondId)!
    const mid = second.points[second.points.length - 1]
    const anchored = reanchorOnRoute(graph, state, mid[0], mid[1], 2.5)
    expect(anchored).toBe(true)
    expect(state.route!.segmentIds[state.segmentIndex]).toBe(secondId)
  })

  it('re-anchoring refuses positions that match no route segment', () => {
    const state = routedState('ring_in_n_a', 0, 'dest_freight_yard')
    expect(reanchorOnRoute(graph, state, 0, 0, 2.5)).toBe(false)
    expect(state.segmentIndex).toBe(0) // untouched
  })
})
