import { getRoadRects } from '../../world/cityLayout'
import { collectSolidFootprints } from '../../world/solidFootprints'
import { CROSSWALKS_BY_ID, LANES_BY_ID } from '../trafficData'
import { getIntersectionCrossingZone } from '../intersections/intersectionRegistry'
import { getWalkCrossingZone } from '../walkCrossings'
import type { Vec2 } from '../../world/worldTypes'
import type { LaneSegment, RoadGraph } from './roadGraphTypes'
import { JUNCTION_BOXES } from './roadGraphData'
import { closestPointOnSegment, pointAtProgress } from './roadGraphBuilder'

/**
 * Static road-graph validation, run by unit tests on every build. A graph
 * that authors a wrong-way connection, an off-asphalt arc, a dead end or an
 * unreachable district fails HERE — never in a soak test at 2 a.m.
 */

const DISTRICTS = [
  'central',
  'residential',
  'residential_west',
  'residential_south',
  'industrial',
  'industrial_north',
  'downtown_gateway',
  // City Expansion Content Pack v1
  'waterfront_north',
  'downtown_north',
  'residential_east',
  'industrial_west',
] as const

/** Which routed roadIds must coincide with which legacy loop lanes. */
const LOOP_ALIGNMENT: Record<string, string> = {
  'ring:inner_cw': 'lane_inner_cw',
  'ring:outer_ccw': 'lane_outer_ccw',
  'residential_street:eb': 'lane_residential',
  'residential_street:wb': 'lane_residential',
  'residential_west_street:sb': 'lane_residential_west',
  'residential_west_street:nb': 'lane_residential_west',
  'residential_south_street:eb': 'lane_residential_south',
  'residential_south_street:wb': 'lane_residential_south',
  'industrial_road:sb': 'lane_industrial',
  'industrial_road:nb': 'lane_industrial',
  'freight_arterial:nb': 'lane_industrial_north',
  'freight_arterial:sb': 'lane_industrial_north',
}

function distanceToPolyline(points: Vec2[], loop: boolean, x: number, z: number): number {
  let best = Infinity
  const n = points.length
  const last = loop ? n : n - 1
  for (let i = 0; i < last; i++) {
    const a = points[i]
    const b = points[(i + 1) % n]
    const abx = b[0] - a[0]
    const abz = b[1] - a[1]
    const lenSq = abx * abx + abz * abz
    const t = lenSq === 0 ? 0 : Math.max(0, Math.min(1, ((x - a[0]) * abx + (z - a[1]) * abz) / lenSq))
    const d = Math.hypot(x - (a[0] + abx * t), z - (a[1] + abz * t))
    if (d < best) best = d
  }
  return best
}

function samplePolyline(points: Vec2[], stepSize: number): Vec2[] {
  const samples: Vec2[] = [[points[0][0], points[0][1]]]
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1]
    const b = points[i]
    const len = Math.hypot(b[0] - a[0], b[1] - a[1])
    const steps = Math.max(1, Math.ceil(len / stepSize))
    for (let s = 1; s <= steps; s++) {
      const u = s / steps
      samples.push([a[0] + (b[0] - a[0]) * u, a[1] + (b[1] - a[1]) * u])
    }
  }
  return samples
}

function headingOf(a: Vec2, b: Vec2): number {
  return Math.atan2(b[0] - a[0], b[1] - a[1])
}

function angleDeltaAbs(a: number, b: number): number {
  let d = Math.abs(a - b) % (Math.PI * 2)
  if (d > Math.PI) d = Math.PI * 2 - d
  return d
}

function segmentEndHeading(seg: LaneSegment): number {
  return headingOf(seg.points[seg.points.length - 2], seg.points[seg.points.length - 1])
}

function segmentStartHeading(seg: LaneSegment): number {
  return headingOf(seg.points[0], seg.points[1])
}

/** BFS forward reachability over the segment adjacency. */
export function reachableFrom(graph: RoadGraph, startSegmentId: string): Set<string> {
  const seen = new Set<string>([startSegmentId])
  const queue = [startSegmentId]
  while (queue.length > 0) {
    const id = queue.pop()!
    for (const edge of graph.adjacency.get(id) ?? []) {
      if (!seen.has(edge.toSegmentId)) {
        seen.add(edge.toSegmentId)
        queue.push(edge.toSegmentId)
      }
    }
  }
  return seen
}

export function validateRoadGraph(graph: RoadGraph): string[] {
  const errors: string[] = []
  const roadRects = getRoadRects()
  const solids = collectSolidFootprints()

  // --- Structural integrity -----------------------------------------------
  for (const [id, seg] of graph.segments) {
    if (seg.points.length < 2) errors.push(`${id}: polyline has fewer than 2 points`)
    for (const p of seg.points) {
      if (!Number.isFinite(p[0]) || !Number.isFinite(p[1])) errors.push(`${id}: non-finite point`)
    }
    if (!(seg.length > 0)) errors.push(`${id}: non-positive length`)
    if (!(seg.speedLimit >= 1 && seg.speedLimit <= 10)) {
      errors.push(`${id}: implausible speed limit ${seg.speedLimit}`)
    }
    if (seg.from === seg.to) errors.push(`${id}: self-loop segment`)
    if (!graph.nodes.has(seg.from) || !graph.nodes.has(seg.to)) {
      errors.push(`${id}: endpoint references missing node`)
    }
    // Internal direction consistency: no >120° reversal between steps.
    for (let i = 2; i < seg.points.length; i++) {
      const h1 = headingOf(seg.points[i - 2], seg.points[i - 1])
      const h2 = headingOf(seg.points[i - 1], seg.points[i])
      if (angleDeltaAbs(h1, h2) > (Math.PI * 2) / 3) {
        errors.push(`${id}: polyline reverses direction internally`)
      }
    }
  }

  const edgeKeys = new Set<string>()
  for (const edge of graph.edges) {
    const key = `${edge.fromSegmentId}>${edge.toSegmentId}`
    if (edgeKeys.has(key)) errors.push(`duplicate edge ${key}`)
    edgeKeys.add(key)
    const from = graph.segments.get(edge.fromSegmentId)
    const to = graph.segments.get(edge.toSegmentId)
    if (!from || !to) {
      errors.push(`edge ${key} references missing segment`)
      continue
    }
    if (edge.fromSegmentId === edge.toSegmentId && edge.movement !== 'loop') {
      errors.push(`edge ${key} is an untagged self-edge`)
    }
    // No oncoming handoffs: the continuation may bend but never reverse.
    const delta = angleDeltaAbs(segmentEndHeading(from), segmentStartHeading(to))
    if (edge.movement !== 'loop' && delta > (Math.PI * 3) / 4) {
      errors.push(`edge ${key} reverses heading (${((delta * 180) / Math.PI).toFixed(0)}°)`)
    }
  }

  // --- Connectivity --------------------------------------------------------
  for (const [id, seg] of graph.segments) {
    const outgoing = graph.adjacency.get(id) ?? []
    if (outgoing.length === 0) errors.push(`${id}: dead end (no outgoing edges)`)
    const hasIncoming = graph.edges.some((e) => e.toSegmentId === id)
    if (!hasIncoming) errors.push(`${id}: orphan (no incoming edges)`)
    if (seg.kind === 'junction' && outgoing.length === 0) {
      errors.push(`${id}: junction movement with no exit`)
    }
  }

  const reachability = new Map<string, Set<string>>()
  for (const id of graph.segments.keys()) reachability.set(id, reachableFrom(graph, id))

  // Every spawn reaches at least one destination; every destination is
  // reachable from at least one spawn.
  const destinationSegments = [...graph.destinations.values()].map((d) => d.segmentId)
  for (const spawn of graph.spawnPoints.values()) {
    const reach = reachability.get(spawn.segmentId)
    if (!reach) {
      errors.push(`spawn ${spawn.id}: unknown segment ${spawn.segmentId}`)
      continue
    }
    if (!destinationSegments.some((d) => reach.has(d))) {
      errors.push(`spawn ${spawn.id}: cannot reach any destination`)
    }
  }
  for (const dest of graph.destinations.values()) {
    if (!graph.segments.has(dest.segmentId)) {
      errors.push(`destination ${dest.id}: unknown segment ${dest.segmentId}`)
      continue
    }
    const reachedBySpawn = [...graph.spawnPoints.values()].some((s) =>
      reachability.get(s.segmentId)?.has(dest.segmentId),
    )
    if (!reachedBySpawn) errors.push(`destination ${dest.id}: unreachable from every spawn`)
  }

  // All-pairs district reachability.
  const segmentsByDistrict = new Map<string, string[]>()
  for (const [id, seg] of graph.segments) {
    const list = segmentsByDistrict.get(seg.districtId) ?? []
    list.push(id)
    segmentsByDistrict.set(seg.districtId, list)
  }
  for (const district of DISTRICTS) {
    if (!segmentsByDistrict.has(district)) errors.push(`district ${district}: no segments`)
  }
  for (const a of DISTRICTS) {
    for (const b of DISTRICTS) {
      if (a === b) continue
      const fromSegs = segmentsByDistrict.get(a) ?? []
      const toSegs = new Set(segmentsByDistrict.get(b) ?? [])
      const connected = fromSegs.some((id) => {
        const reach = reachability.get(id)
        return reach && [...toSegs].some((t) => reach.has(t))
      })
      if (!connected) errors.push(`district ${a} cannot reach ${b}`)
    }
  }

  // --- Geometry: asphalt, solids, junction boxes ---------------------------
  for (const [id, seg] of graph.segments) {
    for (const [x, z] of samplePolyline(seg.points, 0.5)) {
      const onRoad = roadRects.some(
        (r) => x >= r.minX - 0.01 && x <= r.maxX + 0.01 && z >= r.minZ - 0.01 && z <= r.maxZ + 0.01,
      )
      if (!onRoad) {
        errors.push(`${id}: point (${x.toFixed(1)}, ${z.toFixed(1)}) leaves the asphalt`)
        break
      }
    }
    for (const solid of solids) {
      const fx = Math.sin(solid.heading)
      const fz = Math.cos(solid.heading)
      for (const [x, z] of samplePolyline(seg.points, 0.5)) {
        const dx = x - solid.position.x
        const dz = z - solid.position.z
        const lon = dx * fx + dz * fz
        const lat = dx * fz - dz * fx
        if (Math.abs(lon) <= solid.halfLength && Math.abs(lat) <= solid.halfWidth) {
          errors.push(`${id}: crosses solid footprint ${solid.id}`)
          break
        }
      }
    }
    if (seg.junctionId) {
      const box = JUNCTION_BOXES[seg.junctionId]
      if (!box) {
        errors.push(`${id}: unknown junction ${seg.junctionId}`)
      } else {
        for (const [x, z] of samplePolyline(seg.points, 0.5)) {
          if (x < box.minX - 0.01 || x > box.maxX + 0.01 || z < box.minZ - 0.01 || z > box.maxZ + 0.01) {
            errors.push(`${id}: junction movement leaves its box`)
            break
          }
        }
      }
    }
  }

  // --- Legacy loop alignment: shared roads coincide exactly ----------------
  for (const [id, seg] of graph.segments) {
    if (seg.kind !== 'lane') continue
    const loopLaneId = LOOP_ALIGNMENT[`${seg.roadId}:${seg.laneId}`]
    if (!loopLaneId) continue
    const loop = LANES_BY_ID[loopLaneId]
    if (!loop) {
      errors.push(`${id}: alignment target ${loopLaneId} missing`)
      continue
    }
    const minX = Math.min(...loop.waypoints.map((p) => p[0])) - 0.01
    const maxX = Math.max(...loop.waypoints.map((p) => p[0])) + 0.01
    const minZ = Math.min(...loop.waypoints.map((p) => p[1])) - 0.01
    const maxZ = Math.max(...loop.waypoints.map((p) => p[1])) + 0.01
    for (const [x, z] of samplePolyline(seg.points, 1)) {
      // Extension stretches (outside the loop's bounding box) are new lanes.
      if (x < minX || x > maxX || z < minZ || z > maxZ) continue
      const d = distanceToPolyline(loop.waypoints, loop.loop, x, z)
      if (d > 0.01) {
        errors.push(`${id}: drifts ${d.toFixed(2)} from legacy ${loopLaneId} at (${x.toFixed(1)}, ${z.toFixed(1)})`)
        break
      }
    }
  }

  // --- Signals / crossings / stop lines ------------------------------------
  for (const [id, seg] of graph.segments) {
    for (const zoneId of seg.crossingZoneIds ?? []) {
      if (
        !CROSSWALKS_BY_ID[zoneId] &&
        !getIntersectionCrossingZone(zoneId) &&
        !getWalkCrossingZone(zoneId)
      ) {
        errors.push(`${id}: unknown crosswalk ${zoneId}`)
      }
    }
    if (seg.signalGroupId && seg.signalGroupId !== 'signal_main') {
      errors.push(`${id}: unknown signal group ${seg.signalGroupId}`)
    }
    if ((seg.stopLines?.length ?? 0) > 0 && !seg.signalGroupId) {
      errors.push(`${id}: stop lines without a signal group`)
    }
    for (const line of seg.stopLines ?? []) {
      const near = closestPointOnSegment(seg, line.position[0], line.position[1])
      if (near.distance > 0.5) errors.push(`${id}: stop line sits off the segment`)
    }
  }

  // --- Destinations & spawn anchors ----------------------------------------
  const junctionBoxes = Object.values(JUNCTION_BOXES)
  const anchorClearOfHazards = (label: string, segId: string, progress: number) => {
    const seg = graph.segments.get(segId)
    if (!seg) return
    const [x, z] = pointAtProgress(seg, progress)
    for (const box of junctionBoxes) {
      if (x >= box.minX && x <= box.maxX && z >= box.minZ && z <= box.maxZ) {
        errors.push(`${label}: sits inside a junction box`)
      }
    }
    for (const zoneId of seg.crossingZoneIds ?? []) {
      const zone = CROSSWALKS_BY_ID[zoneId]
      if (!zone) continue
      const clearance = 3
      if (
        Math.abs(x - zone.center[0]) <= zone.size[0] / 2 + clearance &&
        Math.abs(z - zone.center[1]) <= zone.size[1] / 2 + clearance
      ) {
        errors.push(`${label}: blocks crosswalk ${zoneId}`)
      }
    }
  }
  for (const dest of graph.destinations.values()) {
    if (!(dest.weight > 0)) errors.push(`destination ${dest.id}: non-positive weight`)
    if (dest.progress < 0.05 || dest.progress > 0.95) {
      errors.push(`destination ${dest.id}: progress too close to a segment end`)
    }
    const seg = graph.segments.get(dest.segmentId)
    if (seg && seg.kind !== 'lane') errors.push(`destination ${dest.id}: not on a lane segment`)
    anchorClearOfHazards(`destination ${dest.id}`, dest.segmentId, dest.progress)
  }
  for (const spawn of graph.spawnPoints.values()) {
    const seg = graph.segments.get(spawn.segmentId)
    if (!seg) continue
    if (!seg.isSpawnEligible) errors.push(`spawn ${spawn.id}: segment not spawn-eligible`)
    anchorClearOfHazards(`spawn ${spawn.id}`, spawn.segmentId, spawn.progress)
    // Spawn anchors must not overlap destination anchors ON THE SAME LANE —
    // cross-lane euclidean proximity is fine (opposing lanes sit 2.8 apart).
    const [sx, sz] = pointAtProgress(seg, spawn.progress)
    for (const dest of graph.destinations.values()) {
      if (dest.segmentId !== spawn.segmentId) continue
      const dseg = graph.segments.get(dest.segmentId)
      if (!dseg) continue
      const [dx, dz] = pointAtProgress(dseg, dest.progress)
      if (Math.hypot(sx - dx, sz - dz) < 5) {
        errors.push(`spawn ${spawn.id}: overlaps destination ${dest.id}`)
      }
    }
  }

  return errors
}
