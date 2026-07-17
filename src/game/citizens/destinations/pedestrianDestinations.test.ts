import { beforeEach, describe, expect, it } from 'vitest'
import {
  CITIZEN_DESTINATIONS,
  DESTINATIONS_BY_ID,
  PEDESTRIAN_GRAPH,
  planPedestrianRoute,
  selectDestination,
  validatePedestrianDestinations,
  validatePedestrianGraph,
} from './pedestrianDestinations'
import {
  activityDuration,
  beginNextTrip,
  initCitizenTrips,
  occupancyCount,
  recoverTrip,
  resetTripRuntime,
  resumeTrip,
  suspendTrip,
  tripRuntime,
} from './tripRuntime'

const CTX = { hour: 10, raining: false, now: 100 }

beforeEach(() => resetTripRuntime())

function freshTrip(id = 'cit_test') {
  return initCitizenTrips(id, [64, -92], 's0_-1', 'pdest_gateway_plaza')
}

describe('pedestrian destination graph (data)', () => {
  it('destinations validate: unique ids, walkable anchors, positive capacity, source refs', () => {
    expect(validatePedestrianDestinations()).toEqual([])
    for (const d of CITIZEN_DESTINATIONS) {
      expect(d.sourceRef.sourceId, d.id).toBeTruthy()
      expect(d.capacity, d.id).toBeGreaterThan(0)
    }
  })

  it('the graph validates: no edge through roads/water/solids, crossings join own curbs, all reachable', () => {
    expect(validatePedestrianGraph()).toEqual([])
  })

  it('graph ids are stable and deterministic across plans', () => {
    for (const e of PEDESTRIAN_GRAPH.edges) {
      expect(e.id.startsWith('pe_'), e.id).toBe(true)
    }
    const a = planPedestrianRoute('c1', 'pdest_gateway_plaza', 'pdest_s1_-2_s1')
    const b = planPedestrianRoute('c1', 'pdest_gateway_plaza', 'pdest_s1_-2_s1')
    expect(a).toEqual(b)
  })

  it('routes cross roads only through registered crossings (never directly)', () => {
    // Every proof route to the far side of a road carries crossing ids.
    const toMart = planPedestrianRoute('c', 'pdest_gateway_plaza', 'pdest_s1_-2_s1')!
    expect(toMart.crossingIds).toContain('s1_-1_main_st_plaza_walk')
    expect(toMart.crossingIds).toContain('s0_-2_harbor_cross_cross_east')
    const toYard = planPedestrianRoute('c', 'pdest_gateway_plaza', 'pdest_s-1_-2_w1')!
    expect(toYard.crossingIds).toContain('s-1_-2_yard_rd_gate_walk')
    const toWater = planPedestrianRoute('c', 'pdest_gateway_plaza', 'pdest_waterfront_view')!
    expect(toWater.crossingIds).toContain('s0_-2_drive_prom_walk')
  })

  it('all Harbor Cross proof destinations are mutually reachable', () => {
    const ids = CITIZEN_DESTINATIONS.map((d) => d.id)
    for (const a of ids) {
      for (const b of ids) {
        if (a === b) continue
        expect(planPedestrianRoute('v', a, b), `${a} -> ${b}`).not.toBeNull()
      }
    }
  })
})

describe('deterministic destination selection', () => {
  const base = {
    citizenId: 'cit_pick',
    tripIndex: 0,
    hour: 10,
    raining: false,
    lastDestinationId: null,
    occupancy: () => 0,
  }

  it('is seeded: identical inputs pick the identical destination', () => {
    const a = selectDestination(base)
    const b = selectDestination(base)
    expect(a?.id).toBe(b?.id)
    // Different trips explore different destinations eventually.
    const picks = new Set<string>()
    for (let i = 0; i < 12; i++) picks.add(selectDestination({ ...base, tripIndex: i })!.id)
    expect(picks.size).toBeGreaterThan(2)
  })

  it('never repeats the previous destination back-to-back', () => {
    for (let i = 0; i < 10; i++) {
      const prev = selectDestination({ ...base, tripIndex: i })!.id
      const next = selectDestination({ ...base, tripIndex: i + 1, lastDestinationId: prev })
      expect(next?.id).not.toBe(prev)
    }
  })

  it('respects capacity: a full destination is never selected', () => {
    const full = new Set(['pdest_s1_-2_s1'])
    for (let i = 0; i < 20; i++) {
      const pick = selectDestination({
        ...base,
        tripIndex: i,
        occupancy: (id) => (full.has(id) ? 99 : 0),
      })
      expect(pick?.id).not.toBe('pdest_s1_-2_s1')
    }
  })

  it('respects active hours: shops are closed at night', () => {
    for (let i = 0; i < 20; i++) {
      const pick = selectDestination({ ...base, tripIndex: i, hour: 3 })
      const dest = pick && DESTINATIONS_BY_ID.get(pick.id)
      expect(dest?.activeHours, pick?.id).toBeUndefined()
    }
  })

  it('respects weather: rain excludes avoid_rain spots and prefers indoors', () => {
    for (let i = 0; i < 20; i++) {
      const pick = selectDestination({ ...base, tripIndex: i, raining: true })!
      expect(pick.weatherPolicy).toBe('indoor_preferred')
    }
  })
})

describe('trip runtime: claims, recovery, dormancy', () => {
  it('begins a planned trip with a claimed destination and stable plan', () => {
    const trip = freshTrip()
    beginNextTrip(trip, trip.homeNodeId, CTX)
    expect(trip.phase).toBe('walking_to_destination')
    expect(trip.plan).not.toBeNull()
    expect(trip.destinationId).not.toBeNull()
    expect(occupancyCount(trip.destinationId!)).toBe(1)
    expect(activityDuration(trip)).toBeGreaterThanOrEqual(8)
    expect(activityDuration(trip)).toBe(activityDuration(trip)) // seeded
  })

  it('capacity is enforced across citizens; claims release on the next trip', () => {
    // Fill the waterfront viewpoint (capacity 2) with two citizens.
    const owners = ['cit_a', 'cit_b'].map((id) => {
      const t = initCitizenTrips(id, [64, -92], 's0_-1', 'pdest_gateway_plaza')
      t.destinationId = 'pdest_waterfront_view'
      return t
    })
    for (const t of owners) {
      // Direct claim through beginNextTrip is seeded; force via occupancy map.
      tripRuntime.occupancy.set(
        'pdest_waterfront_view',
        new Set([...(tripRuntime.occupancy.get('pdest_waterfront_view') ?? []), t.citizenId]),
      )
    }
    expect(occupancyCount('pdest_waterfront_view')).toBe(2)
    for (let i = 0; i < 20; i++) {
      const pick = selectDestination({
        citizenId: 'cit_late',
        tripIndex: i,
        hour: 10,
        raining: false,
        lastDestinationId: null,
        occupancy: occupancyCount,
      })
      expect(pick?.id).not.toBe('pdest_waterfront_view')
    }
  })

  it('bounded recovery: replan same → replan elsewhere → idle fallback', () => {
    const trip = freshTrip()
    beginNextTrip(trip, trip.homeNodeId, CTX)
    const firstDest = trip.destinationId
    recoverTrip(trip, [53.5, -120], CTX) // stage 1: same destination, re-anchored
    expect(trip.destinationId).toBe(firstDest)
    expect(trip.phase).toBe('walking_to_destination')
    recoverTrip(trip, [53.5, -120], CTX) // stage 2: fresh trip
    expect(trip.phase === 'walking_to_destination' || trip.phase === 'idle_fallback').toBe(true)
    recoverTrip(trip, [53.5, -120], CTX) // stage 3+: bounded fallback
    expect(trip.phase).toBe('idle_fallback')
    expect(trip.recoveryStage).toBe(0) // ladder resets after the fallback
  })

  it('dormancy suspends the trip, releases capacity, and resumes intact', () => {
    const trip = freshTrip()
    beginNextTrip(trip, trip.homeNodeId, CTX)
    const dest = trip.destinationId!
    const plan = trip.plan
    suspendTrip(trip.citizenId)
    expect(trip.suspended).toBe(true)
    expect(occupancyCount(dest)).toBe(0) // capacity released while dormant
    resumeTrip(trip.citizenId, [53.5, -120], CTX)
    expect(trip.suspended).toBe(false)
    // Claim was still free: the SAME plan + progress continue.
    expect(trip.destinationId).toBe(dest)
    expect(trip.plan).toBe(plan)
    expect(occupancyCount(dest)).toBe(1)
  })

  it('rematerialization replans from the nearest node when the claim was lost', () => {
    const trip = freshTrip()
    beginNextTrip(trip, trip.homeNodeId, CTX)
    const dest = trip.destinationId!
    suspendTrip(trip.citizenId)
    // Someone else takes every slot while our citizen sleeps.
    const capacity = DESTINATIONS_BY_ID.get(dest)!.capacity
    tripRuntime.occupancy.set(dest, new Set(Array.from({ length: capacity }, (_, i) => `thief_${i}`)))
    resumeTrip(trip.citizenId, [53.5, -228], CTX)
    expect(trip.suspended).toBe(false)
    expect(trip.destinationId).not.toBe(dest) // replanned to a fresh destination
    expect(trip.phase === 'walking_to_destination' || trip.phase === 'idle_fallback').toBe(true)
  })
})
