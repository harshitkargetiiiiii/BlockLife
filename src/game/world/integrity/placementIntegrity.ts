/**
 * Runtime bridge for 3D-placement integrity (issue §7/§8). Placement is STATIC
 * authored data, so the whole-city validation is computed ONCE (memoized) and
 * surfaced two ways: as the per-district report (`getCityPlacementReports`, for
 * the debug/test API + the gate) and as runtime anomalies folded into the
 * observe-only integrity scan — so a future authored defect shows up live as a
 * sustained `prop_floating` / `prop_clipping` / `anchor_invalid`, not just as a
 * failing unit test. Cost is ~0 per scan (memoized; the clean city yields none).
 */
import type { PropType } from '../worldTypes'
import { COMPILED_SECTORS } from '../authoring/compiledSectors'
import { BUILDINGS, PROPS } from '../cityLayout'
import type { AnomalyType, RawAnomaly } from './anomalyTypes'
import type { PlacementFailure } from './placementValidation'
import { type PlacementReport, validateSectorPlacement } from './sectorPlacementReport'

let cached: PlacementReport[] | null = null

/** Per-district placement reports for the whole authored city (memoized). */
export function getCityPlacementReports(): PlacementReport[] {
  if (cached) return cached
  const reports: PlacementReport[] = [
    validateSectorPlacement({
      sectorId: 'central',
      buildings: BUILDINGS.map((b) => ({ id: b.id, position: b.position, size: b.size, door: b.door })),
      props: PROPS.map((p) => ({ id: p.id, type: p.type, position: p.position, rotationY: p.rotationY })),
    }),
    ...COMPILED_SECTORS.map((s) =>
      validateSectorPlacement({
        sectorId: s.sectorId,
        buildings: s.buildings.map((b) => ({ id: b.id, position: b.position, size: b.size, door: b.door })),
        props: s.props.map((p) => ({ id: p.id, type: p.type as PropType, position: p.position, rotationY: p.rotationY })),
        citizens: s.citizens.map((c) => ({ id: c.id, position: c.position, waypoints: c.waypoints })),
      }),
    ),
  ]
  cached = reports
  return reports
}

export function getCityPlacementFailures(): PlacementFailure[] {
  return getCityPlacementReports().flatMap((r) => r.failures)
}

/** Test/dev only — drop the memo so a re-run picks up hot-reloaded authored data. */
export function resetPlacementCache(): void {
  cached = null
}

/** Placement failure kinds that map to one of the three named runtime anomalies.
 *  duplicate_citizen + route_corridor are surfaced in the report, not here. */
const KIND_TO_ANOMALY: Partial<Record<PlacementFailure['kind'], AnomalyType>> = {
  prop_floating: 'prop_floating',
  prop_clipping: 'prop_clipping',
  anchor_invalid: 'anchor_invalid',
}

/** Map placement failures to observe-only runtime anomalies (pure). */
export function scanPlacementAnomalies(failures: readonly PlacementFailure[]): RawAnomaly[] {
  const out: RawAnomaly[] = []
  for (const f of failures) {
    const type = KIND_TO_ANOMALY[f.kind]
    if (!type) continue
    out.push({
      type,
      severity: 'error',
      entityIds: f.otherId ? [f.entityId, f.otherId] : [f.entityId],
      sectorId: f.sectorId ?? null,
      depth: f.correction,
      detail: f.reason,
    })
  }
  return out
}
