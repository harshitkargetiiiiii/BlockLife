import { beforeEach, describe, expect, it } from 'vitest'
import {
  getSectorRuntimeState,
  isSectorReadyForGameplay,
  resetStreamingRuntime,
  streamingRuntime,
} from './sectorStreaming'
import {
  BACKSTOP_BAND,
  STUCK_LOADING_MS,
  clampVelocityToCoverage,
  evaluatePlayerSafetyRing,
  healStuckRequiredSectors,
  requiredSectors,
  type SafetyRingInput,
} from './sectorSafetyRing'

// s0_0 spans X=[-72,72], Z=[-72,72]; s1_0 is its authored +x neighbour.
function input(o: Partial<SafetyRingInput> = {}): SafetyRingInput {
  return { playerX: 0, playerZ: 0, playerVelocityX: 0, playerVelocityZ: 0, locationMode: 'city', ...o }
}
/** Configure a sector as gameplay-ready (warm/active + both flags). */
function setReady(id: string): void {
  const s = getSectorRuntimeState(id)!
  s.lifecycle = 'active'
  s.visualsReady = true
  s.collidersReady = true
}
/** Configure a sector as mid-load, started at `loadStartedAt`. */
function setLoading(id: string, loadStartedAt: number): void {
  const s = getSectorRuntimeState(id)!
  s.lifecycle = 'loading'
  s.loadStartedAt = loadStartedAt
  s.visualsReady = false
  s.collidersReady = false
}

beforeEach(() => resetStreamingRuntime())

describe('requiredSectors', () => {
  it('is just the current sector when standing still', () => {
    expect(requiredSectors(input())).toEqual(['s0_0'])
  })

  it('adds the velocity-projected entering sector when moving toward a boundary', () => {
    // vx=100 → lead (1s) at x=100, inside s1_0.
    expect(requiredSectors(input({ playerVelocityX: 100 }))).toEqual(['s0_0', 's1_0'])
  })

  it('requires nothing indoors (subject is off the grid)', () => {
    expect(requiredSectors(input({ locationMode: 'apartment', playerVelocityX: 100 }))).toEqual([])
  })
})

describe('evaluatePlayerSafetyRing', () => {
  it('is covered when every required sector is ready', () => {
    setReady('s0_0')
    const status = evaluatePlayerSafetyRing(input())
    expect(status.covered).toBe(true)
    expect(status.notReady).toEqual([])
  })

  it('is NOT covered when the entering sector is not ready', () => {
    setReady('s0_0') // current ready…
    // …but s1_0 (entering) left unloaded.
    const status = evaluatePlayerSafetyRing(input({ playerVelocityX: 100 }))
    expect(status.covered).toBe(false)
    expect(status.notReady).toEqual(['s1_0'])
    expect(status.enteringSector).toBe('s1_0')
  })

  it('tolerates unauthored void as ready ground (no false gap)', () => {
    // Far outside the authored grid: isSectorReadyForGameplay returns true.
    const status = evaluatePlayerSafetyRing(input({ playerX: 99999, playerZ: 99999 }))
    expect(status.covered).toBe(true)
  })
})

describe('clampVelocityToCoverage (soft boundary backstop)', () => {
  it('zeroes the crossing component into an UNREADY neighbour within the band', () => {
    setReady('s0_0') // s1_0 left unloaded (not ready)
    const px = 72 - BACKSTOP_BAND + 1 // inside the +x band
    const r = clampVelocityToCoverage(px, 0, 5, 0)
    expect(r.clamped).toBe(true)
    expect(r.vx).toBe(0)
  })

  it('does NOT clamp when the neighbour is ready', () => {
    setReady('s0_0')
    setReady('s1_0')
    const px = 72 - BACKSTOP_BAND + 1
    const r = clampVelocityToCoverage(px, 0, 5, 0)
    expect(r.clamped).toBe(false)
    expect(r.vx).toBe(5)
  })

  it('does NOT clamp away from the boundary (mid-sector)', () => {
    setReady('s0_0') // s1_0 unloaded, but player is nowhere near the edge
    const r = clampVelocityToCoverage(0, 0, 5, 0)
    expect(r.clamped).toBe(false)
    expect(r.vx).toBe(5)
  })

  it('leaves the parallel (non-crossing) axis untouched', () => {
    setReady('s0_0') // s1_0 unloaded
    const px = 72 - BACKSTOP_BAND + 1
    // Moving +x (blocked into unready s1_0) but also +z along the boundary.
    const r = clampVelocityToCoverage(px, 0, 5, 3)
    expect(r.vx).toBe(0) // crossing blocked
    expect(r.vz).toBe(3) // sliding along the edge preserved
  })
})

describe('healStuckRequiredSectors (bounded watchdog)', () => {
  it('force-reloads a required sector wedged in loading past the timeout', () => {
    setLoading('s0_0', 1000)
    const before = getSectorRuntimeState('s0_0')!.generation
    const healed = healStuckRequiredSectors(input(), 1000 + STUCK_LOADING_MS)
    expect(healed).toEqual(['s0_0'])
    const s = getSectorRuntimeState('s0_0')!
    expect(s.lifecycle).toBe('unloaded') // dropped for a fresh reload
    expect(s.generation).toBe(before + 1) // stale callbacks now rejected
    expect(streamingRuntime.metrics.selfHeals).toBe(1)
  })

  it('does not heal a sector still within the timeout', () => {
    setLoading('s0_0', 1000)
    expect(healStuckRequiredSectors(input(), 1000 + STUCK_LOADING_MS - 1)).toEqual([])
    expect(getSectorRuntimeState('s0_0')!.lifecycle).toBe('loading')
  })

  it('does not heal a required sector that is already ready', () => {
    setReady('s0_0')
    expect(healStuckRequiredSectors(input(), 999999)).toEqual([])
    expect(isSectorReadyForGameplay('s0_0')).toBe(true)
  })
})
