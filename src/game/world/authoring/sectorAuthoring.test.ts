import { describe, expect, it } from 'vitest'
import { compileSectorAuthoringSpec, validateCompiledSectorContent } from './sectorAuthoring'
import { MAIN_STREET_EAST, MAIN_STREET_EAST_SPEC } from './sectors/mainStreetEast'
import {
  BUILDING_TEMPLATES,
  CITIZEN_ZONE_TEMPLATES,
  LOT_TEMPLATES,
  PROP_SCATTER_TEMPLATES,
  ROAD_TEMPLATES,
} from './templates'
import { worldToSectorId } from '../sectors/worldGrid'
import { getRoadGraph } from '../../traffic/routing/roadGraphBuilder'
import { validateRoadGraph } from '../../traffic/routing/roadGraphValidation'
import { PROP_SOLIDITY } from '../solidFootprints'

describe('template catalog', () => {
  it('templates are internally consistent', () => {
    for (const t of ROAD_TEMPLATES) {
      expect(t.width).toBeGreaterThan(t.laneOffset * 2)
      expect(t.defaultSpeedLimit).toBeGreaterThan(0)
    }
    for (const t of LOT_TEMPLATES) {
      for (const buildingId of t.allowedBuildings) {
        const building = BUILDING_TEMPLATES.find((b) => b.id === buildingId)
        expect(building, `${t.id} allows unknown building ${buildingId}`).toBeDefined()
        // The building must FIT the lot: frontage and depth cover footprint + setback.
        expect(building!.size[0]).toBeLessThanOrEqual(t.frontage)
        expect(building!.size[2] + t.setback).toBeLessThanOrEqual(t.depth)
      }
    }
    for (const t of PROP_SCATTER_TEMPLATES) {
      for (const prop of t.props) {
        expect(
          PROP_SOLIDITY[prop.type as keyof typeof PROP_SOLIDITY],
          `${t.id} references unknown prop type ${prop.type}`,
        ).toBeDefined()
      }
    }
    expect(CITIZEN_ZONE_TEMPLATES.length).toBeGreaterThan(0)
  })
})

describe('compile determinism', () => {
  it('compiling the same spec twice produces identical output', () => {
    const a = compileSectorAuthoringSpec(MAIN_STREET_EAST_SPEC)
    const b = compileSectorAuthoringSpec(MAIN_STREET_EAST_SPEC)
    expect(a.buildings).toEqual(b.buildings)
    expect(a.props).toEqual(b.props)
    expect(a.citizens).toEqual(b.citizens)
    expect(a.segmentSpecs).toEqual(b.segmentSpecs)
    expect(a.destinations).toEqual(b.destinations)
    expect(a.walls).toEqual(b.walls)
  })

  it('generated ids are unique, stable and sector-prefixed', () => {
    const ids = [
      ...MAIN_STREET_EAST.buildings.map((b) => b.id),
      ...MAIN_STREET_EAST.props.map((p) => p.id),
      ...MAIN_STREET_EAST.citizens.map((c) => c.id),
      ...MAIN_STREET_EAST.segmentSpecs.map((s) => s.id),
    ]
    expect(new Set(ids).size).toBe(ids.length)
    for (const id of ids) expect(id.startsWith('s1_-1_')).toBe(true)
  })

  it('every generated entity has an authoring source ref', () => {
    for (const b of MAIN_STREET_EAST.buildings) {
      expect(MAIN_STREET_EAST.sourceRefs.get(b.id)).toBeDefined()
    }
    for (const p of MAIN_STREET_EAST.props) {
      expect(MAIN_STREET_EAST.sourceRefs.get(p.id)).toBeDefined()
    }
    const ref = MAIN_STREET_EAST.sourceRefs.get(MAIN_STREET_EAST.buildings[0].id)!
    expect(ref.sectorId).toBe('s1_-1')
    expect(ref.templateId.length).toBeGreaterThan(0)
  })
})

describe('proof sector placement validation', () => {
  it('passes the full compiled-content validation with zero errors', () => {
    expect(validateCompiledSectorContent(MAIN_STREET_EAST)).toEqual([])
  })

  it('buildings land in the owning cell with road-facing doors', () => {
    for (const building of MAIN_STREET_EAST.buildings) {
      expect(worldToSectorId(building.position[0], building.position[1])).toBe('s1_-1')
      expect(building.door).toBeDefined()
    }
    expect(MAIN_STREET_EAST.buildings).toHaveLength(5)
  })

  it('scatter respects density and spacing', () => {
    expect(MAIN_STREET_EAST.props.length).toBeGreaterThanOrEqual(8)
    expect(MAIN_STREET_EAST.props.length).toBeLessThanOrEqual(34) // polish pass: front details + van + east walk zone
    // Spacing applies to SCATTER zones; fixed props (front details, lines,
    // placed singles) are deliberate close placements.
    const scattered = MAIN_STREET_EAST.props.filter((p) => {
      const t = MAIN_STREET_EAST.sourceRefs.get(p.id)!.templateId
      return !t.startsWith('front_detail:') && t !== 'line_props' && t !== 'placed_prop'
    })
    for (const a of scattered) {
      for (const b of scattered) {
        if (a.id >= b.id) continue
        const sameZone =
          MAIN_STREET_EAST.sourceRefs.get(a.id)!.localId ===
          MAIN_STREET_EAST.sourceRefs.get(b.id)!.localId
        if (sameZone) {
          expect(
            Math.hypot(a.position[0] - b.position[0], a.position[1] - b.position[1]),
          ).toBeGreaterThanOrEqual(2.9)
        }
      }
    }
  })

  it('validation errors are human-readable (negative case)', () => {
    const broken = compileSectorAuthoringSpec({
      ...MAIN_STREET_EAST_SPEC,
      lots: [
        ...MAIN_STREET_EAST_SPEC.lots,
        // A second tower on the same frontage slot — must collide.
        { ...MAIN_STREET_EAST_SPEC.lots[0], localId: 'clash', at: MAIN_STREET_EAST_SPEC.lots[0].at + 0.02 },
      ],
    })
    const errors = validateCompiledSectorContent(broken)
    expect(errors.length).toBeGreaterThan(0)
    expect(errors[0]).toMatch(/overlaps/)
    expect(errors[0]).toMatch(/template/)
  })
})

describe('expansion kit features', () => {
  /** Minimal synthetic spec exercising water/freeLots/forkGap/rotation. */
  const FEATURE_SPEC = {
    sectorId: 's1_-1' as const,
    name: 'Feature Probe',
    districtIds: ['downtown_gateway'],
    archetype: 'waterfront' as const,
    area: { minX: 74, maxX: 126, minZ: -140, maxZ: -76 },
    wallOpenings: [],
    roads: [
      {
        localId: 'spur',
        templateId: 'avenue_two_way',
        from: [50, -96] as [number, number],
        to: [118, -96] as [number, number],
        forkGap: 6,
        districtId: 'downtown_gateway',
      },
    ],
    lots: [],
    freeLots: [
      {
        localId: 'pavilion',
        buildingTemplateId: 'kiosk_pavilion',
        position: [100, -130] as [number, number],
        facing: 'north' as const,
        label: 'Probe Pavilion',
      },
    ],
    propZones: [
      {
        localId: 'row',
        templateId: 'driveway_parking',
        bounds: { minX: 80, maxX: 116, minZ: -136, maxZ: -128 },
        seed: 'probe-row-v1',
        rotation: Math.PI / 2,
      },
    ],
    citizenZones: [],
    traffic: [],
    plazas: [],
    water: [{ minX: 74, maxX: 126, minZ: -140, maxZ: -138 }],
    greenbelts: [{ minX: 40, maxX: 60, minZ: -140, maxZ: -120 }],
    map: { label: 'Probe', labelAnchor: [100, -110] as [number, number] },
  }

  it('forkGap emits a diverge arc from the fork node to the offset lane', () => {
    const compiled = compileSectorAuthoringSpec(FEATURE_SPEC)
    const fork = compiled.segmentSpecs.find((s) => s.laneId === 'fork')!
    expect(fork.kind).toBe('junction')
    expect(fork.movement).toBe('diverge')
    expect(fork.points).toEqual([
      [50, -96],
      [56, -96],
    ])
    const fwd = compiled.segmentSpecs.find((s) => s.laneId === 'fwd')!
    expect(fwd.points[0]).toEqual([56, -96])
    // Asphalt still covers the fork stub; junction box exists for the arc.
    const rect = compiled.roadRects[0]
    expect(rect.minX).toBeLessThanOrEqual(50)
    expect(compiled.junctionBoxes[`${fork.junctionId}`]).toBeDefined()
  })

  it('free lots compile template buildings with explicit facing + source refs', () => {
    const compiled = compileSectorAuthoringSpec(FEATURE_SPEC)
    const pavilion = compiled.buildings.find((b) => b.id === 's1_-1_pavilion')!
    expect(pavilion.door).toBe('north')
    expect(pavilion.label).toBe('Probe Pavilion')
    expect(compiled.sourceRefs.get(pavilion.id)!.templateId).toBe('kiosk_pavilion')
  })

  it('water compiles surfaces + solid rects; scatter and validation avoid it', () => {
    const compiled = compileSectorAuthoringSpec(FEATURE_SPEC)
    expect(compiled.waterRects).toHaveLength(1)
    expect(compiled.surfaces.some((s) => s.kind === 'water')).toBe(true)
    expect(compiled.map.waterStrips).toHaveLength(1)
    expect(validateCompiledSectorContent(compiled)).toEqual([])
    // Negative: a citizen route across the water band must fail validation.
    const drowned = compileSectorAuthoringSpec({
      ...FEATURE_SPEC,
      citizenZones: [
        {
          localId: 'swimmers',
          templateId: 'sidewalk_walkers',
          points: [
            [90, -132],
            [90, -139],
          ] as [number, number][],
        },
      ],
    })
    const errors = validateCompiledSectorContent(drowned)
    expect(errors.some((e) => /water/.test(e))).toBe(true)
  })

  it('zone rotation applies to every prop; greenbelts render as grass', () => {
    const compiled = compileSectorAuthoringSpec(FEATURE_SPEC)
    const rowProps = compiled.props.filter((p) => p.id.startsWith('s1_-1_row_'))
    expect(rowProps.length).toBeGreaterThan(0)
    for (const p of rowProps) expect(p.rotationY).toBeCloseTo(Math.PI / 2)
    expect(compiled.surfaces.some((s) => s.id === 's1_-1_greenbelt_0')).toBe(true)
    expect(compiled.map.labelAnchor).toEqual([100, -110])
  })
})

describe('polish kit features', () => {
  const POLISH_SPEC = {
    ...MAIN_STREET_EAST_SPEC,
    lots: MAIN_STREET_EAST_SPEC.lots.map((l) =>
      l.localId === 'n2' || l.localId === 's1' ? { ...l, details: true } : l,
    ),
    linePropZones: [
      {
        localId: 'rail',
        type: 'bollard',
        from: [100, -118] as [number, number],
        to: [120, -118] as [number, number],
        spacing: 2.5,
      },
    ],
    placedProps: [
      {
        localId: 'van',
        type: 'parked_truck',
        position: [78, -120] as [number, number],
        rotation: Math.PI / 2,
      },
    ],
    map: {
      ...MAIN_STREET_EAST_SPEC.map,
      landmarks: [
        { localId: 'mart', label: 'Main St Mart', icon: '🛒', position: [90, -90] as [number, number] },
      ],
    },
  }

  it('line props are evenly spaced with source refs; ends land exactly', () => {
    const compiled = compileSectorAuthoringSpec(POLISH_SPEC)
    const rail = compiled.props.filter((p) => p.id.startsWith('s1_-1_rail_'))
    expect(rail.length).toBe(9) // 20u / 2.5 spacing → 9 posts
    expect(rail[0].position).toEqual([100, -118])
    expect(rail[rail.length - 1].position).toEqual([120, -118])
    for (const p of rail) expect(compiled.sourceRefs.get(p.id)!.templateId).toBe('line_props')
  })

  it('placed props compile with rotation and validate like any prop', () => {
    const compiled = compileSectorAuthoringSpec(POLISH_SPEC)
    const van = compiled.props.find((p) => p.id === 's1_-1_van')!
    expect(van.type).toBe('parked_truck')
    expect(van.rotationY).toBeCloseTo(Math.PI / 2)
    expect(validateCompiledSectorContent(compiled)).toEqual([])
  })

  it('front details attach door-side per policy, clear of the building box', () => {
    const compiled = compileSectorAuthoringSpec(POLISH_SPEC)
    const details = compiled.props.filter((p) => p.id.includes('_front_'))
    // All five MSE lots carry details since the polish pass:
    // 2 towers (2 each) + cafe (2 tables) + shop (2) + townhouse (2).
    expect(details.length).toBe(10)
    for (const detail of details) {
      const owner = compiled.buildings.find((b) =>
        detail.id.startsWith(`${b.id}_front_`),
      )!
      const box = {
        minX: owner.position[0] - owner.size[0] / 2,
        maxX: owner.position[0] + owner.size[0] / 2,
        minZ: owner.position[1] - owner.size[2] / 2,
        maxZ: owner.position[1] + owner.size[2] / 2,
      }
      const inside =
        detail.position[0] > box.minX &&
        detail.position[0] < box.maxX &&
        detail.position[1] > box.minZ &&
        detail.position[1] < box.maxZ
      expect(inside, detail.id).toBe(false)
      expect(compiled.sourceRefs.get(detail.id)!.templateId).toMatch(/^front_detail:/)
    }
  })

  it('seeded scatter keeps clear of fixed props; compile stays deterministic', () => {
    const a = compileSectorAuthoringSpec(POLISH_SPEC)
    const b = compileSectorAuthoringSpec(POLISH_SPEC)
    expect(a.props).toEqual(b.props)
    const fixed = a.props.filter(
      (p) => p.id.includes('_rail_') || p.id === 's1_-1_van' || p.id.includes('_front_'),
    )
    const scattered = a.props.filter((p) => !fixed.includes(p))
    for (const s of scattered) {
      for (const f of fixed) {
        expect(
          Math.hypot(s.position[0] - f.position[0], s.position[1] - f.position[1]),
          `${s.id} vs ${f.id}`,
        ).toBeGreaterThan(0.5)
      }
    }
  })

  it('map landmarks compile with sector-prefixed ids', () => {
    const compiled = compileSectorAuthoringSpec(POLISH_SPEC)
    expect(compiled.map.landmarks).toEqual([
      { id: 's1_-1_lm_mart', label: 'Main St Mart', icon: '🛒', position: [90, -90] },
    ])
  })
})

describe('graph integration', () => {
  it('compiled segments joined the global graph and pass full validation', () => {
    const graph = getRoadGraph()
    expect(graph.segments.has('s1_-1_main_st_fwd')).toBe(true)
    expect(graph.segments.has('s1_-1_main_st_back')).toBe(true)
    expect(validateRoadGraph(graph)).toEqual([])
    // Fork + rejoin by exact node adjacency.
    const fromGate = graph.adjacency.get('gate_nb') ?? []
    expect(fromGate.some((e) => e.toSegmentId === 's1_-1_main_st_fwd')).toBe(true)
    const join = graph.adjacency.get('s1_-1_main_st_join') ?? []
    expect(join.some((e) => e.toSegmentId === 'gate_sb')).toBe(true)
  })

  it('compiled destination is registered and reachable', () => {
    const graph = getRoadGraph()
    expect(graph.destinations.has('dest_s1_-1_main_row')).toBe(true)
  })
})
