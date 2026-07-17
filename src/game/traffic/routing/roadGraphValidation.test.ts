import { describe, expect, it } from 'vitest'
import { buildRoadGraph, getRoadGraph } from './roadGraphBuilder'
import { reachableFrom, validateRoadGraph } from './roadGraphValidation'

describe('road graph structure', () => {
  const graph = getRoadGraph()

  it('builds deterministically (same version, same counts)', () => {
    const a = buildRoadGraph()
    const b = buildRoadGraph()
    expect(a.version).toBe(b.version)
    expect(a.segments.size).toBe(b.segments.size)
    expect(a.edges.length).toBe(b.edges.length)
    expect([...a.adjacency.get('ring_in_n_a')!].map((e) => e.toSegmentId)).toEqual(
      [...b.adjacency.get('ring_in_n_a')!].map((e) => e.toSegmentId),
    )
  })

  it('passes the full static validation suite', () => {
    expect(validateRoadGraph(graph)).toEqual([])
  })

  it('has all eleven districts represented (six original + gateway + expansion pack)', () => {
    const districts = new Set([...graph.segments.values()].map((s) => s.districtId))
    expect(districts).toEqual(
      new Set([
        'central',
        'residential',
        'residential_west',
        'residential_south',
        'industrial',
        'industrial_north',
        'downtown_gateway',
        'waterfront_north',
        'downtown_north',
        'residential_east',
        'industrial_west',
      ]),
    )
  })

  it('junction movements carry explicit movement types', () => {
    for (const seg of graph.segments.values()) {
      if (seg.kind === 'junction') {
        expect(seg.movement, seg.id).toBeDefined()
        expect(seg.junctionId, seg.id).toBeDefined()
      }
    }
  })

  it('all-pairs district reachability holds', () => {
    const byDistrict = new Map<string, string[]>()
    for (const [id, seg] of graph.segments) {
      byDistrict.set(seg.districtId, [...(byDistrict.get(seg.districtId) ?? []), id])
    }
    for (const [fromDistrict, fromSegs] of byDistrict) {
      const reach = new Set<string>()
      for (const id of fromSegs) for (const r of reachableFrom(graph, id)) reach.add(r)
      for (const [toDistrict, toSegs] of byDistrict) {
        if (toDistrict === fromDistrict) continue
        expect(
          toSegs.some((t) => reach.has(t)),
          `${fromDistrict} → ${toDistrict}`,
        ).toBe(true)
      }
    }
  })

  it('named cross-district paths exist (central→freight, freight→south, west→market, …)', () => {
    const expectReach = (fromSeg: string, toSeg: string) => {
      expect(reachableFrom(graph, fromSeg).has(toSeg), `${fromSeg} → ${toSeg}`).toBe(true)
    }
    expectReach('ring_in_n_a', 'art_nb_a') // central → north freight
    expectReach('art_nb_a', 'rs_eb_b') // north freight → southside
    expectReach('rw_nb_b', 'ind_sb_b') // westside → market strip
    expectReach('res_eb_a', 'ring_in_e_a') // north residential → central
    expectReach('rs_eb_b', 'res_eb_a') // southside → north residential
  })

  it('one-way discipline: no edge reverses into oncoming travel', () => {
    // validateRoadGraph covers this; assert the specific wrong-way pairings
    // can never appear as edges (eastbound lane → westbound lane directly).
    const forbidden = [
      ['res_eb_a', 'res_wb_b'],
      ['ring_in_n_a', 'ring_out_n_b'],
      ['conn_n_nb', 'conn_n_sb'],
    ]
    for (const [from, to] of forbidden) {
      const edges = graph.adjacency.get(from) ?? []
      expect(edges.some((e) => e.toSegmentId === to), `${from} → ${to}`).toBe(false)
    }
  })

  it('every junction entry offers at least one legal exit', () => {
    for (const seg of graph.segments.values()) {
      const out = graph.adjacency.get(seg.id) ?? []
      expect(out.length, `${seg.id} has an exit`).toBeGreaterThan(0)
    }
  })

  it('spawn points and destinations are anchored to eligible lane segments', () => {
    for (const spawn of graph.spawnPoints.values()) {
      const seg = graph.segments.get(spawn.segmentId)!
      expect(seg.isSpawnEligible, spawn.id).toBe(true)
      expect(seg.kind).toBe('lane')
    }
    for (const dest of graph.destinations.values()) {
      const seg = graph.segments.get(dest.segmentId)!
      expect(seg.kind, dest.id).toBe('lane')
    }
  })

  it('destination catalog spans all eleven districts', () => {
    const districts = new Set([...graph.destinations.values()].map((d) => d.districtId))
    expect(districts.size).toBe(11)
  })

  it('graph version is stable across builds (id/geometry freeze)', () => {
    // Intentional geometry edits will change this snapshot — that is the
    // point: accidental drift must be a visible, reviewed diff.
    expect(buildRoadGraph().version).toBe(getRoadGraph().version)
    expect(getRoadGraph().version).toMatchSnapshot()
  })
})
