import { describe, expect, it } from 'vitest'
import type { EntityDescriptor } from './entityTypes'
import {
  AnomalyTracker,
  circleAabbDepth,
  circleOrientedDepth,
  orientedBoxesOverlap,
  scanOccupancyAnomalies,
  scanTrafficAnomalies,
} from './anomalyDetector'
import type { RawAnomaly } from './anomalyTypes'

function person(id: string, x: number, z: number): EntityDescriptor {
  return { id, kind: 'ambient_citizen', sectorId: 's', x, z, radius: 0.35, capabilities: ['occupancy'] }
}
function officer(id: string, x: number, z: number): EntityDescriptor {
  return { id, kind: 'police_officer', sectorId: 's', x, z, radius: 0.35, capabilities: ['occupancy'] }
}
function vehicle(id: string, x: number, z: number, headingY = 0): EntityDescriptor {
  return {
    id,
    kind: 'ambient_vehicle',
    sectorId: 's',
    x,
    z,
    oriented: { x, z, halfLength: 2, halfWidth: 1, headingY },
    capabilities: ['solid', 'occupancy'],
  }
}
function building(id: string, minX: number, maxX: number, minZ: number, maxZ: number): EntityDescriptor {
  return {
    id,
    kind: 'building',
    sectorId: 's',
    x: (minX + maxX) / 2,
    z: (minZ + maxZ) / 2,
    footprint: { minX, maxX, minZ, maxZ },
    capabilities: ['solid', 'occupancy'],
  }
}

describe('anomaly geometry', () => {
  it('measures circle-in-AABB depth', () => {
    expect(circleAabbDepth(5, 5, 0.35, { minX: -1, maxX: 1, minZ: -1, maxZ: 1 })).toBe(0)
    expect(circleAabbDepth(1.2, 0, 0.35, { minX: -1, maxX: 1, minZ: -1, maxZ: 1 })).toBeCloseTo(0.15, 5)
  })

  it('measures circle-in-oriented-box depth', () => {
    expect(circleOrientedDepth(1.1, 0, 0.35, { x: 0, z: 0, halfLength: 2, halfWidth: 1, headingY: 0 })).toBeCloseTo(0.25, 5)
  })

  it('SAT: overlapping and separated oriented boxes', () => {
    const a = { x: 0, z: 0, halfLength: 2, halfWidth: 1, headingY: 0 }
    expect(orientedBoxesOverlap(a, { ...a, x: 1 })).toBe(true)
    expect(orientedBoxesOverlap(a, { ...a, x: 10 })).toBe(false)
  })
})

describe('scanOccupancyAnomalies', () => {
  it('finds a person-person overlap once per pair', () => {
    const raw = scanOccupancyAnomalies([person('p1', 0, 0), person('p2', 0.4, 0)])
    expect(raw).toHaveLength(1)
    expect(raw[0].type).toBe('person_person_overlap')
    expect(raw[0].entityIds).toEqual(['p1', 'p2'])
  })

  it('tolerates a graze but flags material overlap', () => {
    // radii sum 0.7; at 0.66 apart depth = 0.04 < tol(0.08) → ignored
    expect(scanOccupancyAnomalies([person('a', 0, 0), person('b', 0.66, 0)])).toHaveLength(0)
    // at 0.5 apart depth = 0.2 → flagged
    expect(scanOccupancyAnomalies([person('a', 0, 0), person('b', 0.5, 0)])).toHaveLength(1)
  })

  it('flags a police officer overlapping a civilian (police is a person kind)', () => {
    // Regression: a dismounted officer standing on a citizen must surface as a
    // person↔person overlap so it can never sit silently unresolved.
    const raw = scanOccupancyAnomalies([officer('cop_1', 0, 0), person('cit_9', 0.4, 0)])
    expect(raw).toHaveLength(1)
    expect(raw[0].type).toBe('person_person_overlap')
    expect(raw[0].entityIds).toContain('cop_1')
    expect(raw[0].entityIds).toContain('cit_9')
  })

  it('finds a person standing inside a vehicle footprint', () => {
    const raw = scanOccupancyAnomalies([person('p', 0, 0), vehicle('v', 0, 0)])
    expect(raw.map((r) => r.type)).toContain('person_vehicle_overlap')
  })

  it('finds a person embedded in a building', () => {
    const raw = scanOccupancyAnomalies([person('p', 0, 0), building('b', -1, 1, -1, 1)])
    expect(raw.map((r) => r.type)).toContain('person_solid_overlap')
  })

  it('finds overlapping vehicles', () => {
    const raw = scanOccupancyAnomalies([vehicle('v1', 0, 0), vehicle('v2', 1, 0)])
    expect(raw.map((r) => r.type)).toContain('vehicle_vehicle_overlap')
  })

  it('reports a clean scene as anomaly-free', () => {
    expect(scanOccupancyAnomalies([person('p', 0, 0), vehicle('v', 20, 20), building('b', 40, 42, 40, 42)])).toEqual([])
  })
})

describe('scanTrafficAnomalies (endless blocked / honk-loop diagnosis)', () => {
  const car = (id: string, blockedTime: number, reason = 'obstacle') => ({ id, x: 1, z: 2, blockedTime, reason })

  it('ignores a car briefly blocked (below the stall threshold)', () => {
    // A normal wait behind a crossing citizen — blockedTime resets on signal/queue
    // waits, so anything under the stall threshold is routine, not a pileup.
    expect(scanTrafficAnomalies([car('c1', 3)])).toEqual([])
  })

  it('flags a car stalled behind a road-blocker past the threshold', () => {
    const raw = scanTrafficAnomalies([car('c1', 12)])
    expect(raw).toHaveLength(1)
    expect(raw[0].type).toBe('traffic_blocked')
    expect(raw[0].entityIds).toEqual(['c1'])
    expect(raw[0].depth).toBe(12)
    expect(raw[0].detail).toBe('obstacle')
  })

  it('escalates to honk_loop ALONGSIDE the stall once stuck long enough', () => {
    const raw = scanTrafficAnomalies([car('c1', 25)])
    const types = raw.map((r) => r.type)
    expect(types).toContain('traffic_blocked') // stall record stays present…
    expect(types).toContain('honk_loop') // …with the loop layered on top
    expect(raw).toHaveLength(2)
  })

  it('only flags the stuck cars in a mixed fleet', () => {
    const raw = scanTrafficAnomalies([car('moving', 0), car('stuck', 15), car('cruising', 1)])
    expect(raw.map((r) => r.entityIds[0])).toEqual(['stuck'])
  })

  it('respects custom thresholds', () => {
    expect(scanTrafficAnomalies([car('c1', 6)], { blockedStallSeconds: 5 })).toHaveLength(1)
    expect(scanTrafficAnomalies([car('c1', 6)], { blockedStallSeconds: 8 })).toHaveLength(0)
  })
})

describe('AnomalyTracker', () => {
  const overlap: RawAnomaly = {
    type: 'person_person_overlap',
    severity: 'error',
    entityIds: ['p1', 'p2'],
    sectorId: 's',
    depth: 0.2,
  }

  it('separates transient contact from sustained corruption', () => {
    const t = new AnomalyTracker()
    for (let i = 0; i < 5; i++) t.ingest([overlap])
    expect(t.getActive()).toHaveLength(1)
    expect(t.getSustained(8)).toHaveLength(0) // only 5 ticks
    for (let i = 0; i < 5; i++) t.ingest([overlap])
    expect(t.getSustained(8)).toHaveLength(1) // now 10 consecutive
  })

  it('drops a record the tick its overlap resolves', () => {
    const t = new AnomalyTracker()
    t.ingest([overlap])
    expect(t.getActive()).toHaveLength(1)
    t.ingest([]) // resolved
    expect(t.getActive()).toHaveLength(0)
  })

  it('resets consecutive duration after a gap', () => {
    const t = new AnomalyTracker()
    t.ingest([overlap])
    t.ingest([overlap]) // duration 2
    t.ingest([]) // resolved, dropped
    t.ingest([overlap]) // fresh
    expect(t.getActive()[0].durationTicks).toBe(1)
  })

  it('dedupes identical anomalies within one ingest', () => {
    const t = new AnomalyTracker()
    t.ingest([overlap, { ...overlap, entityIds: ['p2', 'p1'] }]) // same pair, reversed
    expect(t.getActive()).toHaveLength(1)
  })

  it('clears cleanly', () => {
    const t = new AnomalyTracker()
    t.ingest([overlap])
    t.clear()
    expect(t.getActive()).toHaveLength(0)
    expect(t.tickCount).toBe(0)
  })
})
