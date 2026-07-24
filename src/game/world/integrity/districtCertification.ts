/**
 * District certification compiler (World Integrity issue §11/§12). Produces one
 * deterministic, machine-readable certificate per authored district by DERIVING
 * every capability check from REAL authored/compiled/generated evidence — never
 * a hard-coded pass. A district FAILS iff any error-severity check fails.
 *
 * Honest-gate contract (PR #11 review): a check is only `pass` when there is
 * positive evidence for it; a check with NO evidence is `fail` (for a required
 * capability) or an explicit `skip`/`warn` with a documented reason (for a
 * capability that legitimately does not apply — a backdrop with no streetscape, a
 * globally-applied system with nothing authored per-district). The verdict counts
 * only error-severity failures, so a `skip` may never stand in for missing
 * evidence on a required capability. Concretely, that means:
 *   - `traversal_coverage` / `anomaly_probe_coverage` are DERIVED from the
 *     Automated City Sweeper's generated output — a district the generator drops
 *     fails, so a new district can't be silently un-swept.
 *   - `visual_coverage` is derived from the generated visual sweep frames.
 *   - `building_occlusion` FAILS when a district has qualifying (tall) buildings
 *     but no parity-report entry (mis-attributed evidence), instead of defaulting
 *     to pass.
 *   - `traffic_signals` / `reference_integrity` / `crosswalk_clearance` are
 *     derived from the compiled intersections, the compile-time reference
 *     validator, and the crosswalk wait-spots vs. the district's solids.
 *   - `lighting_night_hook` / `weather_hook` are GLOBAL systems with nothing
 *     authored per-district → explicit `skip` with a reason (never a fake pass).
 */
import type { PropType, Vec2, Vec3 } from '../worldTypes'
import type { WorldBounds } from '../sectors/worldGrid'
import type { CompiledCrossIntersection } from '../../traffic/intersections/crossIntersection'
import type { CompiledWalkCrossing } from '../authoring/authoringTypes'
import { BUILDINGS, PROPS } from '../cityLayout'
import { getCompiledSector } from '../authoring/compiledSectors'
import { validateCompiledSectorContent } from '../authoring/sectorAuthoring'
import {
  SECTOR_DEFINITIONS,
  type SectorDefinition,
  isAuthoredSector,
} from '../sectors/sectorRegistry'
import { getRoadGraph } from '../../traffic/routing/roadGraphBuilder'
import { validateRoadGraph } from '../../traffic/routing/roadGraphValidation'
import { type OcclusionParityReport, certifyOcclusionParity, MIN_OCCLUDER_HEIGHT } from './occlusionParity'
import {
  type PlacementReport,
  validateSectorPlacement,
  buildingFootprint,
  propFootprint,
  PERSON_ANCHOR_RADIUS,
} from './sectorPlacementReport'
import type { SolidRect } from './placementValidation'
import { generateTraversalTargets, generateVisualSweepFrames } from './citySweep'

export type CheckStatus = 'pass' | 'fail' | 'warn' | 'skip'

export interface CertificationCheck {
  /** Stable check id from the §11 matrix, e.g. 'building_occlusion'. */
  name: string
  status: CheckStatus
  severity: 'error' | 'warning'
  count?: number
  expected?: number
  detail?: string
}

export interface DistrictCertificate {
  sectorId: string
  displayName: string
  /** Sector def version + road-graph content version (data provenance). */
  version: { sector: number; graph: number }
  checks: CertificationCheck[]
  optOuts: { id: string; reason: string }[]
  errors: number
  warnings: number
  verdict: 'pass' | 'fail'
}

export interface CityCertification {
  districts: DistrictCertificate[]
  totalDistricts: number
  passed: number
  verdict: 'pass' | 'fail'
}

// ---- normalized certifiable district -------------------------------------

export interface CertifiableDistrict {
  def: SectorDefinition
  buildings: { id: string; position: Vec2; size: Vec3; door?: 'north' | 'south' | 'east' | 'west' }[]
  props: { id: string; type: PropType; position: Vec2; rotationY?: number }[]
  citizens: { id: string; position: Vec2; waypoints: readonly Vec2[] }[]
  surfaceKinds: Set<string>
  ownedSegments: number
  intersections: CompiledCrossIntersection[]
  destinations: number
  walkCrossings: CompiledWalkCrossing[]
  /** Whether this district has its OWN compiled kit content (vs the legacy
   *  central adapter or a content-less backdrop). Governs which evidence source
   *  reference-integrity reads. */
  hasCompiled: boolean
  /** Reference-integrity errors from the compile-time validator (kit sectors):
   *  destinations referencing a missing segment, ids with no authoring source. */
  refErrors: string[]
  /** Backdrop/support sector with no authored streets or citizens (softer bar). */
  backdrop: boolean
}

/** The compile-time reference-integrity subset of the full validator output. */
function referenceErrors(compiled: ReturnType<typeof getCompiledSector>): string[] {
  if (!compiled) return []
  return validateCompiledSectorContent(compiled).filter(
    (e) => e.includes('references missing segment') || e.includes('has no authoring source ref'),
  )
}

/** Gather a district's certifiable data from the kit-compiled content or, for
 *  the legacy central neighbourhood, the cityLayout adapter. */
function gatherDistrict(def: SectorDefinition, graphSectorSegments: Map<string, number>): CertifiableDistrict {
  const compiled = getCompiledSector(def.id)
  if (compiled) {
    return {
      def,
      buildings: compiled.buildings.map((b) => ({ id: b.id, position: b.position, size: b.size, door: b.door })),
      props: compiled.props.map((p) => ({ id: p.id, type: p.type as PropType, position: p.position, rotationY: p.rotationY })),
      citizens: compiled.citizens.map((c) => ({ id: c.id, position: c.position, waypoints: c.waypoints })),
      surfaceKinds: new Set(compiled.surfaces.map((s) => s.kind)),
      ownedSegments: graphSectorSegments.get(def.id) ?? 0,
      intersections: compiled.intersections,
      destinations: compiled.destinations.length,
      walkCrossings: compiled.walkCrossings,
      hasCompiled: true,
      refErrors: referenceErrors(compiled),
      backdrop: false,
    }
  }
  // Legacy central neighbourhood: BUILDINGS/PROPS live in cityLayout. Backdrops
  // have neither compiled content nor central data → treated as backdrops.
  const central = def.districtIds.includes('central')
  return {
    def,
    buildings: central ? BUILDINGS.map((b) => ({ id: b.id, position: b.position, size: b.size, door: b.door })) : [],
    props: central ? PROPS.map((p) => ({ id: p.id, type: p.type, position: p.position, rotationY: p.rotationY })) : [],
    citizens: [],
    surfaceKinds: new Set(central ? ['road', 'sidewalk', 'grass'] : []),
    ownedSegments: graphSectorSegments.get(def.id) ?? 0,
    intersections: [],
    destinations: 0,
    walkCrossings: [],
    hasCompiled: false,
    refErrors: [],
    backdrop: !central,
  }
}

/** Segments owned per sector (road-graph ownership), by segment id prefix. */
function segmentsBySector(): Map<string, number> {
  const graph = getRoadGraph()
  const byId = new Map<string, number>()
  for (const def of SECTOR_DEFINITIONS) byId.set(def.id, 0)
  for (const seg of graph.segments.values()) {
    // Kit segment ids are `${sectorId}_...`; match the longest sector-id prefix.
    for (const def of SECTOR_DEFINITIONS) {
      if (seg.id.startsWith(`${def.id}_`)) {
        byId.set(def.id, (byId.get(def.id) ?? 0) + 1)
        break
      }
    }
  }
  return byId
}

/** True when a person of `radius` standing at (x,z) would overlap the solid —
 *  the solid footprint expanded by the body radius (matches anchor clearance). */
function anchorHitsSolid(x: number, z: number, s: SolidRect, radius: number): boolean {
  return x >= s.minX - radius && x <= s.maxX + radius && z >= s.minZ - radius && z <= s.maxZ + radius
}

// ---- per-district certification -------------------------------------------

/** Everything certifyDistrict needs beyond the district's own authored data —
 *  the shared reports + the generated-coverage membership. Passed explicitly so
 *  the function stays PURE and a negative test can inject a single missing
 *  evidence source. */
export interface DistrictEvidence {
  occlusion: OcclusionParityReport
  placement: PlacementReport
  graphErrors: readonly string[]
  graphVersion: number
  /** The district appears in the generated traversal targets (city-sweep E2E +
   *  the 300s soak both consume these). */
  traversalCovered: boolean
  /** The district appears in the generated visual-sweep frames (map-visible). */
  visualCovered: boolean
}

export function certifyDistrict(d: CertifiableDistrict, ev: DistrictEvidence): DistrictCertificate {
  const checks: CertificationCheck[] = []
  const optOuts: { id: string; reason: string }[] = []
  const add = (
    name: string,
    ok: boolean,
    severity: 'error' | 'warning',
    extra: Partial<CertificationCheck> = {},
  ) => checks.push({ name, status: ok ? 'pass' : severity === 'error' ? 'fail' : 'warn', severity, ...extra })
  const skip = (name: string, severity: 'error' | 'warning', detail: string, extra: Partial<CertificationCheck> = {}) =>
    checks.push({ name, status: 'skip', severity, detail, ...extra })

  // identity + bounds + streaming ownership
  add('sector_identity', d.def.id.length > 0 && d.def.name.length > 0, 'error', { detail: d.def.id })
  const b: WorldBounds = d.def.bounds
  add('sector_bounds', b.maxX > b.minX && b.maxZ > b.minZ, 'error')
  add('streaming_ownership', isAuthoredSector(d.def.id), 'error')

  // floor + visuals
  const hasFloor = d.surfaceKinds.size > 0 || d.buildings.length > 0
  add('floor_coverage', d.backdrop ? true : hasFloor, d.backdrop ? 'warning' : 'error', {
    count: d.surfaceKinds.size,
  })
  add('visual_registration', d.buildings.length > 0 || d.surfaceKinds.size > 0, d.backdrop ? 'warning' : 'error', {
    count: d.buildings.length,
  })

  // building bounds + colliders (collider derives from size, so bounds-finite ⇒
  // collider-valid) + occlusion parity (reuses the certified parity report)
  const badBuildings = d.buildings.filter((x) => !(x.size[0] > 0 && x.size[1] > 0 && x.size[2] > 0)).length
  add('building_bounds', badBuildings === 0, 'error', { count: d.buildings.length })
  add('building_colliders', badBuildings === 0, 'error', { count: d.buildings.length })
  // Occlusion parity: a district with QUALIFYING (tall) buildings must have a
  // parity-report entry that passes. Missing evidence (tall buildings but no
  // entry — e.g. mis-attributed to another sector) FAILS; a district with no
  // qualifying occluders trivially passes (nothing to fade). Never default-pass.
  const occ = ev.occlusion.sectors.find((s) => s.sectorId === d.def.id)
  const tallBuildings = d.buildings.filter((x) => x.size[1] >= MIN_OCCLUDER_HEIGHT).length
  add('building_occlusion', occ ? occ.pass : tallBuildings === 0, 'error', {
    count: occ?.occludable ?? 0,
    expected: occ?.qualifying ?? tallBuildings,
    detail: occ
      ? occ.missing.length > 0
        ? `missing: ${occ.missing.join(',')}`
        : undefined
      : tallBuildings > 0
        ? `${tallBuildings} qualifying buildings absent from the parity report`
        : 'no qualifying occluders',
  })
  for (const o of occ?.optOuts ?? []) optOuts.push(o)

  // prop placement (visual bounds + base contact), anchors, duplicate routes —
  // reuse the placement report for this district
  const propFails = ev.placement.failures.filter((f) => f.kind === 'prop_floating' || f.kind === 'prop_clipping')
  add('prop_visual_bounds', propFails.every((f) => f.kind !== 'prop_clipping'), 'error', { count: d.props.length })
  add('prop_base_contact', propFails.every((f) => f.kind !== 'prop_floating'), 'error', { count: d.props.length })
  add('anchor_clearance', ev.placement.failures.every((f) => f.kind !== 'anchor_invalid'), 'error')
  add('duplicate_routes', ev.placement.failures.every((f) => f.kind !== 'duplicate_citizen'), 'error', {
    count: d.citizens.length,
  })

  // obstacles present, road graph connectivity/ownership
  add('static_obstacles', ev.placement.counts.solids > 0 || d.backdrop, 'warning', { count: ev.placement.counts.solids })
  add('road_graph', ev.graphErrors.length === 0, 'error', { detail: ev.graphErrors[0] })
  add('road_ownership', d.backdrop || d.ownedSegments > 0, 'warning', { count: d.ownedSegments })

  // traffic signals — DERIVED: a district with authored intersections must have
  // a well-formed signal plan on each (a phase plan, a cycle, and every movement
  // bound to a signal group). No intersections authored → nothing to certify.
  const signalMalformed = d.intersections.filter(
    (x) => x.phases.length === 0 || x.cycleLength <= 0 || x.movements.length === 0 || x.movements.some((m) => m.signalGroupId.length === 0),
  )
  if (d.intersections.length === 0) {
    skip('traffic_signals', 'warning', 'no signalled intersections authored', { count: 0 })
  } else {
    add('traffic_signals', signalMalformed.length === 0, 'error', {
      count: d.intersections.length,
      detail: signalMalformed[0]?.id,
    })
  }

  // reference integrity — DERIVED: kit sectors from the compile-time validator
  // (destinations → real segments, every generated id has a source ref); the
  // legacy central set's destinations live in the global graph, so its refs are
  // carried by the road-graph validation (road_graph). A backdrop has no refs.
  if (d.hasCompiled) {
    add('reference_integrity', d.refErrors.length === 0, 'error', {
      count: d.destinations,
      detail: d.refErrors[0],
    })
  } else if (d.backdrop) {
    skip('reference_integrity', 'error', 'backdrop: no authored routing references', { count: 0 })
  } else {
    // central: destinations validated by the global road graph
    add('reference_integrity', ev.graphErrors.length === 0, 'error', {
      count: d.destinations,
      detail: 'central refs validated via the global road graph',
    })
  }

  // crosswalk clearance — DERIVED: every crosswalk wait-spot (unsignalled kit
  // crossings + signalled intersection crossings) must sit clear of the
  // district's solids (a waiting pedestrian must not stand inside a building or
  // a signal pole / traffic-furniture prop). No crossings authored → nothing to
  // certify.
  const solids: SolidRect[] = [
    ...d.buildings.map(buildingFootprint),
    ...d.props.map(propFootprint).filter((r): r is SolidRect => r != null),
  ]
  const waitSpots: Vec2[] = [
    ...d.walkCrossings.flatMap((w) => w.waitSpots),
    ...d.intersections.flatMap((x) => x.crossings.flatMap((c) => c.waitSpots)),
  ]
  const embeddedWaits = waitSpots.filter(([wx, wz]) => solids.some((s) => anchorHitsSolid(wx, wz, s, PERSON_ANCHOR_RADIUS)))
  if (waitSpots.length === 0) {
    skip('crosswalk_clearance', 'warning', 'no authored crosswalks', { count: 0 })
  } else {
    add('crosswalk_clearance', embeddedWaits.length === 0, 'error', {
      count: waitSpots.length,
      detail: embeddedWaits.length > 0 ? `${embeddedWaits.length} wait-spot(s) embedded in a solid` : undefined,
    })
  }

  // world UI label
  add('world_label', d.def.map.label.length > 0, 'warning', { detail: d.def.map.label })

  // Lighting + weather are GLOBAL systems applied to every sector by the render
  // root; there is nothing authored per-district to certify, so they are honest
  // SKIPS (never a fabricated pass), documented as such.
  skip('lighting_night_hook', 'warning', 'global night lighting; not authored per-district')
  skip('weather_hook', 'warning', 'global weather; not authored per-district')

  // Generated-coverage gates (Automated City Sweeper, §13) — DERIVED from the
  // actual generator output so a district the generator drops FAILS here.
  //  - traversal_coverage: the generated traversal targets include this district
  //    (consumed by the city-sweep E2E AND the 300s soak).
  //  - anomaly_probe_coverage: the same generated set drives the soak, whose
  //    observe-only ~4Hz scan therefore runs over this district's entities.
  //  - visual_coverage: the generated visual sweep frames a map-visible district.
  add('traversal_coverage', d.backdrop || ev.traversalCovered, d.backdrop ? 'warning' : 'error', {
    detail: ev.traversalCovered ? 'generated traversal target present' : 'no generated traversal target',
  })
  add('anomaly_probe_coverage', d.backdrop || ev.traversalCovered, d.backdrop ? 'warning' : 'error', {
    detail: ev.traversalCovered ? 'soak cycles this district → observe-only scan covers it' : 'not in the soak cycle',
  })
  if (d.def.map.showOnMap) {
    add('visual_coverage', ev.visualCovered, 'error', {
      detail: ev.visualCovered ? 'generated overview frame present' : 'map-visible but no generated visual frame',
    })
  } else {
    skip('visual_coverage', 'warning', 'not map-visible: no streetscape to photograph')
  }

  const errors = checks.filter((c) => c.status === 'fail' && c.severity === 'error').length
  const warnings = checks.filter((c) => c.status === 'warn').length
  return {
    sectorId: d.def.id,
    displayName: d.def.name,
    version: { sector: d.def.version, graph: ev.graphVersion },
    checks,
    optOuts,
    errors,
    warnings,
    verdict: errors === 0 ? 'pass' : 'fail',
  }
}

// ---- city certification ---------------------------------------------------

/** Certify every authored district. Deterministic (sector-def order). */
export function certifyCity(): CityCertification {
  const occlusion = certifyOcclusionParity()
  const graph = getRoadGraph()
  const graphErrors = validateRoadGraph(graph)
  const owned = segmentsBySector()
  // Generated-coverage sets, derived from the Automated City Sweeper's own output.
  const traversalSectors = new Set(generateTraversalTargets().map((t) => t.sectorId))
  const visualSectors = new Set(generateVisualSweepFrames().map((f) => f.sectorId))

  const districts = SECTOR_DEFINITIONS.map((def) => {
    const d = gatherDistrict(def, owned)
    const placement = validateSectorPlacement({
      sectorId: def.id,
      buildings: d.buildings,
      props: d.props,
      citizens: d.citizens,
    })
    return certifyDistrict(d, {
      occlusion,
      placement,
      graphErrors,
      graphVersion: graph.version,
      traversalCovered: traversalSectors.has(def.id),
      visualCovered: visualSectors.has(def.id),
    })
  })

  const passed = districts.filter((c) => c.verdict === 'pass').length
  return {
    districts,
    totalDistricts: districts.length,
    passed,
    verdict: passed === districts.length ? 'pass' : 'fail',
  }
}

/** Certificate for one district id (debug panel / focused tests). */
export function certifyDistrictById(sectorId: string): DistrictCertificate | undefined {
  return certifyCity().districts.find((c) => c.sectorId === sectorId)
}
