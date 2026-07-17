import type { Vec2 } from '../../world/worldTypes'
import type { LaneSegment, RoadGraph } from './roadGraphTypes'

/**
 * Project a world point onto the lane-segment graph. Used by emergency police
 * pursuit to find the suspect's (and the cruiser's own) live road segment so a
 * route can be planned to it. Not called per-frame per-car — only when a
 * pursuit (re)plans, on a bounded cadence.
 */

export interface RoadProjection {
  segmentId: string
  /** 0..1 along the segment polyline of the closest point. */
  progress: number
  point: Vec2
  distance: number
}

/** Closest point on a directed polyline + its 0..1 progress. */
function projectOntoPolyline(
  points: Vec2[],
  length: number,
): (pos: Vec2) => { progress: number; point: Vec2; distance: number } {
  return (pos: Vec2) => {
    let best = { progress: 0, point: points[0], distance: Infinity }
    let acc = 0
    for (let i = 0; i < points.length - 1; i++) {
      const a = points[i]
      const b = points[i + 1]
      const abx = b[0] - a[0]
      const abz = b[1] - a[1]
      const abLen2 = abx * abx + abz * abz || 1
      let t = ((pos[0] - a[0]) * abx + (pos[1] - a[1]) * abz) / abLen2
      t = Math.max(0, Math.min(1, t))
      const px = a[0] + abx * t
      const pz = a[1] + abz * t
      const d = Math.hypot(pos[0] - px, pos[1] - pz)
      const edgeLen = Math.hypot(abx, abz)
      if (d < best.distance) {
        best = {
          progress: length > 0 ? (acc + edgeLen * t) / length : 0,
          point: [px, pz],
          distance: d,
        }
      }
      acc += edgeLen
    }
    return best
  }
}

/** The graph segment whose polyline passes closest to `pos`, or null. */
export function nearestRoadSegment(
  graph: RoadGraph,
  pos: Vec2,
  filter?: (seg: LaneSegment) => boolean,
): RoadProjection | null {
  let best: RoadProjection | null = null
  for (const seg of graph.segments.values()) {
    if (seg.points.length < 2) continue
    if (filter && !filter(seg)) continue
    const proj = projectOntoPolyline(seg.points, seg.length)(pos)
    if (!best || proj.distance < best.distance) {
      best = { segmentId: seg.id, progress: proj.progress, point: proj.point, distance: proj.distance }
    }
  }
  return best
}
