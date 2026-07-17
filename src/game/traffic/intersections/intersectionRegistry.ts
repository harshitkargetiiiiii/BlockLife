import type { StopLine } from '../signalRules'
import type { PedestrianSignal } from '../signalRules'
import type { VehicleRouteState } from '../routing/routeRuntime'
import type { CrosswalkZone } from '../trafficTypes'
import { COMPILED_SECTORS } from '../../world/authoring/compiledSectors'
import {
  getCrossingEntrySignal,
  getIntersectionPhaseAt,
  getMovementSignal,
  type ApproachId,
  type CompiledCrossing,
  type CompiledCrossIntersection,
} from './crossIntersection'

/**
 * Global registry of compiled signalized intersections. Like the road
 * graph, this metadata is always loaded — sector streaming mounts and
 * unmounts VISUALS, never signal state, and phases derive purely from the
 * global traffic clock, so an unload/reload can't reset a light.
 */

export const INTERSECTIONS: CompiledCrossIntersection[] = COMPILED_SECTORS.flatMap(
  (c) => c.intersections,
)

const BY_ID = new Map(INTERSECTIONS.map((x) => [x.id, x]))

/** approach lane segment id → { intersection, approach } */
const BY_APPROACH_SEGMENT = new Map<string, { intersection: CompiledCrossIntersection; approach: ApproachId }>()
/** movement segment id → { intersection, approach } */
const BY_MOVEMENT_SEGMENT = new Map<string, { intersection: CompiledCrossIntersection; approach: ApproachId }>()
for (const x of INTERSECTIONS) {
  for (const [segId, approach] of Object.entries(x.approachSegments)) {
    BY_APPROACH_SEGMENT.set(segId, { intersection: x, approach: approach as ApproachId })
  }
  for (const m of x.movements) {
    BY_MOVEMENT_SEGMENT.set(m.segmentId, { intersection: x, approach: m.approach })
  }
}

export function getIntersection(id: string): CompiledCrossIntersection | undefined {
  return BY_ID.get(id)
}

/**
 * Every intersection crossing as a standard CrosswalkZone: pedestrians run
 * the same etiquette (wait at curb / commit / clear) and cars yield to
 * occupied zones through the same decision-engine rule as painted central
 * crosswalks — no parallel pedestrian system.
 */
const crossingRecords: { zone: CrosswalkZone; crossing: CompiledCrossing; intersection: CompiledCrossIntersection }[] =
  INTERSECTIONS.flatMap((x) =>
    x.crossings.map((c) => ({
      zone: {
        id: c.id,
        center: c.center,
        size: [c.halfExtents[0] * 2, c.halfExtents[1] * 2] as [number, number],
        waitSpots: c.waitSpots.map((s) => [...s] as [number, number]),
        connectedSidewalkNodeIds: [],
        affectedLaneIds: [],
      },
      crossing: c,
      intersection: x,
    })),
  )

export const INTERSECTION_CROSSWALK_ZONES: CrosswalkZone[] = crossingRecords.map((r) => r.zone)
export const INTERSECTION_CROSSWALK_IDS: ReadonlySet<string> = new Set(
  INTERSECTION_CROSSWALK_ZONES.map((z) => z.id),
)
const CROSSING_BY_ID = new Map(crossingRecords.map((r) => [r.zone.id, r]))

export function getIntersectionCrossingZone(id: string): CrosswalkZone | undefined {
  return CROSSING_BY_ID.get(id)?.zone
}

export function getIntersectionForCrossing(id: string): CompiledCrossIntersection | undefined {
  return CROSSING_BY_ID.get(id)?.intersection
}

/**
 * Walk indicator for one intersection crossing at the global clock:
 * 'walk' only while a fresh pedestrian can still finish (walk remainder +
 * trailing all-red covers the traverse), 'clearance' after that (committed
 * crossers keep going), 'dont_walk' whenever vehicles could be served.
 */
export function getIntersectionCrossingSignal(crosswalkId: string, elapsed: number): PedestrianSignal {
  const rec = CROSSING_BY_ID.get(crosswalkId)
  if (!rec) return 'dont_walk'
  return getCrossingEntrySignal(rec.intersection, rec.crossing, elapsed)
}

export function isIntersectionMovementSegment(segmentId: string): boolean {
  return BY_MOVEMENT_SEGMENT.has(segmentId)
}

/**
 * The stop line a route must respect RIGHT NOW, or null. Applies when the
 * car is on an approach lane whose next route step is a movement that is
 * currently red. A car already ON a movement segment is committed — it
 * always clears the box (phase transitions never strand cars inside).
 */
export function getRedIntersectionStopLine(
  state: VehicleRouteState,
  elapsed: number,
): StopLine | null {
  const currentId = state.route?.segmentIds[state.segmentIndex]
  const nextId = state.route?.segmentIds[state.segmentIndex + 1]
  if (!currentId || !nextId) return null
  const approach = BY_APPROACH_SEGMENT.get(currentId)
  if (!approach) return null
  const movement = BY_MOVEMENT_SEGMENT.get(nextId)
  if (!movement || movement.intersection.id !== approach.intersection.id) return null
  if (getMovementSignal(approach.intersection, movement.approach, elapsed) === 'green') return null
  return approach.intersection.stopLines.find((l) => l.approach === approach.approach) ?? null
}

/** Debug/test snapshot for one intersection. */
export function getIntersectionStateSnapshot(id: string, elapsed: number) {
  const x = BY_ID.get(id)
  if (!x) return null
  const { step, index, remaining } = getIntersectionPhaseAt(x, elapsed)
  return {
    id: x.id,
    phaseId: step.id,
    phaseIndex: index,
    remaining,
    cycleLength: x.cycleLength,
    permittedVehicleGroups: step.permittedVehicleGroups,
    permittedPedestrianGroups: step.permittedPedestrianGroups,
    movements: x.movements.length,
    approaches: Object.keys(x.approachSegments).length,
  }
}
