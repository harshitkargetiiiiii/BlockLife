import { describe, expect, it } from 'vitest'
import { compileSectorAuthoringSpec, validateCompiledSectorContent } from './sectorAuthoring'
import { COMPILED_SECTORS } from './compiledSectors'
import { WATERFRONT_GATEWAY, WATERFRONT_GATEWAY_SPEC } from './sectors/waterfrontGateway'
import { MAIN_STREET_NORTH } from './sectors/mainStreetNorth'
import { RESIDENTIAL_EAST } from './sectors/residentialEast'
import { INDUSTRIAL_YARD } from './sectors/industrialYard'
import { worldToSectorId } from '../sectors/worldGrid'

/**
 * City Expansion Content Pack v1 — every compiled sector, validated the
 * same way, plus the expansion's specific geometry contracts.
 */

describe('all compiled sectors', () => {
  it('every sector passes compiled-content validation with zero errors', () => {
    for (const sector of COMPILED_SECTORS) {
      expect(validateCompiledSectorContent(sector), sector.sectorId).toEqual([])
    }
  })

  it('every compile is deterministic', () => {
    for (const sector of COMPILED_SECTORS) {
      const again = compileSectorAuthoringSpec(sector.spec)
      expect(again.buildings, sector.sectorId).toEqual(sector.buildings)
      expect(again.props, sector.sectorId).toEqual(sector.props)
      expect(again.citizens, sector.sectorId).toEqual(sector.citizens)
      expect(again.segmentSpecs, sector.sectorId).toEqual(sector.segmentSpecs)
      expect(again.destinations, sector.sectorId).toEqual(sector.destinations)
      expect(again.walls, sector.sectorId).toEqual(sector.walls)
      expect(again.waterRects, sector.sectorId).toEqual(sector.waterRects)
    }
  })

  it('generated ids are unique ACROSS sectors and all have source refs', () => {
    const all: string[] = []
    for (const sector of COMPILED_SECTORS) {
      for (const id of [
        ...sector.buildings.map((b) => b.id),
        ...sector.props.map((p) => p.id),
        ...sector.citizens.map((c) => c.id),
        ...sector.segmentSpecs.map((s) => s.id),
        ...sector.destinations.map((d) => d.id),
      ]) {
        all.push(id)
        expect(sector.sourceRefs.has(id), id).toBe(true)
      }
    }
    expect(new Set(all).size).toBe(all.length)
  })

  it('buildings and citizens land in their owning grid cell', () => {
    for (const sector of COMPILED_SECTORS) {
      for (const b of sector.buildings) {
        expect(worldToSectorId(b.position[0], b.position[1]), b.id).toBe(sector.sectorId)
      }
      for (const c of sector.citizens) {
        expect(worldToSectorId(c.position[0], c.position[1]), c.id).toBe(sector.sectorId)
      }
    }
  })

  it('every sector has a labeled map entry with road strips', () => {
    for (const sector of COMPILED_SECTORS) {
      expect(sector.map.label.length, sector.sectorId).toBeGreaterThan(0)
      expect(sector.map.roadStrips.length, sector.sectorId).toBeGreaterThan(0)
      expect(sector.map.labelAnchor).toHaveLength(2)
    }
  })
})

describe('expansion geometry contracts', () => {
  it('boulevard + drive are collinear continuations (auto node adjacency)', () => {
    const blvd = WATERFRONT_GATEWAY.segmentSpecs.filter((s) => s.roadId === 's0_-2_boulevard')
    const drive = WATERFRONT_GATEWAY.segmentSpecs.filter((s) => s.roadId === 's0_-2_drive')
    // Boulevard back lane ends exactly on gate_sb's start node.
    expect(blvd.find((s) => s.laneId === 'back')!.points[1]).toEqual([46, -96])
    // Drive forks from the boulevard's forward terminus and its back lane
    // ends exactly on the boulevard's back-lane start.
    expect(drive.find((s) => s.laneId === 'fwd')!.points[0]).toEqual([50, -232])
    expect(drive.find((s) => s.laneId === 'back')!.points[1]).toEqual([46, -232])
    // No merge arcs needed anywhere on the trunk.
    expect(WATERFRONT_GATEWAY.segmentSpecs.some((s) => s.laneId === 'join')).toBe(false)
  })

  it('main street north rejoins the drive; its back lane clears the drive lanes', () => {
    const segs = MAIN_STREET_NORTH.segmentSpecs
    expect(segs.find((s) => s.laneId === 'fwd')!.points[0]).toEqual([50, -300])
    const join = segs.find((s) => s.laneId === 'join')!
    expect(join.points[1]).toEqual([46, -300])
    // Back lane sits at z=-304, beyond the drive's terminus — never ON it.
    expect(segs.find((s) => s.laneId === 'back')!.points[0][1]).toBe(-304)
  })

  it('residential east is a collinear continuation of main street east', () => {
    const segs = RESIDENTIAL_EAST.segmentSpecs
    expect(segs.find((s) => s.laneId === 'fwd')!.points[0]).toEqual([118, -96])
    expect(segs.find((s) => s.laneId === 'back')!.points[1]).toEqual([118, -100])
    expect(segs.some((s) => s.laneId === 'join')).toBe(false)
  })

  it('industrial yard west spur uses forkGap: diverge arc + clear lanes', () => {
    const segs = INDUSTRIAL_YARD.segmentSpecs
    const fork = segs.find((s) => s.laneId === 'fork')!
    expect(fork.points).toEqual([
      [50, -232],
      [44, -232],
    ])
    // Lane pair starts west of the boulevard corridor (x <= 44).
    expect(segs.find((s) => s.laneId === 'fwd')!.points[0]).toEqual([44, -232])
    expect(segs.find((s) => s.laneId === 'back')!.points[1]).toEqual([44, -228])
    expect(segs.find((s) => s.laneId === 'join')!.points[1]).toEqual([46, -232])
  })

  it('waterfront water band is compiled, solid and south of all content', () => {
    expect(WATERFRONT_GATEWAY.waterRects).toHaveLength(1)
    const water = WATERFRONT_GATEWAY.waterRects[0]
    for (const b of WATERFRONT_GATEWAY.buildings) {
      expect(b.position[1]).toBeGreaterThan(water.maxZ)
    }
    for (const c of WATERFRONT_GATEWAY.citizens) {
      for (const wp of c.waypoints) expect(wp[1]).toBeGreaterThan(water.maxZ)
    }
    // The spec keeps the promenade between water and buildings.
    expect(WATERFRONT_GATEWAY_SPEC.plazas[0].minZ).toBeGreaterThanOrEqual(water.maxZ)
  })

  it('parked vehicle rows carry the zone rotation', () => {
    const cars = RESIDENTIAL_EAST.props.filter((p) => p.type === 'parked_car')
    const trucks = INDUSTRIAL_YARD.props.filter((p) => p.type === 'parked_truck')
    expect(cars.length).toBeGreaterThanOrEqual(1)
    expect(trucks.length).toBeGreaterThanOrEqual(1)
    for (const p of [...cars, ...trucks]) expect(p.rotationY).toBeCloseTo(Math.PI / 2)
  })

  it('citizen totals stay in budget (expansion 14 + polish sitters/queues/workers)', () => {
    const added = COMPILED_SECTORS.filter((s) => s.sectorId !== 's1_-1').reduce(
      (n, s) => n + s.citizens.length,
      0,
    )
    expect(added).toBeGreaterThanOrEqual(14)
    expect(added).toBeLessThanOrEqual(24)
  })
})
