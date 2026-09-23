import { beforeEach, describe, expect, it } from 'vitest'
import ReactThreeTestRenderer from '@react-three/test-renderer'
import { PerfProbe } from './PerfProbe'
import { perfRuntime } from './perfRuntime'

/**
 * The defect lived at the CALLBACK BOUNDARY, not inside `recordFrame`: `PerfProbe` was folding the
 * simulation's `Math.min(delta, 0.05)` guard into the measurement before handing it over, so
 * `recordFrame` only ever saw values ≤ 50 ms and could not have reported otherwise however correct
 * it was. Unit tests on `recordFrame` alone cannot catch that — they supply the number themselves.
 *
 * This drives the real component through the real `useFrame` with a controlled delta and asserts on
 * what actually arrived. Reverting `PerfProbe` to `Math.min(delta, 0.05) * 1000` must fail this.
 */
function reset(): void {
  Object.assign(perfRuntime, {
    drawCalls: 0, triangles: 0, geometries: 0, textures: 0, programs: 0,
    frameMs: 0, fps: 0, worstFrameMs: 0, samples: 0,
  })
}

describe('PerfProbe hands recordFrame the real delta', () => {
  beforeEach(reset)

  it('a frame slower than the 0.05 s simulation clamp arrives unclamped', async () => {
    const renderer = await ReactThreeTestRenderer.create(<PerfProbe />)
    // 0.5 s — ten times the simulation's anti-tunnelling clamp.
    await renderer.advanceFrames(1, 0.5)
    expect(perfRuntime.samples, 'the probe ran').toBeGreaterThan(0)
    // The first sample is the observation itself, so this reads the delta that crossed the boundary.
    expect(perfRuntime.frameMs, 'the probe received 500 ms, not the clamp').toBeCloseTo(500, 3)
    // The exact values the old `Math.min(delta, 0.05)` produced, which must no longer appear.
    expect(perfRuntime.frameMs).not.toBeCloseTo(50, 3)
    expect(Math.round(perfRuntime.fps)).not.toBe(20)
    await renderer.unmount()
  })

  it('a multi-second stall is reported at its real length', async () => {
    const renderer = await ReactThreeTestRenderer.create(<PerfProbe />)
    await renderer.advanceFrames(1, 3)
    expect(perfRuntime.worstFrameMs, 'a 3 s frame is visible as 3 s').toBeCloseTo(3000, 2)
    expect(perfRuntime.worstFrameMs, 'and not flattened to the clamp').toBeGreaterThan(50)
    await renderer.unmount()
  })

  it('a fast frame is passed through unchanged, so the fix is not a scale factor', async () => {
    const renderer = await ReactThreeTestRenderer.create(<PerfProbe />)
    await renderer.advanceFrames(1, 0.016)
    expect(perfRuntime.frameMs, '16 ms stays 16 ms').toBeCloseTo(16, 3)
    await renderer.unmount()
  })
})
