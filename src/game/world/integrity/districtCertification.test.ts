import { describe, expect, it } from 'vitest'
import { SECTOR_DEFINITIONS } from '../sectors/sectorRegistry'
import type { OcclusionParityReport } from './occlusionParity'
import { MIN_OCCLUDER_HEIGHT } from './occlusionParity'
import type { PlacementReport } from './sectorPlacementReport'
import type { CompiledCrossIntersection, CompiledCrossing } from '../../traffic/intersections/crossIntersection'
import type { CompiledWalkCrossing } from '../authoring/authoringTypes'
import {
  type CertifiableDistrict,
  type DistrictEvidence,
  certifyCity,
  certifyDistrict,
  certifyDistrictById,
} from './districtCertification'

const cleanPlacement = (sectorId: string): PlacementReport => ({
  sectorId,
  failures: [],
  counts: { props: 2, citizens: 1, anchors: 0, solids: 3 },
})

/** Evidence in which every source is PRESENT and passing (s1_-1 has one tall,
 *  covered occluder + a generated traversal/visual frame). */
const goodEvidence = (over: Partial<DistrictEvidence> = {}): DistrictEvidence => ({
  occlusion: {
    sectors: [{ sectorId: 's1_-1', qualifying: 1, occludable: 1, optOuts: [], missing: [], pass: true }],
    totalQualifying: 1,
    totalOccludable: 1,
    totalMissing: 0,
    pass: true,
  },
  placement: cleanPlacement('s1_-1'),
  graphErrors: [],
  graphVersion: 1,
  traversalCovered: true,
  visualCovered: true,
  ...over,
})

const goodDistrict = (over: Partial<CertifiableDistrict> = {}): CertifiableDistrict => ({
  def: SECTOR_DEFINITIONS.find((d) => d.id === 's1_-1')!, // Main Street East
  buildings: [{ id: 'b1', position: [0, 0], size: [6, MIN_OCCLUDER_HEIGHT + 2, 6] }],
  props: [],
  citizens: [],
  surfaceKinds: new Set(['road', 'sidewalk']),
  ownedSegments: 4,
  intersections: [],
  destinations: 2,
  walkCrossings: [],
  hasCompiled: true,
  refErrors: [],
  backdrop: false,
  ...over,
})

/** Minimal compiled intersection — only the fields the signal check reads are
 *  meaningful; `signals:false` yields a MALFORMED plan (no phases/group). */
function intersection(opts: { signals?: boolean; crossings?: CompiledCrossing[] } = {}): CompiledCrossIntersection {
  const ok = opts.signals !== false
  return {
    id: 'x1',
    center: [50, -160],
    bounds: { minX: 45, maxX: 55, minZ: -165, maxZ: -155 },
    movements: [
      { id: 'm1', segmentId: 'seg1', approach: 'south', kind: 'straight', path: [], conflictGroupIds: [], signalGroupId: ok ? 'g_south' : '' },
    ],
    crossings: opts.crossings ?? [],
    stopLines: [],
    phases: ok ? ([{}] as never) : [],
    cycleLength: ok ? 30 : 0,
    approachSegments: {},
    signalPoles: [],
  }
}

const status = (cert: { checks: { name: string; status: string }[] }, name: string) =>
  cert.checks.find((c) => c.name === name)!.status

describe('certifyCity — the whole authored city certifies', () => {
  it('every district passes with zero errors', () => {
    const city = certifyCity()
    expect(city.totalDistricts).toBe(SECTOR_DEFINITIONS.length)
    expect(city.verdict).toBe('pass')
    const failing = city.districts.filter((d) => d.verdict === 'fail').map((d) => d.sectorId)
    expect(failing).toEqual([])
    for (const d of city.districts) expect(d.errors).toBe(0)
  })

  it('is deterministic (sector-def order, stable checks)', () => {
    const a = certifyCity()
    const b = certifyCity()
    expect(a.districts.map((d) => d.sectorId)).toEqual(b.districts.map((d) => d.sectorId))
    expect(a).toEqual(b)
  })

  it('every certificate carries the §11 matrix + machine-readable verdict', () => {
    const cert = certifyDistrictById('s1_-1')!
    const names = cert.checks.map((c) => c.name)
    for (const required of [
      'sector_identity',
      'sector_bounds',
      'streaming_ownership',
      'building_occlusion',
      'prop_visual_bounds',
      'prop_base_contact',
      'anchor_clearance',
      'duplicate_routes',
      'road_graph',
      'traffic_signals',
      'reference_integrity',
      'crosswalk_clearance',
      'lighting_night_hook',
      'weather_hook',
      'anomaly_probe_coverage',
      'traversal_coverage',
      'visual_coverage',
    ]) {
      expect(names).toContain(required)
    }
    expect(cert.version.sector).toBeGreaterThan(0)
    expect(['pass', 'fail']).toContain(cert.verdict)
  })

  it('the real city actually derives coverage — every non-backdrop district is swept', () => {
    // Guards finding #2: coverage is real, not a hard `skip`. A non-backdrop
    // district reporting NO traversal/anomaly coverage would fail here.
    for (const d of certifyCity().districts) {
      const tc = d.checks.find((c) => c.name === 'traversal_coverage')!
      if (tc.severity === 'error') expect(tc.status).toBe('pass')
    }
  })
})

describe('certifyDistrict — a clean district passes; each missing evidence source FAILS the right check', () => {
  it('a clean synthetic district passes', () => {
    const cert = certifyDistrict(goodDistrict(), goodEvidence())
    expect(cert.verdict).toBe('pass')
    expect(cert.errors).toBe(0)
  })

  it('a degenerate building footprint fails building_bounds + colliders', () => {
    const cert = certifyDistrict(goodDistrict({ buildings: [{ id: 'bad', position: [0, 0], size: [0, 8, 6] }] }), goodEvidence())
    expect(cert.verdict).toBe('fail')
    expect(status(cert, 'building_bounds')).toBe('fail')
    expect(status(cert, 'building_colliders')).toBe('fail')
  })

  // ---- finding #3: occlusion evidence must not default to pass ----
  it('a qualifying (tall) building with NO occlusion-report entry fails building_occlusion', () => {
    // Missing parity evidence (tall building, but the report never mentions this
    // sector — e.g. mis-attributed) must FAIL, not default to pass.
    const cert = certifyDistrict(
      goodDistrict(),
      goodEvidence({ occlusion: { sectors: [], totalQualifying: 0, totalOccludable: 0, totalMissing: 0, pass: true } }),
    )
    expect(status(cert, 'building_occlusion')).toBe('fail')
    expect(cert.verdict).toBe('fail')
  })

  it('a district with only SHORT buildings passes building_occlusion (nothing to fade)', () => {
    const cert = certifyDistrict(
      goodDistrict({ buildings: [{ id: 'lo', position: [0, 0], size: [6, MIN_OCCLUDER_HEIGHT - 1, 6] }] }),
      goodEvidence({ occlusion: { sectors: [], totalQualifying: 0, totalOccludable: 0, totalMissing: 0, pass: true } }),
    )
    expect(status(cert, 'building_occlusion')).toBe('pass')
  })

  it('a reported occlusion miss fails building_occlusion', () => {
    const occ: OcclusionParityReport = {
      sectors: [{ sectorId: 's1_-1', qualifying: 2, occludable: 1, optOuts: [], missing: ['b_tower'], pass: false }],
      totalQualifying: 2,
      totalOccludable: 1,
      totalMissing: 1,
      pass: false,
    }
    expect(status(certifyDistrict(goodDistrict(), goodEvidence({ occlusion: occ })), 'building_occlusion')).toBe('fail')
  })

  // ---- finding #2: generated coverage must be real ----
  it('a district the sweeper does NOT cover fails traversal_coverage + anomaly_probe_coverage', () => {
    const cert = certifyDistrict(goodDistrict(), goodEvidence({ traversalCovered: false }))
    expect(status(cert, 'traversal_coverage')).toBe('fail')
    expect(status(cert, 'anomaly_probe_coverage')).toBe('fail')
    expect(cert.verdict).toBe('fail')
  })

  it('a map-visible district with NO generated visual frame fails visual_coverage', () => {
    const cert = certifyDistrict(goodDistrict(), goodEvidence({ visualCovered: false }))
    // s1_-1 is map-visible → visual_coverage is an error gate.
    if (goodDistrict().def.map.showOnMap) {
      expect(status(cert, 'visual_coverage')).toBe('fail')
      expect(cert.verdict).toBe('fail')
    }
  })

  // ---- finding #1: previously hard-coded checks derive from real evidence ----
  it('a dangling destination reference fails reference_integrity', () => {
    const cert = certifyDistrict(
      goodDistrict({ refErrors: ['destination dest_x references missing segment seg_missing'] }),
      goodEvidence(),
    )
    expect(status(cert, 'reference_integrity')).toBe('fail')
    expect(cert.verdict).toBe('fail')
  })

  it('a malformed intersection signal plan fails traffic_signals', () => {
    const cert = certifyDistrict(goodDistrict({ intersections: [intersection({ signals: false })] }), goodEvidence())
    expect(status(cert, 'traffic_signals')).toBe('fail')
    expect(cert.verdict).toBe('fail')
  })

  it('a well-formed intersection passes traffic_signals; none authored → skip', () => {
    expect(status(certifyDistrict(goodDistrict({ intersections: [intersection()] }), goodEvidence()), 'traffic_signals')).toBe('pass')
    expect(status(certifyDistrict(goodDistrict(), goodEvidence()), 'traffic_signals')).toBe('skip')
  })

  it('a crosswalk wait-spot embedded in a solid fails crosswalk_clearance', () => {
    // A building at the origin; a wait-spot dropped inside its footprint.
    const crossing: CompiledWalkCrossing = {
      id: 'cw1',
      roadId: 'r1',
      center: [0, 0],
      halfExtents: [2.2, 11],
      waitSpots: [
        [0, 0], // inside b1 (position [0,0], size 6×N×6 → footprint [-3,3])
        [20, 20], // clear
      ],
    }
    const cert = certifyDistrict(goodDistrict({ walkCrossings: [crossing] }), goodEvidence())
    expect(status(cert, 'crosswalk_clearance')).toBe('fail')
    expect(cert.verdict).toBe('fail')
  })

  it('clear crosswalk wait-spots pass; none authored → skip', () => {
    const crossing: CompiledWalkCrossing = { id: 'cw1', roadId: 'r1', center: [30, 30], halfExtents: [2.2, 11], waitSpots: [[28, 30], [32, 30]] }
    expect(status(certifyDistrict(goodDistrict({ walkCrossings: [crossing] }), goodEvidence()), 'crosswalk_clearance')).toBe('pass')
    expect(status(certifyDistrict(goodDistrict(), goodEvidence()), 'crosswalk_clearance')).toBe('skip')
  })

  it('global lighting/weather hooks are honest SKIPS, never a fabricated pass', () => {
    const cert = certifyDistrict(goodDistrict(), goodEvidence())
    expect(status(cert, 'lighting_night_hook')).toBe('skip')
    expect(status(cert, 'weather_hook')).toBe('skip')
  })

  it('a placement clip fails prop_visual_bounds; a floating prop fails base_contact', () => {
    const clip: PlacementReport = {
      sectorId: 's1_-1',
      failures: [{ kind: 'prop_clipping', entityId: 'awn', otherId: 'b1', reason: 'clips', correction: 0.5 }],
      counts: { props: 1, citizens: 0, anchors: 0, solids: 1 },
    }
    expect(status(certifyDistrict(goodDistrict(), goodEvidence({ placement: clip })), 'prop_visual_bounds')).toBe('fail')
    const float: PlacementReport = {
      sectorId: 's1_-1',
      failures: [{ kind: 'prop_floating', entityId: 'lamp', reason: 'floats', correction: 2 }],
      counts: { props: 1, citizens: 0, anchors: 0, solids: 1 },
    }
    expect(status(certifyDistrict(goodDistrict(), goodEvidence({ placement: float })), 'prop_base_contact')).toBe('fail')
  })

  it('road-graph errors fail road_graph', () => {
    const cert = certifyDistrict(goodDistrict(), goodEvidence({ graphErrors: ['orphan segment x'] }))
    expect(status(cert, 'road_graph')).toBe('fail')
    expect(cert.verdict).toBe('fail')
  })
})
