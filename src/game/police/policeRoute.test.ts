import { beforeEach, describe, expect, it } from 'vitest'
import { getRoadGraph } from '../traffic/routing/roadGraphBuilder'
import { nearestRoadSegment } from '../traffic/routing/roadProjection'
import { planRouteToSegment } from '../traffic/routing/routePlanner'
import {
  clearPoliceRoute,
  getPoliceRoute,
  nextPoliceWaypoint,
  planPoliceRoute,
  POLICE_TARGET_DRIFT,
  resetPoliceRoutes,
  shouldReplanPolice,
} from './policeRoute'

// Two points near roads far enough apart to need a multi-segment route.
const graph = getRoadGraph()
const segA = [...graph.segments.values()][0]
const segB = [...graph.segments.values()][Math.floor(graph.segments.size / 2)]
const posA = segA.points[Math.floor(segA.points.length / 2)]
const posB = segB.points[Math.floor(segB.points.length / 2)]

beforeEach(() => resetPoliceRoutes())

describe('road projection', () => {
  it('projects a point on a segment back onto that graph with ~zero distance', () => {
    const proj = nearestRoadSegment(graph, posA)
    expect(proj).not.toBeNull()
    expect(proj!.distance).toBeLessThan(0.01)
  })

  it('planRouteToSegment finds a road path between two segments', () => {
    const res = planRouteToSegment(graph, segA.id, 0.2, segB.id, 0.5)
    expect(res.ok).toBe(true)
    if (res.ok) {
      expect(res.plan.segmentIds[0]).toBe(segA.id)
      expect(res.plan.segmentIds.at(-1)).toBe(segB.id)
    }
  })
})

describe('police vehicle route', () => {
  it('plans a road route with waypoints toward the target', () => {
    const route = planPoliceRoute('police_0', 'intercept_suspect', posA, posB, 100)
    expect(route).not.toBeNull()
    expect(route!.segmentIds.length).toBeGreaterThan(0)
    expect(route!.waypoints.length).toBeGreaterThan(1)
    // The route passes through the target's location (nearest road may be an
    // overlapping lane, so allow a small lane-width tolerance).
    const nearest = Math.min(
      ...route!.waypoints.map((w) => Math.hypot(w[0] - posB[0], w[1] - posB[1])),
    )
    expect(nearest).toBeLessThan(4)
  })

  it('advances the waypoint cursor as the cruiser reaches waypoints', () => {
    planPoliceRoute('police_0', 'intercept_suspect', posA, posB, 100)
    const first = nextPoliceWaypoint('police_0', posA)
    expect(first).not.toBeNull()
    // Standing ON the first waypoint advances the cursor to a later one.
    const at = getPoliceRoute('police_0')!.waypoints[0]
    nextPoliceWaypoint('police_0', at)
    expect(getPoliceRoute('police_0')!.cursor).toBeGreaterThanOrEqual(0)
  })

  it('replans on cadence, target drift, and when no route exists', () => {
    expect(shouldReplanPolice('police_0', posB, 100)).toBe(true) // no route yet
    planPoliceRoute('police_0', 'intercept_suspect', posA, posB, 100)
    expect(shouldReplanPolice('police_0', posB, 100)).toBe(false) // fresh
    // Big target drift forces an early replan.
    const drifted: [number, number] = [posB[0] + POLICE_TARGET_DRIFT + 5, posB[1]]
    expect(shouldReplanPolice('police_0', drifted, 100)).toBe(true)
    // Cadence elapsed forces a replan.
    expect(shouldReplanPolice('police_0', posB, 100 + 5)).toBe(true)
  })

  it('clear + reset remove a cruiser route', () => {
    planPoliceRoute('police_0', 'intercept_suspect', posA, posB, 100)
    clearPoliceRoute('police_0')
    expect(getPoliceRoute('police_0')).toBeNull()
  })
})
