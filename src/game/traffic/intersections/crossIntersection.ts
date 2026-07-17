import type { Vec2 } from '../../world/worldTypes'
import type { StopLine } from '../signalRules'
import type { AuthoredSegmentSpec } from '../../world/authoring/authoringTypes'

/**
 * Signalized Cross-Street Intersections v1.
 *
 * A four-way intersection of two two-way roads, compiled from a compact
 * authoring spec into the EXISTING vocabulary: lane/junction SegmentSpecs
 * (exact node adjacency, stable ids), a junction box, per-approach stop
 * lines consumed by the shared car decision engine, crosswalk zones
 * consumed by the existing pedestrian/yield machinery, and a deterministic
 * split-phase signal plan derived from the GLOBAL traffic clock — phases
 * are a pure function of elapsed seconds, so pausing freezes them and
 * sector streaming can never reset them.
 *
 * v1 phase plan (provably conflict-free): each approach gets its own green
 * (all three of its movements — one origin can't self-conflict), separated
 * by all-red clearance, plus one all-walk pedestrian phase. Movement
 * throughput is modest; safety is trivial to verify. Paired greens and
 * protected lefts are documented future work.
 */

export interface CrossStreetAuthoringSpec {
  localId: string
  /** Intersection center (between the two roads' lane pairs). */
  center: Vec2
  /** Main road runs north-south through the box; lanes at center.x ± laneOffset. */
  laneOffset?: number
  /** Half-extent of the junction box. */
  halfSize?: number
  /** Per-approach green seconds (defaults 8/8/6/6) and walk seconds. */
  greenSeconds?: [number, number, number, number]
  walkSeconds?: number
  clearanceSeconds?: number
  districtId: string
}

export type ApproachId = 'south' | 'north' | 'east' | 'west'
export type MovementKind = 'straight' | 'left' | 'right'

export interface CompiledMovement {
  id: string
  segmentId: string
  approach: ApproachId
  kind: MovementKind
  path: Vec2[]
  conflictGroupIds: string[]
  signalGroupId: string
}

export interface CompiledCrossing {
  id: string
  center: Vec2
  halfExtents: Vec2
  /** Which arm the crossing spans ('north' = across the north arm). */
  arm: ApproachId
  /** Curb anchors on each end of the crossing, outside the roadway. */
  waitSpots: [Vec2, Vec2]
}

/** Pedestrian speed while committed to a crossing (walkSpeed × hustle). */
export const PED_CROSS_SPEED = 1.75

/** Seconds a pedestrian needs curb-to-curb (span + both curb gaps). */
export function crossingTraverseSeconds(crossing: CompiledCrossing): number {
  const span = 2 * Math.max(crossing.halfExtents[0], crossing.halfExtents[1]) + 3
  return span / PED_CROSS_SPEED
}

export interface IntersectionPhaseStep {
  id: string
  duration: number
  permittedVehicleGroups: string[]
  permittedPedestrianGroups: string[]
}

export interface CompiledCrossIntersection {
  id: string
  center: Vec2
  bounds: { minX: number; maxX: number; minZ: number; maxZ: number }
  movements: CompiledMovement[]
  crossings: CompiledCrossing[]
  stopLines: (StopLine & { approach: ApproachId })[]
  phases: IntersectionPhaseStep[]
  cycleLength: number
  /** Approach lane segment id → approach id (for route stop-line lookup). */
  approachSegments: Record<string, ApproachId>
  /** Poles rendered as props by the sector renderer. */
  signalPoles: { id: string; position: Vec2; facing: ApproachId }[]
}

const APPROACHES: ApproachId[] = ['south', 'north', 'east', 'west']

function segsIntersect(a1: Vec2, a2: Vec2, b1: Vec2, b2: Vec2): boolean {
  const d = (p: Vec2, q: Vec2, r: Vec2) => (q[0] - p[0]) * (r[1] - p[1]) - (q[1] - p[1]) * (r[0] - p[0])
  const d1 = d(b1, b2, a1)
  const d2 = d(b1, b2, a2)
  const d3 = d(a1, a2, b1)
  const d4 = d(a1, a2, b2)
  return ((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) && ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0))
}

function pathsConflict(a: Vec2[], b: Vec2[]): boolean {
  for (let i = 0; i < a.length - 1; i++)
    for (let j = 0; j < b.length - 1; j++)
      if (segsIntersect(a[i], a[i + 1], b[j], b[j + 1])) return true
  return false
}

/**
 * Compile one cross-street intersection. The caller (kit compiler) supplies
 * the FOUR boundary nodes implicitly via geometry: main-road lanes at
 * center.x ± off (north-south), cross-road lanes at center.z ± off
 * (east-west), box edges at center ± half.
 */
export function compileCrossIntersection(
  sectorId: string,
  spec: CrossStreetAuthoringSpec,
): {
  intersection: CompiledCrossIntersection
  segments: AuthoredSegmentSpec[]
  junctionBox: { minX: number; maxX: number; minZ: number; maxZ: number }
} {
  const off = spec.laneOffset ?? 2
  const half = spec.halfSize ?? 6
  const [cx, cz] = spec.center
  const id = `${sectorId}_${spec.localId}`
  const bounds = { minX: cx - half, maxX: cx + half, minZ: cz - half, maxZ: cz + half }

  // Boundary nodes (right-hand traffic).
  // Main road: northbound lane x = cx+off, southbound x = cx-off.
  // Cross road: eastbound lane z = cz+off (south side), westbound z = cz-off.
  const nodes = {
    inS: [cx + off, cz + half] as Vec2, // northbound arrives at south edge
    outN: [cx + off, cz - half] as Vec2,
    inN: [cx - off, cz - half] as Vec2, // southbound arrives at north edge
    outS: [cx - off, cz + half] as Vec2,
    inE: [cx + half, cz - off] as Vec2, // westbound arrives at east edge
    outW: [cx - half, cz - off] as Vec2,
    inW: [cx - half, cz + off] as Vec2, // eastbound arrives at west edge
    outE: [cx + half, cz + off] as Vec2,
  }

  const entry: Record<ApproachId, Vec2> = { south: nodes.inS, north: nodes.inN, east: nodes.inE, west: nodes.inW }
  const exitFor: Record<ApproachId, Record<MovementKind, Vec2>> = {
    south: { straight: nodes.outN, right: nodes.outE, left: nodes.outW },
    north: { straight: nodes.outS, right: nodes.outW, left: nodes.outE },
    east: { straight: nodes.outW, right: nodes.outN, left: nodes.outS },
    west: { straight: nodes.outE, right: nodes.outS, left: nodes.outN },
  }

  // Arm each movement EXITS through (its second crossing, after the box).
  const exitArm: Record<ApproachId, Record<MovementKind, ApproachId>> = {
    south: { straight: 'north', right: 'east', left: 'west' },
    north: { straight: 'south', right: 'west', left: 'east' },
    east: { straight: 'west', right: 'north', left: 'south' },
    west: { straight: 'east', right: 'south', left: 'north' },
  }

  const movements: CompiledMovement[] = []
  const segments: AuthoredSegmentSpec[] = []
  for (const approach of APPROACHES) {
    for (const kind of ['straight', 'right', 'left'] as MovementKind[]) {
      const from = entry[approach]
      const to = exitFor[approach][kind]
      const path: Vec2[] =
        kind === 'straight'
          ? [from, to]
          : kind === 'right'
            ? [from, [from[0] * 0.4 + to[0] * 0.6, from[1] * 0.4 + to[1] * 0.6], to]
            : [from, [cx, cz], to]
      const segmentId = `${id}_${approach}_${kind}`
      movements.push({
        id: `${spec.localId}_${approach}_${kind}`,
        segmentId,
        approach,
        kind,
        path,
        conflictGroupIds: [],
        signalGroupId: approach,
      })
      segments.push({
        id: segmentId,
        kind: 'junction',
        movement: kind === 'straight' ? 'straight' : kind,
        junctionId: `${id}_box`,
        points: path.map((p) => [p[0], p[1]] as Vec2),
        speedLimit: kind === 'straight' ? 4.5 : 3.2,
        districtId: spec.districtId,
        roadId: id,
        laneId: `${approach}_${kind}`,
        // Entry crossing (this arm) + exit crossing (the arm we leave by):
        // routed cars yield to occupied zones through the standard
        // crosswalk-etiquette path in the decision engine.
        crossingZoneIds: [`${id}_cross_${approach}`, `${id}_cross_${exitArm[approach][kind]}`],
      })
    }
  }

  // Conflict groups from geometry: any pair of movement paths that cross.
  for (let i = 0; i < movements.length; i++) {
    for (let j = i + 1; j < movements.length; j++) {
      if (pathsConflict(movements[i].path, movements[j].path)) {
        const group = `cg_${movements[i].id}__${movements[j].id}`
        movements[i].conflictGroupIds.push(group)
        movements[j].conflictGroupIds.push(group)
      }
    }
  }

  // Crossings span each arm just OUTSIDE the box, aligned with sidewalks.
  // Wait spots sit on the curb corners, clear of the roadway.
  const cw = 1.1
  const curb = half + 1.5
  const crossings: CompiledCrossing[] = [
    { id: `${id}_cross_north`, arm: 'north', center: [cx, cz - half - cw], halfExtents: [half - 0.5, cw],
      waitSpots: [[cx - curb, cz - half - cw], [cx + curb, cz - half - cw]] },
    { id: `${id}_cross_south`, arm: 'south', center: [cx, cz + half + cw], halfExtents: [half - 0.5, cw],
      waitSpots: [[cx - curb, cz + half + cw], [cx + curb, cz + half + cw]] },
    { id: `${id}_cross_east`, arm: 'east', center: [cx + half + cw, cz], halfExtents: [cw, half - 0.5],
      waitSpots: [[cx + half + cw, cz - curb], [cx + half + cw, cz + curb]] },
    { id: `${id}_cross_west`, arm: 'west', center: [cx - half - cw, cz], halfExtents: [cw, half - 0.5],
      waitSpots: [[cx - half - cw, cz - curb], [cx - half - cw, cz + curb]] },
  ]

  // Stop lines: BEHIND the arm crossing (band ends 2·cw past the box edge)
  // plus a gap — a car yielding at its line must never park on pedestrians.
  const stopBack = 2 * cw + 1.2
  const stopLines: CompiledCrossIntersection['stopLines'] = [
    { approach: 'south', laneId: `${id}_appr_south`, position: [nodes.inS[0], nodes.inS[1] + stopBack], direction: [0, -1] },
    { approach: 'north', laneId: `${id}_appr_north`, position: [nodes.inN[0], nodes.inN[1] - stopBack], direction: [0, 1] },
    { approach: 'east', laneId: `${id}_appr_east`, position: [nodes.inE[0] + stopBack, nodes.inE[1]], direction: [-1, 0] },
    { approach: 'west', laneId: `${id}_appr_west`, position: [nodes.inW[0] - stopBack, nodes.inW[1]], direction: [1, 0] },
  ]

  // Split-phase plan: one green per approach + all-walk, all-red between.
  const greens = spec.greenSeconds ?? [8, 8, 6, 6]
  const clear = spec.clearanceSeconds ?? 2
  const walk = spec.walkSeconds ?? 8
  const phases: IntersectionPhaseStep[] = []
  APPROACHES.forEach((approach, i) => {
    phases.push({ id: `green_${approach}`, duration: greens[i], permittedVehicleGroups: [approach], permittedPedestrianGroups: [] })
    phases.push({ id: `clear_${approach}`, duration: clear, permittedVehicleGroups: [], permittedPedestrianGroups: [] })
  })
  phases.push({ id: 'walk_all', duration: walk, permittedVehicleGroups: [], permittedPedestrianGroups: ['all'] })
  phases.push({ id: 'clear_walk', duration: clear, permittedVehicleGroups: [], permittedPedestrianGroups: [] })
  const cycleLength = phases.reduce((s, p) => s + p.duration, 0)

  const signalPoles: CompiledCrossIntersection['signalPoles'] = [
    { id: `${id}_pole_south`, position: [cx + half + 0.9, cz + half + 0.9], facing: 'south' },
    { id: `${id}_pole_north`, position: [cx - half - 0.9, cz - half - 0.9], facing: 'north' },
    { id: `${id}_pole_east`, position: [cx + half + 0.9, cz - half - 0.9], facing: 'east' },
    { id: `${id}_pole_west`, position: [cx - half - 0.9, cz + half + 0.9], facing: 'west' },
  ]

  return {
    intersection: {
      id,
      center: spec.center,
      bounds,
      movements,
      crossings,
      stopLines,
      phases,
      cycleLength,
      approachSegments: {}, // filled by the kit compiler once arm roads exist
      signalPoles,
    },
    segments,
    junctionBox: bounds,
  }
}

/** Phase at a global elapsed time — O(1)-ish, pure, pause/stream immune. */
export function getIntersectionPhaseAt(
  intersection: CompiledCrossIntersection,
  elapsed: number,
): { step: IntersectionPhaseStep; index: number; remaining: number } {
  let t = ((elapsed % intersection.cycleLength) + intersection.cycleLength) % intersection.cycleLength
  for (let i = 0; i < intersection.phases.length; i++) {
    const step = intersection.phases[i]
    if (t < step.duration) return { step, index: i, remaining: step.duration - t }
    t -= step.duration
  }
  return { step: intersection.phases[0], index: 0, remaining: intersection.phases[0].duration }
}

export function getMovementSignal(
  intersection: CompiledCrossIntersection,
  approach: ApproachId,
  elapsed: number,
): 'green' | 'red' {
  const { step } = getIntersectionPhaseAt(intersection, elapsed)
  return step.permittedVehicleGroups.includes(approach) ? 'green' : 'red'
}

export function getCrossingSignal(
  intersection: CompiledCrossIntersection,
  elapsed: number,
): 'walk' | 'dont_walk' {
  const { step } = getIntersectionPhaseAt(intersection, elapsed)
  return step.permittedPedestrianGroups.includes('all') ? 'walk' : 'dont_walk'
}

/**
 * Entry indicator for ONE crossing: 'walk' only while the all-walk phase
 * has enough time left (walk remainder + the trailing all-red clearance)
 * for a fresh pedestrian to finish; 'clearance' during the tail of walk
 * and the clear_walk phase (committed crossers keep going, nobody new
 * enters); 'dont_walk' whenever any vehicle group could be served.
 */
export function getCrossingEntrySignal(
  intersection: CompiledCrossIntersection,
  crossing: CompiledCrossing,
  elapsed: number,
): 'walk' | 'clearance' | 'dont_walk' {
  const { step, remaining } = getIntersectionPhaseAt(intersection, elapsed)
  if (!step.permittedPedestrianGroups.includes('all')) {
    return step.id === 'clear_walk' ? 'clearance' : 'dont_walk'
  }
  const clearance = intersection.phases.find((p) => p.id === 'clear_walk')?.duration ?? 0
  return remaining + clearance >= crossingTraverseSeconds(crossing) ? 'walk' : 'clearance'
}

/** Validation: safety invariants any compiled intersection must satisfy. */
export function validateCrossIntersection(x: CompiledCrossIntersection): string[] {
  const errors: string[] = []
  if (x.movements.length !== 12) errors.push(`${x.id}: expected 12 movements, got ${x.movements.length}`)
  const ids = new Set(x.movements.map((m) => m.segmentId))
  if (ids.size !== x.movements.length) errors.push(`${x.id}: duplicate movement segment ids`)
  for (const m of x.movements) {
    for (const p of m.path) {
      if (p[0] < x.bounds.minX - 0.01 || p[0] > x.bounds.maxX + 0.01 || p[1] < x.bounds.minZ - 0.01 || p[1] > x.bounds.maxZ + 0.01) {
        errors.push(`${x.id}: movement ${m.id} point (${p}) leaves the junction bounds`)
      }
    }
  }
  // No phase may permit two geometrically conflicting vehicle groups.
  for (const phase of x.phases) {
    const permitted = x.movements.filter((m) => phase.permittedVehicleGroups.includes(m.signalGroupId))
    for (let i = 0; i < permitted.length; i++) {
      for (let j = i + 1; j < permitted.length; j++) {
        const a = permitted[i]
        const b = permitted[j]
        if (a.approach !== b.approach && pathsConflict(a.path, b.path)) {
          errors.push(`${x.id}: phase ${phase.id} permits conflicting movements ${a.id} × ${b.id}`)
        }
      }
    }
    // Pedestrian walk must never coexist with any vehicle group.
    if (phase.permittedPedestrianGroups.length > 0 && phase.permittedVehicleGroups.length > 0) {
      errors.push(`${x.id}: phase ${phase.id} permits pedestrians alongside vehicles`)
    }
  }
  // Stop lines sit before (outside) the box on their approach axis…
  for (const line of x.stopLines) {
    const inside =
      line.position[0] > x.bounds.minX && line.position[0] < x.bounds.maxX &&
      line.position[1] > x.bounds.minZ && line.position[1] < x.bounds.maxZ
    if (inside) errors.push(`${x.id}: stop line for ${line.approach} sits inside the junction box`)
    // …and BEHIND every crossing band: a yielding car must never park on
    // pedestrians.
    for (const c of x.crossings) {
      const inBand =
        Math.abs(line.position[0] - c.center[0]) < c.halfExtents[0] &&
        Math.abs(line.position[1] - c.center[1]) < c.halfExtents[1]
      if (inBand) errors.push(`${x.id}: stop line for ${line.approach} sits inside crossing ${c.id}`)
    }
  }
  for (const phase of x.phases) {
    if (!(phase.duration > 0)) errors.push(`${x.id}: phase ${phase.id} has invalid duration`)
  }
  // Pedestrian feasibility: the slowest crossing must fit inside the walk
  // phase plus its clearance, and wait anchors must sit clear of the
  // roadway (outside the box's axis span, where the sidewalk corners are).
  const walk = x.phases.find((p) => p.id === 'walk_all')
  const clearWalk = x.phases.find((p) => p.id === 'clear_walk')
  for (const c of x.crossings) {
    if (walk && clearWalk && crossingTraverseSeconds(c) > walk.duration + clearWalk.duration) {
      errors.push(`${x.id}: crossing ${c.id} needs ${crossingTraverseSeconds(c).toFixed(1)}s but walk+clearance is ${walk.duration + clearWalk.duration}s`)
    }
    for (const spot of c.waitSpots) {
      const onRoadway =
        c.arm === 'north' || c.arm === 'south'
          ? spot[0] > x.bounds.minX && spot[0] < x.bounds.maxX
          : spot[1] > x.bounds.minZ && spot[1] < x.bounds.maxZ
      if (onRoadway) errors.push(`${x.id}: wait spot of ${c.id} stands on the roadway`)
    }
  }
  return errors
}
