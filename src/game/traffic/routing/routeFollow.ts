import { CROSSWALKS_BY_ID, STOP_SIGNS, type StopSign } from '../trafficData'
import type { CrosswalkStatusView, RoadLane } from '../trafficTypes'
import type { StopLine } from '../signalRules'
import { getCrosswalkStatus } from '../trafficRuntime'
import { getIntersectionCrossingZone } from '../intersections/intersectionRegistry'
import { getWalkCrossingZone } from '../walkCrossings'
import type { LaneSegment, RoadGraph } from './roadGraphTypes'
import { headingAtProgress } from './roadGraphBuilder'
import { JUNCTION_BOXES } from './roadGraphData'
import { currentSegment, nextSegment } from './routeProgress'
import type { VehicleRouteState } from './routeRuntime'

/**
 * Route-following adapter: translates "where am I on my planned route" into
 * the exact inputs the EXISTING car decision engine already consumes. The
 * decision engine keeps owning braking, yielding, signals and following —
 * this file only assembles its per-frame context from route segments.
 */

/** Start easing toward a turn's speed this far before the segment end. */
export const TURN_ANTICIPATION_DISTANCE = 5

/**
 * Junction holds engage this far before the segment end, and the graded
 * stop targets HOLD_STOP_SHORT before it — so the stopped car's NOSE
 * (half-length ahead of its center) never pokes into the box or clips the
 * crossing lane a car inside the box is driving through.
 */
export const JUNCTION_HOLD_DISTANCE = 6
export const HOLD_STOP_SHORT = 2.8

const laneScratch: { current: RoadLane } = {
  current: {
    id: 'routed',
    waypoints: [],
    loop: false,
    speedLimit: 5,
    laneWidth: 2.6,
    slowDistance: 5.5,
    stopDistance: 2.6,
  },
}
const stopLineScratch: StopLine[] = []
const crosswalkScratch: CrosswalkStatusView[] = []
const stopSignScratch: StopSign[] = []
const STOP_SIGNS_BY_ID = new Map(STOP_SIGNS.map((s) => [s.id, s]))

/**
 * Lane-shaped tuning for the decision engine, sized from the current
 * segment. Braking envelopes mirror the legacy lanes' feel.
 */
export function getRouteLaneView(segment: LaneSegment): RoadLane {
  const lane = laneScratch.current
  lane.id = `routed_${segment.id}`
  lane.speedLimit = segment.speedLimit
  lane.laneWidth = 2.6
  lane.slowDistance = Math.max(5, segment.speedLimit)
  lane.stopDistance = 2.6
  return lane
}

/**
 * Cruise speed for this frame: the segment limit scaled by the car's factor,
 * eased down toward an upcoming slower segment (turn anticipation) so cars
 * brake BEFORE junction arcs instead of screeching inside them.
 */
export function getDesiredLaneSpeed(
  graph: RoadGraph,
  state: VehicleRouteState,
  speedFactor: number,
  distanceToSegmentEnd: number,
): number {
  const seg = currentSegment(graph, state)
  if (!seg) return 0
  const cruise = seg.speedLimit * speedFactor
  const next = nextSegment(graph, state)
  if (!next || next.speedLimit >= seg.speedLimit) return cruise
  if (distanceToSegmentEnd >= TURN_ANTICIPATION_DISTANCE) return cruise
  const nextCruise = next.speedLimit * speedFactor
  const blend = Math.max(0, distanceToSegmentEnd) / TURN_ANTICIPATION_DISTANCE
  return nextCruise + (cruise - nextCruise) * blend
}

/** Stop lines the car must respect now: current + upcoming segment. */
export function getRouteStopLines(graph: RoadGraph, state: VehicleRouteState): StopLine[] {
  stopLineScratch.length = 0
  for (const seg of [currentSegment(graph, state), nextSegment(graph, state)]) {
    for (const line of seg?.stopLines ?? []) stopLineScratch.push(line)
  }
  return stopLineScratch
}

/** True when a signal governs the current or upcoming segment. */
export function isRouteSignalled(graph: RoadGraph, state: VehicleRouteState): boolean {
  return Boolean(
    currentSegment(graph, state)?.signalGroupId || nextSegment(graph, state)?.signalGroupId,
  )
}

/** Live crosswalk status for the zones the route passes next. */
export function getRouteCrosswalks(
  graph: RoadGraph,
  state: VehicleRouteState,
): CrosswalkStatusView[] {
  crosswalkScratch.length = 0
  const seen = new Set<string>()
  for (const seg of [currentSegment(graph, state), nextSegment(graph, state)]) {
    for (const zoneId of seg?.crossingZoneIds ?? []) {
      if (seen.has(zoneId)) continue
      seen.add(zoneId)
      // Three crosswalk families share the etiquette: legacy painted zones
      // and kit walk-crossings are UNSIGNALLED (courtesy stop for waiting
      // pedestrians applies, with bounded patience); intersection crossings
      // are SIGNAL-governed — the walk phase sequences waiting pedestrians,
      // so the courtesy stop must not apply there (citizens queue at the
      // curb through every vehicle green, and honoring them would hold the
      // approach forever). Occupancy (someone ON the crossing, citizen or
      // player) stops the car unconditionally in every family.
      const unsignalled = CROSSWALKS_BY_ID[zoneId] ?? getWalkCrossingZone(zoneId)
      const zone = unsignalled ?? getIntersectionCrossingZone(zoneId)
      if (!zone) continue
      const status = getCrosswalkStatus(zone)
      crosswalkScratch.push(unsignalled ? status : { ...status, hasWaitingPedestrian: false })
    }
  }
  return crosswalkScratch
}

/** Stop signs on the current + upcoming segment. */
export function getRouteStopSigns(graph: RoadGraph, state: VehicleRouteState): StopSign[] {
  stopSignScratch.length = 0
  for (const seg of [currentSegment(graph, state), nextSegment(graph, state)]) {
    for (const id of seg?.stopSignIds ?? []) {
      const sign = STOP_SIGNS_BY_ID.get(id)
      if (sign) stopSignScratch.push(sign)
    }
  }
  return stopSignScratch
}

export interface JunctionHoldCheck {
  hold: boolean
  reason: 'downstreamFull' | null
}

/** Crossing turns yield to traffic approaching the box within this range. */
export const APPROACH_YIELD_DISTANCE = 9

/**
 * Lightweight anti-gridlock, three rules evaluated at the junction entry:
 *
 * 1. Downstream-full: the exit lane's first stretch is parked over by a
 *    nearly-stopped vehicle → wait instead of stopping inside the box.
 * 2. Box mutual exclusion: another vehicle is currently INSIDE the junction
 *    box → wait. Turn arcs legally cross opposing lanes at ~90°, an angle
 *    the corridor-lookahead intentionally ignores for ambient traffic (the
 *    anti-head-on filter), so without this two crossing cars would only be
 *    caught by the emergency overlap latch. One car in the box at a time.
 * 3. Right-of-way: a car about to make a movement that CROSSES the opposing
 *    lane additionally yields to moving vehicles APPROACHING the box.
 *    Without this there is a race — the box can be empty when the turner
 *    commits and occupied by a fast straight-through car a moment later.
 *
 * A holding car stands BEFORE the box, so holds can never deadlock each
 * other: whoever is inside clears, then exactly one waiter enters.
 */
export function shouldHoldBeforeJunction(
  graph: RoadGraph,
  state: VehicleRouteState,
  distanceToSegmentEnd: number,
  vehicles: { position: { x: number; z: number }; heading: number; speed: number; id?: string }[],
  selfId: string,
): JunctionHoldCheck {
  if (distanceToSegmentEnd > JUNCTION_HOLD_DISTANCE) return { hold: false, reason: null }
  const next = nextSegment(graph, state)
  if (!next || next.kind !== 'junction') return { hold: false, reason: null }

  const box = next.junctionId ? JUNCTION_BOXES[next.junctionId] : undefined
  if (box) {
    const cx = (box.minX + box.maxX) / 2
    const cz = (box.minZ + box.maxZ) / 2
    const crossesOpposing = next.tags.includes('crossesOpposing')
    for (const v of vehicles) {
      if (v.id === selfId) continue
      // Rule 2: the box is occupied.
      if (
        v.position.x >= box.minX - 0.5 &&
        v.position.x <= box.maxX + 0.5 &&
        v.position.z >= box.minZ - 0.5 &&
        v.position.z <= box.maxZ + 0.5
      ) {
        return { hold: true, reason: 'downstreamFull' }
      }
      // Rule 3: crossing movements yield to approaching movers.
      if (crossesOpposing && v.speed > 0.5) {
        const dx = cx - v.position.x
        const dz = cz - v.position.z
        const distance = Math.hypot(dx, dz)
        if (distance < APPROACH_YIELD_DISTANCE) {
          const toward = Math.sin(v.heading) * dx + Math.cos(v.heading) * dz
          if (toward > 0) return { hold: true, reason: 'downstreamFull' }
        }
      }
    }
  }

  // Rule 1: the exit lane has no room.
  const after = state.route?.segmentIds[state.segmentIndex + 2]
  const exit = after ? graph.segments.get(after) : null
  if (!exit) return { hold: false, reason: null }
  const exitStart = exit.points[0]
  const exitHeading = headingAtProgress(exit, 0)
  const fx = Math.sin(exitHeading)
  const fz = Math.cos(exitHeading)
  for (const v of vehicles) {
    if (v.id === selfId) continue
    if (v.speed > 0.5) continue
    const dx = v.position.x - exitStart[0]
    const dz = v.position.z - exitStart[1]
    const lon = dx * fx + dz * fz
    const lat = Math.abs(dx * fz - dz * fx)
    // A stopped car parked over the first stretch of the exit lane.
    if (lon > -2 && lon < 6 && lat < 1.8) return { hold: true, reason: 'downstreamFull' }
  }
  return { hold: false, reason: null }
}
