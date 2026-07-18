import { describe, expect, it } from 'vitest'
import {
  breachCountdown,
  containmentPositions,
  freshContainment,
  resetContainment,
  stepContainment,
  CONTAIN_SECONDS,
  RESPOND_SECONDS,
  WARNING_SECONDS,
  type ContainmentContext,
} from './containmentLogic'

/** Advance the machine by `seconds` in fixed 0.05s ticks (real clamped delta),
 *  returning how many forced-exit signals fired across the span. */
function run(
  state: ReturnType<typeof freshContainment>,
  ctx: ContainmentContext,
  seconds: number,
): number {
  let exits = 0
  const step = 0.05
  for (let t = 0; t < seconds; t += step) {
    if (stepContainment(state, ctx, step).forceExit) exits++
  }
  return exits
}

describe('containment phase machine', () => {
  it('stays none with no wanted robbery inside', () => {
    const s = freshContainment()
    run(s, { activeStoreId: null, respondersOnScene: false }, 30)
    expect(s.phase).toBe('none')
    expect(s.storeId).toBeNull()
  })

  it('walks none → responding → contained → warning → breached and forces exit once', () => {
    const s = freshContainment()
    const ctx: ContainmentContext = { activeStoreId: 'store_a', respondersOnScene: false }

    // First tick enters responding immediately.
    expect(stepContainment(s, ctx, 0.05).forceExit).toBe(false)
    expect(s.phase).toBe('responding')
    expect(s.storeId).toBe('store_a')

    // Fallback response time (no responders) → contained.
    run(s, ctx, RESPOND_SECONDS)
    expect(s.phase).toBe('contained')

    // Containment window → warning.
    run(s, ctx, CONTAIN_SECONDS)
    expect(s.phase).toBe('warning')

    // Warning window → exactly one breach forced-exit, then terminal.
    const exits = run(s, ctx, WARNING_SECONDS + 2)
    expect(exits).toBe(1)
    expect(s.phase).toBe('breached')
    expect(s.breached).toBe(true)
  })

  it('contains sooner when responders arrive before the fallback time', () => {
    const s = freshContainment()
    // One tick to enter responding without responders...
    stepContainment(s, { activeStoreId: 'store_a', respondersOnScene: false }, 0.05)
    expect(s.phase).toBe('responding')
    // ...then a responder on scene contains on the next tick (well under RESPOND_SECONDS).
    stepContainment(s, { activeStoreId: 'store_a', respondersOnScene: true }, 0.05)
    expect(s.phase).toBe('contained')
  })

  it('breach fires exactly once even if stepped long past the warning', () => {
    const s = freshContainment()
    const ctx: ContainmentContext = { activeStoreId: 'store_a', respondersOnScene: true }
    const exits = run(s, ctx, RESPOND_SECONDS + CONTAIN_SECONDS + WARNING_SECONDS + 30)
    expect(exits).toBe(1)
    expect(s.phase).toBe('breached')
  })

  it('stands down and resets when the player leaves the store', () => {
    const s = freshContainment()
    run(s, { activeStoreId: 'store_a', respondersOnScene: true }, RESPOND_SECONDS + 1)
    expect(s.phase).toBe('contained')
    // Leaving (activeStoreId null) resets to none.
    stepContainment(s, { activeStoreId: null, respondersOnScene: false }, 0.05)
    expect(s.phase).toBe('none')
    expect(s.storeId).toBeNull()
    expect(s.breached).toBe(false)
  })

  it('restarts the flow deterministically when switching stores', () => {
    const s = freshContainment()
    run(s, { activeStoreId: 'store_a', respondersOnScene: true }, RESPOND_SECONDS + 1)
    expect(s.phase).toBe('contained')
    // A different store re-arms from responding.
    stepContainment(s, { activeStoreId: 'store_b', respondersOnScene: false }, 0.05)
    expect(s.phase).toBe('responding')
    expect(s.storeId).toBe('store_b')
    expect(s.phaseSeconds).toBeCloseTo(0.05, 5)
  })

  it('breachCountdown counts down only in warning', () => {
    const s = freshContainment()
    expect(breachCountdown(s)).toBeNull()
    const ctx: ContainmentContext = { activeStoreId: 'store_a', respondersOnScene: true }
    run(s, ctx, RESPOND_SECONDS + CONTAIN_SECONDS + 0.1)
    expect(s.phase).toBe('warning')
    const c = breachCountdown(s)
    expect(c).not.toBeNull()
    expect(c!).toBeGreaterThan(0)
    expect(c!).toBeLessThanOrEqual(WARNING_SECONDS)
  })

  it('resetContainment clears every field', () => {
    const s = freshContainment()
    run(s, { activeStoreId: 'store_a', respondersOnScene: true }, RESPOND_SECONDS + 1)
    resetContainment(s)
    expect(s).toEqual(freshContainment())
  })
})

describe('containment positions', () => {
  it('returns three deterministic spread positions ahead of the entrance', () => {
    const entrance: [number, number] = [10, -20]
    const heading = Math.PI // faces -z (south→north into door): sin=0, cos=-1
    const pts = containmentPositions(entrance, heading)
    expect(pts).toHaveLength(3)
    // All ahead of the door (dead-ahead point differs from the entrance).
    expect(pts[0][0]).toBeCloseTo(10, 5)
    expect(pts[0][1]).toBeCloseTo(-23.5, 5)
    // The two flanks are mirrored across the dead-ahead point.
    const midX = (pts[1][0] + pts[2][0]) / 2
    const midZ = (pts[1][1] + pts[2][1]) / 2
    expect(midX).toBeCloseTo(pts[0][0], 5)
    expect(midZ).toBeCloseTo(pts[0][1], 5)
    // Deterministic: same inputs → same output.
    expect(containmentPositions(entrance, heading)).toEqual(pts)
  })
})
