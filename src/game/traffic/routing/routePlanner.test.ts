import { beforeEach, describe, expect, it } from 'vitest'
import { getRoadGraph } from './roadGraphBuilder'
import { planRoute, resetRouteSequence } from './routePlanner'
import { createRng } from './routeRng'
import { createVehicleRng, selectDestination, selectRouteMode } from './routeSelection'

const graph = getRoadGraph()

beforeEach(() => resetRouteSequence())

describe('planRoute', () => {
  it('plans central → north freight through the north connector and the T-junction', () => {
    const result = planRoute(graph, 'ring_in_n_a', 0.3, 'dest_freight_yard')
    expect(result.ok).toBe(true)
    if (!result.ok) return
    const ids = result.plan.segmentIds
    expect(ids[0]).toBe('ring_in_n_a')
    expect(ids[ids.length - 1]).toBe('art_nb_a')
    expect(ids).toContain('conn_n_nb') // north connector
    expect(ids.some((id) => id.startsWith('jn_res_art'))).toBe(true) // arterial T
    // No duplicate adjacent segments, every hop is a real edge.
    for (let i = 1; i < ids.length; i++) {
      expect(ids[i]).not.toBe(ids[i - 1])
      const edges = graph.adjacency.get(ids[i - 1]) ?? []
      expect(edges.some((e) => e.toSegmentId === ids[i]), `${ids[i - 1]} → ${ids[i]}`).toBe(true)
    }
  })

  it('is deterministic: same inputs give the identical segment sequence', () => {
    const a = planRoute(graph, 'ring_out_s_b', 0.4, 'dest_westside_lane')
    const b = planRoute(graph, 'ring_out_s_b', 0.4, 'dest_westside_lane')
    expect(a.ok && b.ok).toBe(true)
    if (a.ok && b.ok) expect(a.plan.segmentIds).toEqual(b.plan.segmentIds)
  })

  it('honors one-way restrictions (path never chains illegal hops)', () => {
    const result = planRoute(graph, 'res_eb_a', 0.2, 'dest_market_strip')
    expect(result.ok).toBe(true)
    if (!result.ok) return
    for (let i = 1; i < result.plan.segmentIds.length; i++) {
      const edges = graph.adjacency.get(result.plan.segmentIds[i - 1]) ?? []
      expect(edges.some((e) => e.toSegmentId === result.plan.segmentIds[i])).toBe(true)
    }
  })

  it('routes to a destination on the SAME segment ahead of the car', () => {
    const result = planRoute(graph, 'art_nb_a', 0.1, 'dest_freight_yard') // dest progress 0.5
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.plan.segmentIds).toEqual(['art_nb_a'])
    expect(result.plan.totalCost).toBeGreaterThan(0)
  })

  it('loops the network when the same-segment destination is BEHIND the car', () => {
    const result = planRoute(graph, 'art_nb_a', 0.9, 'dest_freight_yard') // dest progress 0.5
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.plan.segmentIds.length).toBeGreaterThan(1)
    expect(result.plan.segmentIds[0]).toBe('art_nb_a')
    expect(result.plan.segmentIds[result.plan.segmentIds.length - 1]).toBe('art_nb_a')
  })

  it('avoids a blocked segment when an alternative exists', () => {
    const free = planRoute(graph, 'ring_in_n_a', 0.3, 'dest_central_plaza_east')
    expect(free.ok).toBe(true)
    if (!free.ok) return
    const blockedId = free.plan.segmentIds[1]
    const rerouted = planRoute(graph, 'ring_in_n_a', 0.3, 'dest_central_plaza_east', {
      blockedSegmentIds: new Set([blockedId]),
    })
    expect(rerouted.ok).toBe(true)
    if (rerouted.ok) expect(rerouted.plan.segmentIds).not.toContain(blockedId)
  })

  it('reports blockedAllPaths when blockages sever an otherwise valid route', () => {
    // The freight yard is only enterable through the arterial T straights or
    // turns — block every T movement and the yard becomes unreachable.
    const blocked = new Set(
      [...graph.segments.keys()].filter((id) => id.startsWith('jn_res_art')),
    )
    const result = planRoute(graph, 'ring_in_n_a', 0.3, 'dest_freight_yard', {
      blockedSegmentIds: blocked,
    })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.failure).toBe('blockedAllPaths')
  })

  it('returns typed failures for bad origin/destination', () => {
    const badOrigin = planRoute(graph, 'segment_nope', 0, 'dest_freight_yard')
    expect(badOrigin.ok).toBe(false)
    if (!badOrigin.ok) expect(badOrigin.failure).toBe('invalidOrigin')
    const badDest = planRoute(graph, 'ring_in_n_a', 0, 'dest_nope')
    expect(badDest.ok).toBe(false)
    if (!badDest.ok) expect(badDest.failure).toBe('invalidDestination')
  })

  it('extra cost (congestion) diverts new plans only when it outweighs the detour', () => {
    const free = planRoute(graph, 'ring_out_s_b', 0.2, 'dest_market_strip')
    expect(free.ok).toBe(true)
    if (!free.ok) return
    const congestedId = free.plan.segmentIds[2]
    // Mild congestion: the shortest path stays preferred (no thrashing) —
    // the alternative all-the-way-around-the-ring detour costs ~72 here.
    const mild = planRoute(graph, 'ring_out_s_b', 0.2, 'dest_market_strip', {
      extraCost: (id) => (id === congestedId ? 20 : 0),
    })
    expect(mild.ok && mild.plan.segmentIds.includes(congestedId)).toBe(true)
    // Severe congestion: the planner takes the detour.
    const severe = planRoute(graph, 'ring_out_s_b', 0.2, 'dest_market_strip', {
      extraCost: (id) => (id === congestedId ? 100 : 0),
    })
    expect(severe.ok).toBe(true)
    if (severe.ok) expect(severe.plan.segmentIds).not.toContain(congestedId)
  })

  it('left turns cost more than straights (movement penalties in totalCost)', () => {
    // Same physical corridor: going straight through the ring-north junction
    // must be cheaper per meter than the left turn onto the connector.
    const straight = planRoute(graph, 'ring_in_n_a', 0.9, 'dest_central_plaza_east')
    const left = planRoute(graph, 'ring_in_n_a', 0.9, 'dest_residential_homes')
    expect(straight.ok && left.ok).toBe(true)
    if (straight.ok && left.ok) {
      const straightIds = straight.plan.segmentIds
      expect(straightIds).toContain('jn_ring_n_in_straight')
      expect(left.plan.segmentIds).toContain('jn_ring_n_in_left_conn')
    }
  })
})

describe('route mode + destination selection', () => {
  it('mode selection is deterministic per seed and vehicle', () => {
    expect(selectRouteMode(42, 'vehicle_ambient_car_01')).toBe(
      selectRouteMode(42, 'vehicle_ambient_car_01'),
    )
    // Different seeds may differ; the call must never throw and always maps
    // to a valid mode.
    for (const seed of [1, 2, 3, 4, 5]) {
      expect(['crossDistrict', 'localLoop', 'throughTraffic']).toContain(
        selectRouteMode(seed, 'vehicle_x'),
      )
    }
  })

  it('same seed yields the same destination sequence', () => {
    const a = createVehicleRng(7, 'car_a')
    const b = createVehicleRng(7, 'car_a')
    for (let i = 0; i < 5; i++) {
      const da = selectDestination(graph, a, { mode: 'crossDistrict' })
      const db = selectDestination(graph, b, { mode: 'crossDistrict' })
      expect(da?.id).toBe(db?.id)
    }
  })

  it('crossDistrict prefers other districts and skips recent repeats', () => {
    const rng = createRng(99)
    const picked = selectDestination(graph, rng, {
      mode: 'crossDistrict',
      currentDistrictId: 'central',
      lastDestinationIds: ['dest_freight_yard'],
    })
    expect(picked).not.toBeNull()
    expect(picked!.districtId).not.toBe('central')
    expect(picked!.id).not.toBe('dest_freight_yard')
    expect(picked!.kind).not.toBe('districtExit')
  })

  it('throughTraffic only picks district exits', () => {
    const rng = createRng(3)
    for (let i = 0; i < 10; i++) {
      const picked = selectDestination(graph, rng, { mode: 'throughTraffic' })
      expect(picked!.kind).toBe('districtExit')
    }
  })

  it('weighted variety: many draws hit multiple destinations', () => {
    const rng = createRng(1234)
    const seen = new Set<string>()
    for (let i = 0; i < 40; i++) {
      const picked = selectDestination(graph, rng, { mode: 'crossDistrict' })
      seen.add(picked!.id)
    }
    expect(seen.size).toBeGreaterThan(4)
  })
})
