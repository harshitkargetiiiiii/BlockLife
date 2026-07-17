import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { getRoadGraph, pointAtProgress } from './roadGraphBuilder'
import { resetRouteSequence } from './routePlanner'
import {
  chooseDestination,
  handleDestinationArrival,
  initializeRoutedVehicle,
  pickRespawnPoint,
  respawnRoutedVehicle,
} from './routeLifecycle'
import { routeRuntime } from './routeRuntime'

const graph = getRoadGraph()

beforeEach(() => {
  resetRouteSequence()
  routeRuntime.seed = 1
  routeRuntime.states.clear()
  routeRuntime.forcedDestinations.clear()
  routeRuntime.blockedSegmentIds.clear()
  routeRuntime.congestion.clear()
})

afterEach(() => {
  routeRuntime.states.clear()
  routeRuntime.forcedDestinations.clear()
  routeRuntime.blockedSegmentIds.clear()
})

describe('initializeRoutedVehicle', () => {
  it('creates pose and route atomically at the assigned spawn', () => {
    const spawned = initializeRoutedVehicle(graph, 'car_x', 'crossDistrict', 'spawn_ring_north')
    expect(spawned).not.toBeNull()
    const { state, position, heading } = spawned!
    expect(state.route).not.toBeNull()
    expect(state.destinationId).not.toBeNull()
    expect(state.route!.segmentIds[0]).toBe('ring_in_n_a')
    const spawn = graph.spawnPoints.get('spawn_ring_north')!
    const expected = pointAtProgress(graph.segments.get(spawn.segmentId)!, spawn.progress)
    expect(position).toEqual(expected)
    expect(Number.isFinite(heading)).toBe(true)
  })

  it('is deterministic for the same routing seed', () => {
    const a = initializeRoutedVehicle(graph, 'car_x', 'crossDistrict', 'spawn_ring_north')!
    const b = initializeRoutedVehicle(graph, 'car_x', 'crossDistrict', 'spawn_ring_north')!
    expect(a.state.destinationId).toBe(b.state.destinationId)
    expect(a.state.route!.segmentIds).toEqual(b.state.route!.segmentIds)
  })

  it('different seeds may produce different destinations but always valid ones', () => {
    for (const seed of [1, 2, 3, 4]) {
      routeRuntime.seed = seed
      const spawned = initializeRoutedVehicle(graph, 'car_x', 'crossDistrict', 'spawn_ring_north')!
      expect(graph.destinations.has(spawned.state.destinationId!)).toBe(true)
    }
  })

  it('falls back to a valid spawn when the assigned id is unknown', () => {
    const spawned = initializeRoutedVehicle(graph, 'car_x', 'crossDistrict', 'spawn_nope')
    expect(spawned).not.toBeNull()
    expect(spawned!.state.route).not.toBeNull()
  })
})

describe('destination arrival', () => {
  it('crossDistrict cars continue with a fresh plan and record the trip', () => {
    const { state } = initializeRoutedVehicle(graph, 'car_x', 'crossDistrict', 'spawn_ring_north')!
    const firstDestination = state.destinationId!
    // Simulate reaching the final segment.
    state.segmentIndex = state.route!.segmentIds.length - 1
    const outcome = handleDestinationArrival(graph, state)
    expect(outcome).toBe('continue')
    expect(state.tripsCompleted).toBe(1)
    expect(state.lastDestinationIds).toContain(firstDestination)
    expect(state.destinationId).not.toBe(firstDestination) // history discourages repeats
    expect(state.route!.segmentIds.length).toBeGreaterThan(0)
    expect(state.segmentIndex).toBe(0)
  })

  it('throughTraffic cars report despawn at their exit', () => {
    const { state } = initializeRoutedVehicle(graph, 'car_t', 'throughTraffic', 'spawn_freight')!
    expect(graph.destinations.get(state.destinationId!)!.kind).toBe('districtExit')
    state.segmentIndex = state.route!.segmentIds.length - 1
    expect(handleDestinationArrival(graph, state)).toBe('despawn')
    expect(state.tripsCompleted).toBe(1)
  })

  it('forced destinations (dev/test) win over the seeded pick', () => {
    const { state } = initializeRoutedVehicle(graph, 'car_x', 'crossDistrict', 'spawn_ring_north')!
    routeRuntime.forcedDestinations.set('car_x', 'dest_freight_yard')
    const picked = chooseDestination(graph, state, 'central')
    expect(picked).toBe('dest_freight_yard')
    // Consumed exactly once.
    expect(routeRuntime.forcedDestinations.has('car_x')).toBe(false)
  })
})

describe('respawn', () => {
  it('skips occupied spawn points', () => {
    const { state } = initializeRoutedVehicle(graph, 'car_x', 'throughTraffic', 'spawn_freight')!
    const occupiedAll = pickRespawnPoint(graph, state, { isOccupied: () => true })
    expect(occupiedAll).toBeNull()
    const free = pickRespawnPoint(graph, state, { isOccupied: () => false })
    expect(free).not.toBeNull()
  })

  it('prefers points outside the avoid radius when any exist', () => {
    const { state } = initializeRoutedVehicle(graph, 'car_x', 'throughTraffic', 'spawn_freight')!
    // Avoid circle over the central plaza — the picked point must be
    // outside it as long as non-central spawns are free.
    const picked = pickRespawnPoint(graph, state, {
      avoid: { x: 0, z: 0, radius: 40 },
      isOccupied: () => false,
    })!
    const seg = graph.segments.get(picked.segmentId)!
    const [x, z] = pointAtProgress(seg, picked.progress)
    expect(Math.hypot(x, z)).toBeGreaterThan(40)
  })

  it('respawning resets recovery bookkeeping and plans a new route', () => {
    const { state } = initializeRoutedVehicle(graph, 'car_x', 'throughTraffic', 'spawn_freight')!
    state.recoveryStage = 4
    state.recoveryAttempts = 3
    state.suspectTime = 40
    const spawn = graph.spawnPoints.get('spawn_ring_south')!
    const respawned = respawnRoutedVehicle(graph, state, spawn)
    expect(respawned).not.toBeNull()
    expect(state.recoveryStage).toBe(0)
    expect(state.recoveryAttempts).toBe(0)
    expect(state.suspectTime).toBe(0)
    expect(state.route!.segmentIds[0]).toBe(spawn.segmentId)
  })
})
