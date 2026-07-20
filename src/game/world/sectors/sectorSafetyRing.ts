/**
 * Player safety ring (World Integrity issue §6) — the transactional backstop
 * that keeps the ACTIVE SUBJECT (on-foot player or driven car) from ever
 * reaching floor/colliders/visuals that are not ready, during ORDINARY
 * locomotion (teleports are already gated by the teleport coordinator).
 *
 * This module is OBSERVE + SOFT-CLAMP only. It never mutates sector lifecycle
 * except through the existing generation-safe self-heal path, and it never
 * teleports the player or freezes the game — per §6 it prefers speed-aware
 * prewarming (already in `computeDesiredLifecycles`) with a soft boundary
 * velocity clamp as the rare emergency, plus a bounded watchdog for a required
 * sector wedged in `loading`.
 *
 * Everything here is deterministic given the streaming runtime state + input,
 * so it unit-tests without React and never writes Zustand per frame.
 */
import type { SectorId } from './worldGrid'
import { getSectorBounds, sectorIdToCoord, worldToSectorId } from './worldGrid'
import {
  forceSectorReload,
  getSectorRuntimeState,
  isSectorReadyForGameplay,
} from './sectorStreaming'

/** Seconds ahead the "entering" sector is projected from current velocity. */
export const ENTER_LEAD_SECONDS = 1.0
/** Within this many world units of a boundary into an UNREADY sector, the soft
 *  backstop engages. Small: prewarm (3s lead) normally readies the neighbour
 *  long before the subject is a few units from the edge, so this rarely fires. */
export const BACKSTOP_BAND = 6
/** A REQUIRED sector stuck in `loading` beyond this (ms) is force-reloaded. */
export const STUCK_LOADING_MS = 4000

export interface SafetyRingInput {
  playerX: number
  playerZ: number
  playerVelocityX: number
  playerVelocityZ: number
  locationMode: 'city' | 'apartment'
}

export interface SafetyRingStatus {
  /** Sector under the subject right now. */
  currentSector: SectorId
  /** Sector the subject is projected to enter next (may equal current). */
  enteringSector: SectorId
  /** Required sectors (current ∪ entering) that are NOT gameplay-ready. */
  notReady: SectorId[]
  /** True when every required sector is ready — the §6 coverage invariant. */
  covered: boolean
}

/**
 * The REQUIRED sectors for this frame: the one under the subject and the one a
 * short lead-time ahead along the velocity. Indoors the subject is off the grid
 * (anchored to the street exit) so nothing is required. Deterministic.
 */
export function requiredSectors(input: SafetyRingInput): SectorId[] {
  if (input.locationMode === 'apartment') return []
  const current = worldToSectorId(input.playerX, input.playerZ)
  const leadX = input.playerX + input.playerVelocityX * ENTER_LEAD_SECONDS
  const leadZ = input.playerZ + input.playerVelocityZ * ENTER_LEAD_SECONDS
  const entering = worldToSectorId(leadX, leadZ)
  return entering === current ? [current] : [current, entering]
}

/** Evaluate the coverage invariant for this frame (observe-only). */
export function evaluatePlayerSafetyRing(input: SafetyRingInput): SafetyRingStatus {
  const currentSector = worldToSectorId(input.playerX, input.playerZ)
  const leadX = input.playerX + input.playerVelocityX * ENTER_LEAD_SECONDS
  const leadZ = input.playerZ + input.playerVelocityZ * ENTER_LEAD_SECONDS
  const enteringSector = worldToSectorId(leadX, leadZ)
  const notReady: SectorId[] = []
  for (const id of requiredSectors(input)) {
    // `isSectorReadyForGameplay` returns true for unauthored void (intentional
    // empty ground with the global floor), so only real un-ready sectors flag.
    if (!isSectorReadyForGameplay(id)) notReady.push(id)
  }
  return { currentSector, enteringSector, notReady, covered: notReady.length === 0 }
}

export interface ClampResult {
  vx: number
  vz: number
  /** True when a boundary crossing into an unready sector was blocked. */
  clamped: boolean
}

/**
 * Soft boundary velocity clamp (the rare emergency). Zeroes ONLY the velocity
 * component that would carry the subject across a sector boundary into an
 * un-ready neighbour while within the backstop band of that boundary — the
 * subject slides along the edge (and can still move away) until the neighbour
 * commits, then proceeds. Never zeroes movement that stays inside ready
 * coverage, so it can't freeze the game. Pure over the streaming state.
 */
export function clampVelocityToCoverage(
  px: number,
  pz: number,
  vx: number,
  vz: number,
): ClampResult {
  const current = worldToSectorId(px, pz)
  const b = getSectorBounds(sectorIdToCoord(current))
  let cvx = vx
  let cvz = vz
  let clamped = false

  // +x edge
  if (vx > 0 && px > b.maxX - BACKSTOP_BAND) {
    const neighbour = worldToSectorId(b.maxX + 1, pz)
    if (neighbour !== current && !isSectorReadyForGameplay(neighbour)) {
      cvx = 0
      clamped = true
    }
  }
  // -x edge
  if (vx < 0 && px < b.minX + BACKSTOP_BAND) {
    const neighbour = worldToSectorId(b.minX - 1, pz)
    if (neighbour !== current && !isSectorReadyForGameplay(neighbour)) {
      cvx = 0
      clamped = true
    }
  }
  // +z edge
  if (vz > 0 && pz > b.maxZ - BACKSTOP_BAND) {
    const neighbour = worldToSectorId(px, b.maxZ + 1)
    if (neighbour !== current && !isSectorReadyForGameplay(neighbour)) {
      cvz = 0
      clamped = true
    }
  }
  // -z edge
  if (vz < 0 && pz < b.minZ + BACKSTOP_BAND) {
    const neighbour = worldToSectorId(px, b.minZ - 1)
    if (neighbour !== current && !isSectorReadyForGameplay(neighbour)) {
      cvz = 0
      clamped = true
    }
  }
  return { vx: cvx, vz: cvz, clamped }
}

// ---- watchdog / self-heal ------------------------------------------------

/**
 * Required sectors wedged in `loading` longer than the bounded timeout. The
 * missions-sprint fix removed the KNOWN wedge (generation-keyed remount +
 * two-way stale-report guard); this is the belt-and-braces backstop for any
 * future stall — a bounded, self-healing retry so a player-adjacent sector can
 * never sit in `loading` forever. Returns the ids that were force-reloaded.
 */
export function healStuckRequiredSectors(input: SafetyRingInput, now: number): SectorId[] {
  const healed: SectorId[] = []
  for (const id of requiredSectors(input)) {
    const state = getSectorRuntimeState(id)
    if (!state || state.lifecycle !== 'loading' || state.loadStartedAt === null) continue
    if (now - state.loadStartedAt >= STUCK_LOADING_MS) {
      forceSectorReload(id)
      healed.push(id)
    }
  }
  return healed
}

// ---- runtime singleton (metrics + anomaly source) ------------------------

export interface SafetyRingRuntime {
  /** Most recent evaluation (read by the integrity anomaly scan + test API). */
  lastStatus: SafetyRingStatus | null
  /** Sectors force-reloaded by the watchdog since the last reset. */
  totalSelfHeals: number
  /** Frames the soft backstop clamped a crossing since the last reset. */
  totalBackstops: number
  /** Ids currently force-reloaded this frame (typed-anomaly source). */
  lastHealed: SectorId[]
  /** True when the backstop clamped this frame (typed-anomaly source). */
  backstopActive: boolean
}

export const safetyRingRuntime: SafetyRingRuntime = {
  lastStatus: null,
  totalSelfHeals: 0,
  totalBackstops: 0,
  lastHealed: [],
  backstopActive: false,
}

export function resetSafetyRingRuntime(): void {
  safetyRingRuntime.lastStatus = null
  safetyRingRuntime.totalSelfHeals = 0
  safetyRingRuntime.totalBackstops = 0
  safetyRingRuntime.lastHealed = []
  safetyRingRuntime.backstopActive = false
}

/**
 * One safety-ring step, called each frame by the SectorDirector AFTER the
 * streaming tick: evaluate coverage, run the bounded watchdog, and record the
 * status + any self-heals for the integrity anomaly scan to drain. Observe +
 * self-heal only; the movement backstop is applied in the controllers.
 */
export function stepPlayerSafetyRing(input: SafetyRingInput, now: number): SafetyRingStatus {
  const status = evaluatePlayerSafetyRing(input)
  safetyRingRuntime.lastStatus = status
  const healed = healStuckRequiredSectors(input, now)
  if (healed.length > 0) {
    safetyRingRuntime.lastHealed = [...safetyRingRuntime.lastHealed, ...healed]
    safetyRingRuntime.totalSelfHeals += healed.length
  }
  return status
}

/** Latch that the soft backstop clamped a crossing this frame (from a
 *  controller). Drained by the integrity scan via `consumeStreamingSafetySnapshot`. */
export function noteBackstop(): void {
  safetyRingRuntime.backstopActive = true
  safetyRingRuntime.totalBackstops += 1
}

/** Snapshot the integrity anomaly scan drains (structurally matches the
 *  detector's `StreamingSafetySnapshot`). */
export interface StreamingSafetySnapshot {
  covered: boolean
  notReady: readonly SectorId[]
  backstopActive: boolean
  healed: readonly SectorId[]
}

/**
 * Consume the safety-ring diagnostics accumulated since the last call. The
 * SectorDirector runs at ~60 Hz and the integrity scan at ~4 Hz, so the
 * per-frame heals + backstop clamps are LATCHED here and drained (cleared) each
 * scan — otherwise a one-frame heal/clamp would almost always fall between
 * scans and never be surfaced. `covered`/`notReady` reflect the latest frame
 * (a SUSTAINED gap stays false every frame, so the tracker still catches it).
 */
export function consumeStreamingSafetySnapshot(): StreamingSafetySnapshot | null {
  const s = safetyRingRuntime
  if (!s.lastStatus) return null
  const snap: StreamingSafetySnapshot = {
    covered: s.lastStatus.covered,
    notReady: s.lastStatus.notReady,
    backstopActive: s.backstopActive,
    healed: [...s.lastHealed],
  }
  s.lastHealed = []
  s.backstopActive = false
  return snap
}
