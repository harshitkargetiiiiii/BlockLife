import { beforeEach, describe, expect, it } from 'vitest'
import {
  computeDesiredLifecycles,
  flushStreamingQueue,
  getMountedSectorEntries,
  getMountedSectorIds,
  getSectorRuntimeState,
  isSectorReadyForGameplay,
  reportSectorColliders,
  reportSectorVisuals,
  resetStreamingRuntime,
  streamingRuntime,
  updateStreaming,
  type StreamingContext,
} from './sectorStreaming'

function context(overrides: Partial<StreamingContext> = {}): StreamingContext {
  return {
    playerX: 0,
    playerZ: 0,
    playerVelocityX: 0,
    playerVelocityZ: 0,
    locationMode: 'city',
    teleportDestinationSectorId: null,
    pinnedSectorIds: [],
    routedVehiclePrewarmSectorIds: [],
    ...overrides,
  }
}

/** Simulate the React side completing a sector's mount. */
function completeMount(id: string): void {
  const state = getSectorRuntimeState(id)!
  reportSectorVisuals(id, state.generation, true)
  reportSectorColliders(id, state.generation, true)
}

function completeUnmount(id: string): void {
  const state = getSectorRuntimeState(id)!
  reportSectorVisuals(id, state.generation, false)
  reportSectorColliders(id, state.generation, false)
}

beforeEach(() => resetStreamingRuntime())

describe('streaming policy (pure)', () => {
  it('player sector is active; warm ring around it; distant unloaded', () => {
    const desired = computeDesiredLifecycles(context())
    expect(desired.get('s0_0')).toBe('active')
    expect(desired.get('s0_-1')).toBe('warm')
    expect(desired.get('s-1_0')).toBe('warm')
    expect(desired.get('s1_0')).toBe('warm')
  })

  it('camera footprint raises boundary neighbors to active', () => {
    // Standing near the north edge: the gateway cell enters the view box.
    const desired = computeDesiredLifecycles(context({ playerZ: -60 }))
    expect(desired.get('s0_-1')).toBe('active')
  })

  it('velocity lead pre-activates the sector ahead of motion', () => {
    const still = computeDesiredLifecycles(context({ playerZ: -10 }))
    expect(still.get('s0_-1')).toBe('warm')
    const driving = computeDesiredLifecycles(
      context({ playerZ: -10, playerVelocityZ: -14 }), // heading north fast
    )
    expect(driving.get('s0_-1')).toBe('active')
  })

  it('teleport destination and pins are honored', () => {
    const desired = computeDesiredLifecycles(
      context({ teleportDestinationSectorId: 's0_-1', pinnedSectorIds: ['s1_0'] }),
    )
    expect(desired.get('s0_-1')).toBe('active')
    expect(desired.get('s1_0')).toBe('warm')
  })

  it('is deterministic', () => {
    const a = computeDesiredLifecycles(context({ playerX: -50, playerVelocityX: -5 }))
    const b = computeDesiredLifecycles(context({ playerX: -50, playerVelocityX: -5 }))
    expect([...a.entries()]).toEqual([...b.entries()])
  })
})

describe('lifecycle transitions', () => {
  it('loads the player sector through loading → warm → active', () => {
    updateStreaming(context(), 0)
    expect(getSectorRuntimeState('s0_0')!.lifecycle).toBe('loading')
    completeMount('s0_0')
    updateStreaming(context(), 16)
    updateStreaming(context(), 32)
    expect(getSectorRuntimeState('s0_0')!.lifecycle).toBe('active')
    expect(getSectorRuntimeState('s0_0')!.simulationTier).toBe('full')
    expect(getSectorRuntimeState('s0_0')!.loadDurationMs).not.toBeNull()
  })

  it('load is idempotent: repeated demand does not re-enter loading', () => {
    updateStreaming(context(), 0)
    completeMount('s0_0')
    flushStreamingQueue(context(), 16)
    const generation = getSectorRuntimeState('s0_0')!.generation
    for (let t = 100; t < 1000; t += 100) updateStreaming(context(), t)
    expect(getSectorRuntimeState('s0_0')!.generation).toBe(generation)
    expect(getSectorRuntimeState('s0_0')!.lifecycle).toBe('active')
  })

  it('demand drop cools, waits the unload delay, then unloads', () => {
    // Load the gateway via teleport demand, then drop it.
    const loadCtx = context({ teleportDestinationSectorId: 's0_-1' })
    updateStreaming(loadCtx, 0)
    completeMount('s0_-1')
    flushStreamingQueue(loadCtx, 10)
    expect(getSectorRuntimeState('s0_-1')!.lifecycle).toBe('active')

    // Demand drops (player far south so the gateway leaves even the warm ring).
    const dropCtx = context({ playerZ: 220 })
    for (let t = 1000; t < 1080; t += 16) updateStreaming(dropCtx, t)
    expect(['cooling', 'warm']).toContain(getSectorRuntimeState('s0_-1')!.lifecycle)
    // Before the delay elapses: still present (mounted).
    updateStreaming(dropCtx, 2000)
    expect(getMountedSectorIds()).toContain('s0_-1')
    // After the delay: unloading, then unloaded once the unmount reports.
    for (let t = 6000; t < 6080; t += 16) updateStreaming(dropCtx, t)
    expect(getSectorRuntimeState('s0_-1')!.lifecycle).toBe('unloading')
    completeUnmount('s0_-1')
    updateStreaming(dropCtx, 6032)
    expect(getSectorRuntimeState('s0_-1')!.lifecycle).toBe('unloaded')
  })

  it('cooling reactivates instantly when demand returns (no thrash)', () => {
    const loadCtx = context({ teleportDestinationSectorId: 's0_-1' })
    updateStreaming(loadCtx, 0)
    completeMount('s0_-1')
    flushStreamingQueue(loadCtx, 10)
    const generation = getSectorRuntimeState('s0_-1')!.generation
    for (let t = 100; t < 180; t += 16) updateStreaming(context({ playerZ: 220 }), t) // drop
    expect(getSectorRuntimeState('s0_-1')!.lifecycle).toBe('cooling')
    for (let t = 200; t < 280; t += 16) updateStreaming(loadCtx, t) // demand returns
    expect(getSectorRuntimeState('s0_-1')!.lifecycle).toBe('active')
    // Same generation: the gateway never unloaded/reloaded in between.
    expect(getSectorRuntimeState('s0_-1')!.generation).toBe(generation)
  })

  it('stale completions are ignored via generation tokens', () => {
    updateStreaming(context({ teleportDestinationSectorId: 's0_-1' }), 0)
    const oldGeneration = getSectorRuntimeState('s0_-1')!.generation
    // Cancel: demand drops before the mount completes.
    updateStreaming(context({ playerZ: 220 }), 10)
    completeUnmount('s0_-1')
    flushStreamingQueue(context({ playerZ: 220 }), 5000)
    expect(getSectorRuntimeState('s0_-1')!.lifecycle).toBe('unloaded')
    // The old mount completes late — must be ignored.
    reportSectorVisuals('s0_-1', oldGeneration, true)
    reportSectorColliders('s0_-1', oldGeneration, true)
    expect(getSectorRuntimeState('s0_-1')!.visualsReady).toBe(false)
    expect(streamingRuntime.metrics.staleCompletions).toBeGreaterThan(0)
  })

  it('a stale unmount (ready=false) cannot wedge a reloaded sector in loading', () => {
    // Regression: React useEffect cleanups are passive and flush async, so an
    // unload→reload cycle can deliver the OLD generation's cleanup AFTER the new
    // generation's mount reported ready. The guard used to cover ready=true only,
    // so that stale `false` cleared a live generation and the sector sat in
    // `loading` forever (a permanent hole in the world). Found by the mission
    // sector-cycle E2E, ~1 run in 8.
    updateStreaming(context({ teleportDestinationSectorId: 's0_-1' }), 0)
    completeMount('s0_-1')
    flushStreamingQueue(context({ teleportDestinationSectorId: 's0_-1' }), 10)
    const staleGeneration = getSectorRuntimeState('s0_-1')!.generation

    // Demand drops → the sector fully unloads.
    updateStreaming(context({ playerZ: 220 }), 20)
    completeUnmount('s0_-1')
    flushStreamingQueue(context({ playerZ: 220 }), 5000)
    expect(getSectorRuntimeState('s0_-1')!.lifecycle).toBe('unloaded')

    // Demand returns → new generation starts loading and its mount reports ready.
    updateStreaming(context({ teleportDestinationSectorId: 's0_-1' }), 6000)
    const live = getSectorRuntimeState('s0_-1')!
    expect(live.generation).not.toBe(staleGeneration)
    completeMount('s0_-1')

    // The PREVIOUS generation's cleanup lands late — it must not clear the live flags.
    reportSectorVisuals('s0_-1', staleGeneration, false)
    reportSectorColliders('s0_-1', staleGeneration, false)
    expect(live.visualsReady).toBe(true)
    expect(live.collidersReady).toBe(true)

    flushStreamingQueue(context({ teleportDestinationSectorId: 's0_-1' }), 6016)
    expect(getSectorRuntimeState('s0_-1')!.lifecycle).not.toBe('loading')
    expect(isSectorReadyForGameplay('s0_-1')).toBe(true)
  })

  it('mounted entries carry the generation so React remounts a reloaded sector', () => {
    // Regression: React identity used to be the sector id alone, so an
    // unload→reload could coalesce into "no membership change" — the roots never
    // remounted, the readiness effect never re-ran, and the sector wedged in
    // `loading` forever. The generation makes each incarnation a distinct key.
    updateStreaming(context({ teleportDestinationSectorId: 's0_-1' }), 0)
    const first = getMountedSectorEntries().find((e) => e.id === 's0_-1')!
    expect(first).toBeDefined()
    completeMount('s0_-1')
    flushStreamingQueue(context({ teleportDestinationSectorId: 's0_-1' }), 10)

    updateStreaming(context({ playerZ: 220 }), 20)
    completeUnmount('s0_-1')
    flushStreamingQueue(context({ playerZ: 220 }), 5000)
    expect(getMountedSectorEntries().some((e) => e.id === 's0_-1')).toBe(false)

    updateStreaming(context({ teleportDestinationSectorId: 's0_-1' }), 6000)
    const second = getMountedSectorEntries().find((e) => e.id === 's0_-1')!
    expect(second).toBeDefined()
    // Same sector, new incarnation → different React key.
    expect(second.generation).toBeGreaterThan(first.generation)
  })

  it('the current player sector can never unload', () => {
    updateStreaming(context(), 0)
    completeMount('s0_0')
    flushStreamingQueue(context(), 10)
    for (let t = 100; t < 60000; t += 1000) updateStreaming(context(), t)
    expect(getSectorRuntimeState('s0_0')!.lifecycle).toBe('active')
    expect(streamingRuntime.metrics.unloads).toBe(0)
  })

  it('readiness gate: gameplay-ready only when visuals AND colliders exist', () => {
    updateStreaming(context({ teleportDestinationSectorId: 's0_-1' }), 0)
    expect(isSectorReadyForGameplay('s0_-1')).toBe(false)
    const state = getSectorRuntimeState('s0_-1')!
    reportSectorVisuals('s0_-1', state.generation, true)
    expect(isSectorReadyForGameplay('s0_-1')).toBe(false) // colliders missing
    reportSectorColliders('s0_-1', state.generation, true)
    updateStreaming(context({ teleportDestinationSectorId: 's0_-1' }), 16)
    expect(isSectorReadyForGameplay('s0_-1')).toBe(true)
  })

  it('budget bounds work per tick; flush drains deterministically', () => {
    streamingRuntime.budgetPerTick = 1
    // Demand everything at once (player at the 4-corner point of the grid).
    const ctx = context({ playerX: -73, playerZ: -73 })
    updateStreaming(ctx, 0)
    expect(streamingRuntime.metrics.processedLastTick).toBeLessThanOrEqual(1)
    flushStreamingQueue(ctx, 100)
    // All demanded sectors reached 'loading' (mount pending) or better.
    for (const id of ['s0_0', 's-1_0', 's0_-1']) {
      expect(['loading', 'warm', 'active']).toContain(getSectorRuntimeState(id)!.lifecycle)
    }
  })
})
