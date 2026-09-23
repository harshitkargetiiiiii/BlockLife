import { beforeEach, describe, expect, it } from 'vitest'
import { perfRuntime, recordFrame } from './perfRuntime'

/**
 * The probe is a RULER. It must not borrow the simulation's `Math.min(delta, 0.05)` guard: that
 * clamp keeps a long frame from tunnelling the physics, but applied to a measurement it pins
 * `frameMs` at 50 and floors `fps` at 20, so a 50 ms frame and a 5 s stall report identically.
 * Retained CI logs were saturated at exactly 49.96–50.00 ms / 20 fps for that reason.
 */
const info = { render: { calls: 1, triangles: 2 }, memory: { geometries: 3, textures: 4 }, programs: [] }

function reset(): void {
  Object.assign(perfRuntime, {
    drawCalls: 0, triangles: 0, geometries: 0, textures: 0, programs: 0,
    frameMs: 0, fps: 0, worstFrameMs: 0, samples: 0,
  })
}

describe('perf probe records the real frame interval', () => {
  beforeEach(reset)

  it('reports a slow frame as it actually was, not clamped to 50 ms', () => {
    recordFrame(info, 500)
    expect(perfRuntime.frameMs, 'first sample is the observation itself').toBe(500)
    expect(perfRuntime.fps, 'and the derived rate follows it below 20').toBeCloseTo(2, 6)
    // The specific value the old clamp produced, which must no longer be the answer.
    expect(perfRuntime.frameMs).not.toBe(50)
    expect(perfRuntime.fps).not.toBe(20)
  })

  it('still smooths, so one slow frame does not swamp the average', () => {
    recordFrame(info, 16)
    for (let i = 0; i < 5; i++) recordFrame(info, 16)
    const steady = perfRuntime.frameMs
    expect(steady).toBeCloseTo(16, 6)
    recordFrame(info, 1016)
    // SMOOTH = 0.1, so the EMA moves by a tenth of the excess and stays readable.
    expect(perfRuntime.frameMs).toBeCloseTo(steady * 0.9 + 1016 * 0.1, 6)
  })

  it('keeps the worst single frame, which the average would hide', () => {
    for (let i = 0; i < 20; i++) recordFrame(info, 16)
    recordFrame(info, 4000)
    for (let i = 0; i < 20; i++) recordFrame(info, 16)
    expect(perfRuntime.worstFrameMs, 'a 4 s stall survives the smoothing').toBe(4000)
    expect(perfRuntime.frameMs, 'while the average settles back down').toBeLessThan(1000)
    // This is the distinction the retained CI evidence could not make.
    expect(perfRuntime.worstFrameMs / perfRuntime.frameMs).toBeGreaterThan(2)
  })

  /**
   * LIMIT, stated so the pair is not over-read: an EMA plus a lifetime maximum is NOT a distribution
   * and does not in general separate persistent slowness from intermittent stalling. The EMA is
   * recency-weighted, so an early stall decays out of it entirely; the maximum keeps exactly one
   * frame, forever, with no count and no idea when it happened. A run of many moderate stalls and a
   * uniformly slow run can land on a similar pair. What this test shows is narrower and is all that
   * is claimed: on these two synthetic shapes the ratio differs, so the pair carries SOME signal the
   * EMA alone did not. Actually separating the two needs a distribution — frame-time percentiles, or
   * a count of frames over a threshold — which this probe does not collect.
   */
  it('separates these two synthetic shapes by the worst-to-average ratio', () => {
    for (let i = 0; i < 40; i++) recordFrame(info, 200)
    const uniform = { frameMs: perfRuntime.frameMs, worst: perfRuntime.worstFrameMs }
    reset()
    for (let i = 0; i < 39; i++) recordFrame(info, 16)
    recordFrame(info, 7000)
    const stalled = { frameMs: perfRuntime.frameMs, worst: perfRuntime.worstFrameMs }
    expect(uniform.worst / uniform.frameMs, 'uniformly slow: worst tracks the average').toBeLessThan(1.1)
    expect(stalled.worst / stalled.frameMs, 'one late stall: worst dwarfs it').toBeGreaterThan(5)
    // ...and the counter-example that keeps the claim honest: a stall EARLY in a long run decays out
    // of the EMA, leaving a ratio that looks just like the stalled case above even though the run
    // then proceeded at a steady 16 ms. The pair alone cannot tell these apart.
    reset()
    recordFrame(info, 7000)
    for (let i = 0; i < 200; i++) recordFrame(info, 16)
    const earlyStall = perfRuntime.worstFrameMs / perfRuntime.frameMs
    expect(earlyStall, 'an early stall is indistinguishable from a late one by this pair')
      .toBeGreaterThan(5)
  })

  it('carries the renderer counters through untouched', () => {
    recordFrame(info, 16)
    expect([perfRuntime.drawCalls, perfRuntime.triangles, perfRuntime.geometries, perfRuntime.textures])
      .toEqual([1, 2, 3, 4])
    expect(perfRuntime.samples).toBe(1)
  })
})
