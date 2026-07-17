import { beforeEach, describe, expect, it } from 'vitest'
import {
  isPanicking,
  markPanic,
  panicFleeDir,
  panicNearby,
  PANIC_SECONDS,
  resetPanicRuntime,
} from './panicRuntime'

beforeEach(() => resetPanicRuntime())

describe('panic runtime', () => {
  it('marks only citizens within the panic radius', () => {
    const n = panicNearby(
      [0, 0],
      [
        { id: 'near', position: [5, 0] },
        { id: 'far', position: [100, 0] },
      ],
      10,
    )
    expect(n).toBe(1)
    expect(isPanicking('near', 10)).toBe(true)
    expect(isPanicking('far', 10)).toBe(false)
  })

  it('panic expires after the window', () => {
    markPanic('a', [0, 0], 10)
    expect(isPanicking('a', 10 + PANIC_SECONDS - 0.1)).toBe(true)
    expect(isPanicking('a', 10 + PANIC_SECONDS)).toBe(false)
  })

  it('flee direction points away from the threat', () => {
    markPanic('a', [0, 0], 10)
    const dir = panicFleeDir('a', [3, 0], 11)
    expect(dir).not.toBeNull()
    expect(dir![0]).toBeCloseTo(1, 5)
    expect(dir![1]).toBeCloseTo(0, 5)
  })

  it('returns no flee direction when not panicking', () => {
    expect(panicFleeDir('unknown', [0, 0], 10)).toBeNull()
  })
})
