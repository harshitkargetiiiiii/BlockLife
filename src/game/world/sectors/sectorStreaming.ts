import type { SectorId } from './worldGrid'
import {
  getNeighborSectorIds,
  getSectorBounds,
  sectorIdToCoord,
  worldToSectorId,
} from './worldGrid'
import { getAllSectorIds, getSectorDefinition, isAuthoredSector } from './sectorRegistry'
import type { SimulationTier } from './sectorRegistry'

/**
 * Sector streaming runtime — module singleton (same pattern as the traffic
 * and visibility runtimes): lifecycle state mutated from the frame loop and
 * a deterministic, budgeted transition queue. React NEVER holds streaming
 * state; SectorManager samples the loaded set and re-renders only when it
 * actually changes.
 *
 * Lifecycle:  unloaded → loading → warm → active
 *                ↑                    ↓ (demand drops)
 *             unloading ← cooling ←──┘
 * plus a recoverable `error` state. Transitions run through the queue (one
 * per processing tick by default), guarded by per-sector generation tokens
 * so a stale async completion can never resurrect an unwanted sector.
 */

export type SectorLifecycle =
  | 'unloaded'
  | 'loading'
  | 'warm'
  | 'active'
  | 'cooling'
  | 'unloading'
  | 'error'

export interface SectorRuntimeState {
  id: SectorId
  lifecycle: SectorLifecycle
  /** What the policy currently wants ('unloaded' | 'warm' | 'active'). */
  requestedLifecycle: 'unloaded' | 'warm' | 'active'
  simulationTier: SimulationTier
  generation: number
  visualsReady: boolean
  collidersReady: boolean
  loadedAt: number | null
  activatedAt: number | null
  lastNeededAt: number | null
  loadStartedAt: number | null
  loadDurationMs: number | null
  error: string | null
}

export interface StreamingContext {
  playerX: number
  playerZ: number
  playerVelocityX: number
  playerVelocityZ: number
  locationMode: 'city' | 'apartment'
  /** Highest-priority destination (teleport in flight). */
  teleportDestinationSectorId: SectorId | null
  /** Kept warm regardless of distance (apartment entrance, quests). */
  pinnedSectorIds: readonly SectorId[]
  /** Route-lookahead prewarm requests from routed traffic. */
  routedVehiclePrewarmSectorIds: readonly SectorId[]
}

/** Half-extent of the orthographic camera footprint plus margin (measured
    ~70×55 world units on screen → 48 covers the long axis with margin). */
export const CAMERA_HALF_EXTENT = 48
/** Velocity lead: seconds of travel to pre-activate ahead of motion. */
export const VELOCITY_LEAD_SECONDS = 3

interface StreamingMetrics {
  transitions: number
  loads: number
  unloads: number
  staleCompletions: number
  maxQueueLength: number
  processedLastTick: number
}

export interface StreamingRuntime {
  enabled: boolean
  /** True once the director ticked at least once — LOD gates stay inert
      before that, so standalone component tests behave exactly as before. */
  started: boolean
  activeRing: number
  warmRing: number
  states: Map<SectorId, SectorRuntimeState>
  /** Sector ids with a pending lifecycle step, in enqueue order. */
  queue: SectorId[]
  /** Transitions applied per processing tick (budget). */
  budgetPerTick: number
  metrics: StreamingMetrics
  /** Dev/test: force lifecycles regardless of policy. */
  forced: Map<SectorId, 'unloaded' | 'warm' | 'active'>
}

function createState(id: SectorId): SectorRuntimeState {
  return {
    id,
    lifecycle: 'unloaded',
    requestedLifecycle: 'unloaded',
    simulationTier: 'unloaded',
    generation: 0,
    visualsReady: false,
    collidersReady: false,
    loadedAt: null,
    activatedAt: null,
    lastNeededAt: null,
    loadStartedAt: null,
    loadDurationMs: null,
    error: null,
  }
}

export const streamingRuntime: StreamingRuntime = {
  enabled: true,
  started: false,
  activeRing: 0,
  warmRing: 1,
  states: new Map(getAllSectorIds().map((id) => [id, createState(id)])),
  queue: [],
  budgetPerTick: 1,
  metrics: {
    transitions: 0,
    loads: 0,
    unloads: 0,
    staleCompletions: 0,
    maxQueueLength: 0,
    processedLastTick: 0,
  },
  forced: new Map(),
}

export function resetStreamingRuntime(): void {
  streamingRuntime.states = new Map(getAllSectorIds().map((id) => [id, createState(id)]))
  streamingRuntime.queue.length = 0
  streamingRuntime.forced.clear()
  streamingRuntime.enabled = true
  streamingRuntime.started = false
  streamingRuntime.activeRing = 0
  streamingRuntime.warmRing = 1
  streamingRuntime.metrics = {
    transitions: 0,
    loads: 0,
    unloads: 0,
    staleCompletions: 0,
    maxQueueLength: 0,
    processedLastTick: 0,
  }
}

/**
 * Pure desired-lifecycle policy. Deterministic: same context, same result.
 * Considers sector bounds vs the camera footprint (not center distance),
 * neighbor rings, velocity lead, teleports and pins.
 */
export function computeDesiredLifecycles(
  context: StreamingContext,
): Map<SectorId, 'unloaded' | 'warm' | 'active'> {
  const desired = new Map<SectorId, 'unloaded' | 'warm' | 'active'>()
  for (const id of getAllSectorIds()) desired.set(id, 'unloaded')

  const raise = (id: SectorId, level: 'warm' | 'active') => {
    if (!isAuthoredSector(id)) return
    const current = desired.get(id)
    if (current === 'active') return
    if (level === 'active' || current === 'unloaded' || current === undefined) {
      desired.set(id, level)
    }
  }

  const playerSector = worldToSectorId(context.playerX, context.playerZ)
  raise(playerSector, 'active')

  // Camera footprint + velocity lead: any sector whose cell intersects the
  // led view box is ACTIVE (it can appear on screen).
  const leadX = context.playerX + context.playerVelocityX * VELOCITY_LEAD_SECONDS
  const leadZ = context.playerZ + context.playerVelocityZ * VELOCITY_LEAD_SECONDS
  const viewMinX = Math.min(context.playerX, leadX) - CAMERA_HALF_EXTENT
  const viewMaxX = Math.max(context.playerX, leadX) + CAMERA_HALF_EXTENT
  const viewMinZ = Math.min(context.playerZ, leadZ) - CAMERA_HALF_EXTENT
  const viewMaxZ = Math.max(context.playerZ, leadZ) + CAMERA_HALF_EXTENT
  for (const id of getAllSectorIds()) {
    const b = getSectorBounds(sectorIdToCoord(id))
    if (b.minX < viewMaxX && b.maxX > viewMinX && b.minZ < viewMaxZ && b.maxZ > viewMinZ) {
      raise(id, 'active')
    }
  }

  // Ring policy around the player.
  for (const id of getNeighborSectorIds(playerSector, streamingRuntime.warmRing)) {
    raise(id, 'warm')
  }
  if (streamingRuntime.activeRing > 0) {
    for (const id of getNeighborSectorIds(playerSector, streamingRuntime.activeRing)) {
      raise(id, 'active')
    }
  }

  for (const id of context.pinnedSectorIds) raise(id, 'warm')
  for (const id of context.routedVehiclePrewarmSectorIds) raise(id, 'warm')
  if (context.teleportDestinationSectorId) raise(context.teleportDestinationSectorId, 'active')

  // Indoors: the world outside keeps simulating per current policy; the
  // entrance sector is pinned by the caller. No special demotion.
  return desired
}

/** One lifecycle step toward the requested level. Returns true if changed. */
function stepLifecycle(state: SectorRuntimeState, now: number): boolean {
  const want = state.requestedLifecycle
  const def = getSectorDefinition(state.id)
  const unloadDelay = def?.streaming.unloadDelayMs ?? 3000

  switch (state.lifecycle) {
    case 'unloaded':
      if (want !== 'unloaded') {
        state.lifecycle = 'loading'
        state.generation += 1
        state.visualsReady = false
        state.collidersReady = false
        state.loadStartedAt = now
        state.error = null
        streamingRuntime.metrics.loads += 1
        return true
      }
      return false
    case 'loading':
      // Canceled load: demand dropped before completion — abort cleanly.
      if (want === 'unloaded') {
        state.lifecycle = 'unloading'
        return true
      }
      // Completion is reported by the mounted components (readiness); the
      // want-unloaded case already aborted above, so completion lands warm.
      if (state.visualsReady && state.collidersReady) {
        state.lifecycle = 'warm'
        state.simulationTier = 'reduced'
        state.loadedAt = now
        state.loadDurationMs = state.loadStartedAt !== null ? now - state.loadStartedAt : null
        return true
      }
      return false
    case 'warm':
      if (want === 'active') {
        state.lifecycle = 'active'
        state.activatedAt = now
        state.simulationTier = 'full'
        return true
      }
      if (want === 'unloaded') {
        state.lifecycle = 'cooling'
        return true
      }
      state.simulationTier = 'reduced'
      return false
    case 'active':
      if (want === 'active') {
        state.simulationTier = 'full'
        state.lastNeededAt = now
        return false
      }
      if (want === 'warm') {
        state.lifecycle = 'warm'
        state.simulationTier = 'reduced'
        return true
      }
      state.lifecycle = 'cooling'
      return true
    case 'cooling':
      if (want !== 'unloaded') {
        // Demand returned during cool-down: instant reactivation.
        state.lifecycle = want === 'active' ? 'active' : 'warm'
        state.simulationTier = want === 'active' ? 'full' : 'reduced'
        return true
      }
      if (state.lastNeededAt === null || now - state.lastNeededAt >= unloadDelay) {
        state.lifecycle = 'unloading'
        return true
      }
      return false
    case 'unloading':
      // React unmounts on 'unloading'; readiness flags drop via reports.
      if (!state.visualsReady && !state.collidersReady) {
        state.lifecycle = 'unloaded'
        state.simulationTier = 'unloaded'
        state.generation += 1 // invalidate any stale async completions
        streamingRuntime.metrics.unloads += 1
        return true
      }
      return false
    case 'error':
      if (want !== 'unloaded') {
        // Recoverable: retry the load.
        state.lifecycle = 'unloaded'
        return true
      }
      return false
  }
}

/**
 * Main streaming tick: recompute demand, update timestamps, and process a
 * budgeted number of lifecycle steps. Deterministic given (context, now).
 */
export function updateStreaming(context: StreamingContext, now: number): void {
  if (!streamingRuntime.enabled) return
  streamingRuntime.started = true
  const desired = computeDesiredLifecycles(context)

  for (const [id, want] of desired) {
    const state = streamingRuntime.states.get(id)
    if (!state) continue
    const forced = streamingRuntime.forced.get(id)
    const finalWant = forced ?? want
    state.requestedLifecycle = finalWant
    if (finalWant !== 'unloaded') state.lastNeededAt = now
    // Enqueue sectors that need a step (dedup keeps the queue bounded).
    if (needsStep(state) && !streamingRuntime.queue.includes(id)) {
      streamingRuntime.queue.push(id)
    }
  }
  streamingRuntime.metrics.maxQueueLength = Math.max(
    streamingRuntime.metrics.maxQueueLength,
    streamingRuntime.queue.length,
  )

  // Priority: teleport destination first, then player sector, then FIFO.
  const playerSector = worldToSectorId(context.playerX, context.playerZ)
  streamingRuntime.queue.sort((a, b) => priorityOf(b, context, playerSector) - priorityOf(a, context, playerSector))

  let processed = 0
  let index = 0
  while (index < streamingRuntime.queue.length && processed < streamingRuntime.budgetPerTick) {
    const id = streamingRuntime.queue[index]
    const state = streamingRuntime.states.get(id)!
    if (stepLifecycle(state, now)) {
      streamingRuntime.metrics.transitions += 1
      processed += 1
    }
    if (!needsStep(state)) {
      streamingRuntime.queue.splice(index, 1)
    } else {
      index += 1
    }
  }
  streamingRuntime.metrics.processedLastTick = processed
}

function needsStep(state: SectorRuntimeState): boolean {
  const want = state.requestedLifecycle
  switch (state.lifecycle) {
    case 'unloaded':
      return want !== 'unloaded'
    case 'loading':
      return true // waiting on readiness
    case 'warm':
      return want !== 'warm'
    case 'active':
      return want !== 'active'
    case 'cooling':
    case 'unloading':
      return true
    case 'error':
      return want !== 'unloaded'
  }
}

function priorityOf(id: SectorId, context: StreamingContext, playerSector: SectorId): number {
  if (id === context.teleportDestinationSectorId) return 100
  if (id === playerSector) return 90
  if (context.pinnedSectorIds.includes(id)) return 60
  if (context.routedVehiclePrewarmSectorIds.includes(id)) return 50
  const def = getSectorDefinition(id)
  return def?.streaming.priority ?? 0
}

/**
 * Deterministic test/teleport flush: run streaming ticks with an unlimited
 * budget until the queue settles (readiness reports must happen between
 * flushes for load completion — callers advance frames or report directly).
 */
export function flushStreamingQueue(context: StreamingContext, now: number, maxIterations = 20): void {
  const budget = streamingRuntime.budgetPerTick
  streamingRuntime.budgetPerTick = 1000
  for (let i = 0; i < maxIterations && streamingRuntime.queue.length > 0; i++) {
    updateStreaming(context, now + i)
  }
  streamingRuntime.budgetPerTick = budget
}

// ---- Readiness reports (called from mounted sector components) -----------

/**
 * Readiness reports are generation-scoped in BOTH directions. Guarding only
 * `ready === true` used to leave a wedge: React's useEffect cleanups are
 * passive and flush asynchronously, so an unload→reload cycle can deliver the
 * OLD generation's cleanup (ready=false) *after* the new generation's mount
 * effect already reported ready. That stale false cleared a live generation's
 * flag, and since `stepLifecycle` only leaves `loading` once both flags are
 * true, the sector stayed stuck in `loading` forever — a permanent hole in the
 * world. A report from a superseded generation says nothing about the current
 * one (the transition already reset the flags), so ignore it either way.
 */
export function reportSectorVisuals(id: SectorId, generation: number, ready: boolean): void {
  const state = streamingRuntime.states.get(id)
  if (!state) return
  if (generation !== state.generation) {
    streamingRuntime.metrics.staleCompletions += 1
    return // stale report from a superseded generation — ignore
  }
  state.visualsReady = ready
}

export function reportSectorColliders(id: SectorId, generation: number, ready: boolean): void {
  const state = streamingRuntime.states.get(id)
  if (!state) return
  if (generation !== state.generation) {
    streamingRuntime.metrics.staleCompletions += 1
    return // stale report from a superseded generation — ignore
  }
  state.collidersReady = ready
}

export function reportSectorError(id: SectorId, message: string): void {
  const state = streamingRuntime.states.get(id)
  if (!state) return
  state.lifecycle = 'error'
  state.error = message
}

// ---- Queries --------------------------------------------------------------

/** Sectors whose content should currently be MOUNTED in the scene. */
export function isSectorMounted(state: SectorRuntimeState): boolean {
  return (
    state.lifecycle === 'loading' ||
    state.lifecycle === 'warm' ||
    state.lifecycle === 'active' ||
    state.lifecycle === 'cooling'
  )
}

export function getMountedSectorIds(): SectorId[] {
  const out: SectorId[] = []
  for (const state of streamingRuntime.states.values()) {
    if (isSectorMounted(state)) out.push(state.id)
  }
  return out.sort()
}

/**
 * Mounted set WITH generation tokens. React identity must include the
 * generation: a sector that unloads and reloads is a different incarnation
 * whose roots have to remount and re-report readiness. Keying on the id alone
 * let React coalesce the unmount+remount into no change, so the effect never
 * re-ran, nobody reported readiness for the new generation, and the sector sat
 * in `loading` forever. See SectorManager's useMountedSectors.
 */
export function getMountedSectorEntries(): { id: SectorId; generation: number }[] {
  const out: { id: SectorId; generation: number }[] = []
  for (const state of streamingRuntime.states.values()) {
    if (isSectorMounted(state)) out.push({ id: state.id, generation: state.generation })
  }
  return out.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
}

export function getSectorRuntimeState(id: SectorId): SectorRuntimeState | undefined {
  return streamingRuntime.states.get(id)
}

/** Simulation tier for gameplay systems (unknown sector = full — safe). */
export function getSimulationTierAt(x: number, z: number): SimulationTier {
  if (!streamingRuntime.started) return 'full'
  const state = streamingRuntime.states.get(worldToSectorId(x, z))
  if (!state) return 'full'
  return state.simulationTier
}

/** True until the director runs — LOD callers treat the world as mounted. */
export function isStreamingActive(): boolean {
  return streamingRuntime.started && streamingRuntime.enabled
}

export function isSectorReadyForGameplay(id: SectorId): boolean {
  const state = streamingRuntime.states.get(id)
  if (!state) return true // unauthored void: nothing to load
  return (
    (state.lifecycle === 'warm' || state.lifecycle === 'active' || state.lifecycle === 'cooling') &&
    state.visualsReady &&
    state.collidersReady
  )
}
