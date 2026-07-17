import { beforeEach, describe, expect, it } from 'vitest'
import { markPanic, resetPanicRuntime, PANIC_SECONDS } from './panicRuntime'
import { panicFleeStep, type FleeState } from './panicFlee'
import type { Vec2 } from '../world/worldTypes'

const identity = (p: Vec2): Vec2 => p

beforeEach(() => resetPanicRuntime())

describe('panicFleeStep', () => {
  it('is a no-op for an actor that is not panicking', () => {
    const s: FleeState = { pos: [5, 5], walking: false, heading: 0 }
    const applied = panicFleeStep(s, 'a', 1.5, 0.1, 100, identity)
    expect(applied).toBe(false)
    expect(s.pos).toEqual([5, 5])
    expect(s.walking).toBe(false)
  })

  it('sprints a panicking actor directly away from the remembered threat', () => {
    // Threat at origin; actor to the +x side flees further +x.
    markPanic('a', [0, 0], 100)
    const s: FleeState = { pos: [5, 0], walking: false, heading: 0 }
    const applied = panicFleeStep(s, 'a', 1.5, 0.1, 101, identity)
    expect(applied).toBe(true)
    expect(s.walking).toBe(true)
    expect(s.pos[0]).toBeGreaterThan(5) // moved away along +x
    expect(s.pos[1]).toBeCloseTo(0, 5)
  })

  it('routes the flee step through the avoid hook (never through a solid)', () => {
    markPanic('a', [0, 0], 100)
    const s: FleeState = { pos: [5, 0], walking: false, heading: 0 }
    panicFleeStep(s, 'a', 1.5, 0.1, 101, () => [42, 42])
    expect(s.pos).toEqual([42, 42])
  })

  it('recovers on its own once the panic window expires (no-op afterward)', () => {
    markPanic('a', [0, 0], 100)
    const s: FleeState = { pos: [5, 0], walking: false, heading: 0 }
    // Still panicking mid-window → moves.
    expect(panicFleeStep(s, 'a', 1.5, 0.1, 100 + PANIC_SECONDS - 0.1, identity)).toBe(true)
    const afterFlee = [...s.pos] as Vec2
    // Past the window → recovery: no more flee, routine movement takes over.
    expect(panicFleeStep(s, 'a', 1.5, 0.1, 100 + PANIC_SECONDS + 0.1, identity)).toBe(false)
    expect(s.pos).toEqual(afterFlee) // untouched by the no-op step
  })
})
