import { describe, expect, it } from 'vitest'
import { SECTOR_DEFINITIONS } from '../sectors/sectorRegistry'
import type { OcclusionParityReport } from './occlusionParity'
import type { PlacementReport } from './sectorPlacementReport'
import {
  type CertifiableDistrict,
  certifyCity,
  certifyDistrict,
  certifyDistrictById,
} from './districtCertification'

const CLEAN_OCCLUSION: OcclusionParityReport = {
  sectors: [],
  totalQualifying: 0,
  totalOccludable: 0,
  totalMissing: 0,
  pass: true,
}
const cleanPlacement = (sectorId: string): PlacementReport => ({
  sectorId,
  failures: [],
  counts: { props: 2, citizens: 1, anchors: 0, solids: 3 },
})
const goodDistrict = (): CertifiableDistrict => ({
  def: SECTOR_DEFINITIONS.find((d) => d.id === 's1_-1')!, // Main Street East
  buildings: [{ id: 'b1', position: [0, 0], size: [6, 8, 6] }],
  props: [],
  citizens: [],
  surfaceKinds: new Set(['road', 'sidewalk']),
  ownedSegments: 4,
  intersections: 1,
  destinations: 2,
  walkCrossings: 1,
  backdrop: false,
})

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
      'anomaly_probe_coverage',
      'traversal_coverage',
    ]) {
      expect(names).toContain(required)
    }
    expect(cert.version.sector).toBeGreaterThan(0)
    expect(['pass', 'fail']).toContain(cert.verdict)
  })
})

describe('certifyDistrict — fail paths (a broken district fails the right check)', () => {
  it('a clean synthetic district passes', () => {
    const cert = certifyDistrict(goodDistrict(), CLEAN_OCCLUSION, cleanPlacement('s1_-1'), [], 1)
    expect(cert.verdict).toBe('pass')
    expect(cert.errors).toBe(0)
  })

  it('a degenerate building footprint fails building_bounds + colliders', () => {
    const d = goodDistrict()
    d.buildings = [{ id: 'bad', position: [0, 0], size: [0, 8, 6] }]
    const cert = certifyDistrict(d, CLEAN_OCCLUSION, cleanPlacement('s1_-1'), [], 1)
    expect(cert.verdict).toBe('fail')
    expect(cert.checks.find((c) => c.name === 'building_bounds')!.status).toBe('fail')
    expect(cert.checks.find((c) => c.name === 'building_colliders')!.status).toBe('fail')
  })

  it('a qualifying building without occlusion fails building_occlusion', () => {
    const occ: OcclusionParityReport = {
      sectors: [{ sectorId: 's1_-1', qualifying: 2, occludable: 1, optOuts: [], missing: ['b_tower'], pass: false }],
      totalQualifying: 2,
      totalOccludable: 1,
      totalMissing: 1,
      pass: false,
    }
    const cert = certifyDistrict(goodDistrict(), occ, cleanPlacement('s1_-1'), [], 1)
    expect(cert.verdict).toBe('fail')
    expect(cert.checks.find((c) => c.name === 'building_occlusion')!.status).toBe('fail')
  })

  it('a placement clip fails prop_visual_bounds; a floating prop fails base_contact', () => {
    const clip: PlacementReport = {
      sectorId: 's1_-1',
      failures: [{ kind: 'prop_clipping', entityId: 'awn', otherId: 'b1', reason: 'clips', correction: 0.5 }],
      counts: { props: 1, citizens: 0, anchors: 0, solids: 1 },
    }
    expect(certifyDistrict(goodDistrict(), CLEAN_OCCLUSION, clip, [], 1).checks.find((c) => c.name === 'prop_visual_bounds')!.status).toBe('fail')
    const float: PlacementReport = {
      sectorId: 's1_-1',
      failures: [{ kind: 'prop_floating', entityId: 'lamp', reason: 'floats', correction: 2 }],
      counts: { props: 1, citizens: 0, anchors: 0, solids: 1 },
    }
    expect(certifyDistrict(goodDistrict(), CLEAN_OCCLUSION, float, [], 1).checks.find((c) => c.name === 'prop_base_contact')!.status).toBe('fail')
  })

  it('road-graph errors fail road_graph', () => {
    const cert = certifyDistrict(goodDistrict(), CLEAN_OCCLUSION, cleanPlacement('s1_-1'), ['orphan segment x'], 1)
    expect(cert.checks.find((c) => c.name === 'road_graph')!.status).toBe('fail')
    expect(cert.verdict).toBe('fail')
  })
})
