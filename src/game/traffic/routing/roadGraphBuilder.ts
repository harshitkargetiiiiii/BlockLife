import type { Vec2 } from '../../world/worldTypes'
import { STOP_SIGNS } from '../trafficData'
import type {
  JunctionMovement,
  LaneSegment,
  RoadEdge,
  RoadGraph,
  RoadNode,
} from './roadGraphTypes'
import {
  ROUTED_SEGMENT_SPECS,
  ROUTE_SPAWN_POINTS,
  TRAFFIC_DESTINATIONS,
} from './roadGraphData'
import { hashString } from './routeRng'

/**
 * Builds the immutable routed road graph once from the authored specs:
 * - nodes derive from segment endpoints (0.1-unit grid — shared endpoints
 *   unify into one node; that sharing IS the connectivity, so there is no
 *   fuzzy proximity auto-linking to go wrong)
 * - edges derive from directed node adjacency (A.to === B.from)
 * - lengths/tangents are cached; the graph never changes at runtime in v1
 */

/** Movement penalties added to edge cost (seconds-equivalent units). */
export const MOVEMENT_PENALTY: Record<JunctionMovement, number> = {
  straight: 0,
  right: 0.6,
  left: 1.6,
  merge: 0.6,
  diverge: 0.3,
  loop: 2.4,
}

export const CONNECTOR_ENTRY_PENALTY = 0.5

function nodeIdAt(p: Vec2): string {
  return `n_${p[0].toFixed(1)}_${p[1].toFixed(1)}`
}

function polylineLength(points: Vec2[]): number {
  let length = 0
  for (let i = 1; i < points.length; i++) {
    length += Math.hypot(points[i][0] - points[i - 1][0], points[i][1] - points[i - 1][1])
  }
  return length
}

function headingOf(from: Vec2, to: Vec2): number {
  return Math.atan2(to[0] - from[0], to[1] - from[1])
}

/** Signed smallest angle delta (radians, -π..π). */
function angleDelta(from: number, to: number): number {
  let d = (to - from) % (Math.PI * 2)
  if (d > Math.PI) d -= Math.PI * 2
  if (d < -Math.PI) d += Math.PI * 2
  return d
}

/** Corner movement between two lane segments joined at a node. */
function cornerMovement(a: LaneSegment, b: LaneSegment): JunctionMovement {
  const aOut = headingOf(a.points[a.points.length - 2], a.points[a.points.length - 1])
  const bIn = headingOf(b.points[0], b.points[1])
  const d = angleDelta(aOut, bIn)
  if (Math.abs(d) > (Math.PI * 3) / 4) return 'loop'
  if (d > Math.PI / 6) return 'right'
  if (d < -Math.PI / 6) return 'left'
  return 'straight'
}

let cachedGraph: RoadGraph | null = null

export function buildRoadGraph(): RoadGraph {
  const nodes = new Map<string, RoadNode>()
  const segments = new Map<string, LaneSegment>()

  const stopSignsById = new Map(STOP_SIGNS.map((s) => [s.id, s]))

  for (const spec of ROUTED_SEGMENT_SPECS) {
    const from = nodeIdAt(spec.points[0])
    const to = nodeIdAt(spec.points[spec.points.length - 1])
    for (const [id, p, endKind] of [
      [from, spec.points[0], 'laneStart'],
      [to, spec.points[spec.points.length - 1], 'laneEnd'],
    ] as const) {
      if (!nodes.has(id)) {
        nodes.set(id, {
          id,
          position: [p[0], p[1]],
          kind: spec.kind === 'junction' ? (endKind === 'laneStart' ? 'junctionEntry' : 'junctionExit') : endKind,
          districtId: spec.districtId,
        })
      }
    }
    // Resolve stop-sign references eagerly so a typo fails validation.
    for (const signId of spec.stopSignIds ?? []) {
      if (!stopSignsById.has(signId)) {
        throw new Error(`segment "${spec.id}" references unknown stop sign "${signId}"`)
      }
    }
    segments.set(spec.id, {
      id: spec.id,
      kind: spec.kind,
      from,
      to,
      points: spec.points,
      length: polylineLength(spec.points),
      speedLimit: spec.speedLimit,
      districtId: spec.districtId,
      roadId: spec.roadId,
      laneId: spec.laneId,
      tags: spec.tags ?? [],
      junctionId: spec.junctionId,
      movement: spec.movement,
      signalGroupId: spec.signalGroupId,
      stopLines: spec.stopLineKeys?.map((k) => ({
        laneId: `routed_${spec.id}`,
        position: k.position,
        direction: k.direction,
      })),
      crossingZoneIds: spec.crossingZoneIds,
      stopSignIds: spec.stopSignIds,
      isConnector: spec.isConnector ?? false,
      isSpawnEligible: spec.spawn ?? false,
      isDestinationEligible: spec.destination ?? false,
    })
  }

  // Directed adjacency: segments chained by exact node identity.
  const byFromNode = new Map<string, LaneSegment[]>()
  for (const seg of segments.values()) {
    const list = byFromNode.get(seg.from) ?? []
    list.push(seg)
    byFromNode.set(seg.from, list)
  }
  const edges: RoadEdge[] = []
  const adjacency = new Map<string, RoadEdge[]>()
  for (const seg of segments.values()) {
    const nextSegments = (byFromNode.get(seg.to) ?? [])
      .filter((next) => next.id !== seg.id)
      // Deterministic edge order regardless of Map insertion churn.
      .sort((a, b) => (a.id < b.id ? -1 : 1))
    const out: RoadEdge[] = []
    for (const next of nextSegments) {
      const movement: JunctionMovement =
        next.kind === 'junction' && next.movement
          ? next.movement
          : next.kind === 'turnaround'
            ? 'loop'
            : cornerMovement(seg, next)
      let cost = MOVEMENT_PENALTY[movement]
      if (next.isConnector && !seg.isConnector) cost += CONNECTOR_ENTRY_PENALTY
      out.push({
        fromSegmentId: seg.id,
        toSegmentId: next.id,
        movement,
        cost,
        junctionId: next.junctionId ?? seg.junctionId,
      })
    }
    adjacency.set(seg.id, out)
    edges.push(...out)
  }

  // Stable content hash: any authored geometry change bumps the version.
  let versionSource = ''
  const sortedIds = [...segments.keys()].sort()
  for (const id of sortedIds) {
    const seg = segments.get(id)!
    versionSource += `${id}:${seg.points.map((p) => `${p[0]},${p[1]}`).join(';')}|`
  }
  const version = hashString(versionSource)

  return {
    version,
    nodes,
    segments,
    edges,
    adjacency,
    destinations: new Map(TRAFFIC_DESTINATIONS.map((d) => [d.id, d])),
    spawnPoints: new Map(ROUTE_SPAWN_POINTS.map((s) => [s.id, s])),
  }
}

/** The one shared, immutable graph instance (built lazily, cached forever). */
export function getRoadGraph(): RoadGraph {
  if (!cachedGraph) cachedGraph = buildRoadGraph()
  return cachedGraph
}

// ---- Geometry helpers shared by planner/progress/validation --------------

export interface PointOnSegment {
  point: Vec2
  /** 0..1 along the polyline. */
  progress: number
  distance: number
}

/** Position at normalized progress along a segment polyline. */
export function pointAtProgress(segment: LaneSegment, progress: number): Vec2 {
  const target = Math.max(0, Math.min(1, progress)) * segment.length
  let walked = 0
  for (let i = 1; i < segment.points.length; i++) {
    const a = segment.points[i - 1]
    const b = segment.points[i]
    const step = Math.hypot(b[0] - a[0], b[1] - a[1])
    if (walked + step >= target && step > 0) {
      const u = (target - walked) / step
      return [a[0] + (b[0] - a[0]) * u, a[1] + (b[1] - a[1]) * u]
    }
    walked += step
  }
  const last = segment.points[segment.points.length - 1]
  return [last[0], last[1]]
}

/** Closest point on a segment polyline to a world position. */
export function closestPointOnSegment(segment: LaneSegment, x: number, z: number): PointOnSegment {
  let best: PointOnSegment = {
    point: [segment.points[0][0], segment.points[0][1]],
    progress: 0,
    distance: Math.hypot(x - segment.points[0][0], z - segment.points[0][1]),
  }
  let walked = 0
  for (let i = 1; i < segment.points.length; i++) {
    const a = segment.points[i - 1]
    const b = segment.points[i]
    const abx = b[0] - a[0]
    const abz = b[1] - a[1]
    const lenSq = abx * abx + abz * abz
    if (lenSq === 0) continue
    const t = Math.max(0, Math.min(1, ((x - a[0]) * abx + (z - a[1]) * abz) / lenSq))
    const px = a[0] + abx * t
    const pz = a[1] + abz * t
    const d = Math.hypot(x - px, z - pz)
    if (d < best.distance) {
      best = {
        point: [px, pz],
        progress: segment.length > 0 ? (walked + Math.sqrt(lenSq) * t) / segment.length : 0,
        distance: d,
      }
    }
    walked += Math.sqrt(lenSq)
  }
  return best
}

/** Heading (atan2(dx, dz)) of the polyline at normalized progress. */
export function headingAtProgress(segment: LaneSegment, progress: number): number {
  const target = Math.max(0, Math.min(1, progress)) * segment.length
  let walked = 0
  for (let i = 1; i < segment.points.length; i++) {
    const a = segment.points[i - 1]
    const b = segment.points[i]
    const step = Math.hypot(b[0] - a[0], b[1] - a[1])
    if (walked + step >= target || i === segment.points.length - 1) {
      return Math.atan2(b[0] - a[0], b[1] - a[1])
    }
    walked += step
  }
  return 0
}
