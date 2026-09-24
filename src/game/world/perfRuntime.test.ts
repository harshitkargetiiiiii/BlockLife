import { beforeEach, describe, expect, it } from 'vitest'
import { FRAME_MS_BUCKETS, FRAME_MS_BUCKET_LABELS, bucketIndexFor, perfRuntime, recordFrame, recordGlContext } from './perfRuntime'

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
    frameMsBuckets: FRAME_MS_BUCKETS.map(() => 0),
    elapsedMs: 0, windowStartMs: null, windowEndMs: null, hiddenFrames: 0,
    gl: { vendor: null, renderer: null, unmaskedVendor: null, unmaskedRenderer: null, debugRendererInfo: 'not-captured', version: null },
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

describe('frame-time histogram', () => {
  beforeEach(reset)

  it('bucket bounds are ascending, finite except the last, and fixed in width', () => {
    expect(FRAME_MS_BUCKETS.length).toBeGreaterThan(3)
    for (let i = 1; i < FRAME_MS_BUCKETS.length; i++) {
      expect(FRAME_MS_BUCKETS[i], `bound ${i} exceeds bound ${i - 1}`).toBeGreaterThan(FRAME_MS_BUCKETS[i - 1])
    }
    expect(FRAME_MS_BUCKETS.at(-1), 'the last bucket is unbounded').toBe(Infinity)
    expect(FRAME_MS_BUCKETS.slice(0, -1).every(Number.isFinite), 'every other bound is finite').toBe(true)
    // Constant memory: one counter per bound, no matter how long the run is.
    expect(perfRuntime.frameMsBuckets).toHaveLength(FRAME_MS_BUCKETS.length)
    // Labels exist for every bucket, because JSON turns the unbounded bound into `null` and a CI
    // reader should not have to guess whether that means "missing" or "no upper limit".
    expect(FRAME_MS_BUCKET_LABELS).toHaveLength(FRAME_MS_BUCKETS.length)
    expect(FRAME_MS_BUCKET_LABELS[0]).toBe('0-8ms')
    expect(FRAME_MS_BUCKET_LABELS.at(-1)).toBe('>2000ms')
    expect(JSON.parse(JSON.stringify(FRAME_MS_BUCKETS)).at(-1), 'the bound itself JSONs to null').toBeNull()
  })

  it('buckets are UPPER-INCLUSIVE at every boundary', () => {
    for (let i = 0; i < FRAME_MS_BUCKETS.length - 1; i++) {
      const bound = FRAME_MS_BUCKETS[i]
      expect(bucketIndexFor(bound), `exactly ${bound} ms falls in the <= ${bound} bucket`).toBe(i)
      expect(bucketIndexFor(bound + 0.001), `just over ${bound} ms falls in the next bucket`).toBe(i + 1)
      if (i > 0) {
        expect(bucketIndexFor(FRAME_MS_BUCKETS[i - 1] + 0.001), 'just over the previous bound').toBe(i)
      }
    }
    // Anything above the last finite bound lands in the unbounded bucket, never out of range.
    const last = FRAME_MS_BUCKETS.length - 1
    expect(bucketIndexFor(1e9)).toBe(last)
    expect(bucketIndexFor(Infinity)).toBe(last)
    // A zero or negative delta is still counted, in the first bucket, never dropped.
    expect(bucketIndexFor(0)).toBe(0)
    expect(bucketIndexFor(-5)).toBe(0)
  })

  it('bucket counts always total the frame count, and elapsed totals the deltas', () => {
    const deltas = [4, 8, 8.0001, 16, 20, 33, 49.9, 50, 51, 120, 300, 900, 1500, 2000, 5000, 0]
    for (const d of deltas) recordFrame(info, d)
    const total = perfRuntime.frameMsBuckets.reduce((a, b) => a + b, 0)
    expect(total, 'every frame landed in exactly one bucket').toBe(deltas.length)
    expect(perfRuntime.samples, 'and the total equals the frame count').toBe(deltas.length)
    expect(perfRuntime.elapsedMs).toBeCloseTo(deltas.reduce((a, b) => a + b, 0), 6)
    expect(perfRuntime.worstFrameMs).toBe(5000)
  })

  it('separates a startup window from a later one, and counts hidden frames', () => {
    recordFrame(info, 900, { nowMs: 1_000, hidden: false })
    recordFrame(info, 850, { nowMs: 2_000, hidden: true })
    recordFrame(info, 16, { nowMs: 3_000, hidden: true })
    expect(perfRuntime.windowStartMs, 'first sample pins the window start').toBe(1_000)
    expect(perfRuntime.windowEndMs, 'and the latest sample its end').toBe(3_000)
    expect(perfRuntime.hiddenFrames, 'background frames are counted separately').toBe(2)
    // A window that begins at page time ~0 is a startup burst; one beginning later is not. The
    // probe records the position rather than deciding which it was.
    expect(perfRuntime.windowEndMs! - perfRuntime.windowStartMs!).toBe(2_000)
  })

  it('a slow EMA plus the histogram distinguishes what the EMA alone cannot', () => {
    // Mostly-fast run with two long stalls: the EMA can be dragged up, but the distribution shows
    // that the great majority of frames were fast.
    for (let i = 0; i < 100; i++) recordFrame(info, 16)
    recordFrame(info, 3000)
    recordFrame(info, 3000)
    const fast = perfRuntime.frameMsBuckets[bucketIndexFor(16)]
    const slow = perfRuntime.frameMsBuckets[bucketIndexFor(3000)]
    expect(fast).toBe(100)
    expect(slow).toBe(2)
    expect(slow / perfRuntime.samples, 'stalls are a small share of frames').toBeLessThan(0.02)
  })
})

describe('GL context reporting', () => {
  beforeEach(reset)

  const base = {
    VENDOR: 1, RENDERER: 2, VERSION: 3,
    getParameter(k: number) { return { 1: 'MaskedVendor', 2: 'MaskedRenderer', 3: 'WebGL 2.0' }[k] ?? null },
  }

  it('reports the unmasked strings when the extension is available', () => {
    recordGlContext({
      ...base,
      getParameter(k: number) {
        return { 1: 'MaskedVendor', 2: 'MaskedRenderer', 3: 'WebGL 2.0', 10: 'Google Inc.', 11: 'ANGLE (SwiftShader)' }[k] ?? null
      },
      getExtension: () => ({ UNMASKED_VENDOR_WEBGL: 10, UNMASKED_RENDERER_WEBGL: 11 }),
    } as unknown as WebGL2RenderingContext)
    expect(perfRuntime.gl.debugRendererInfo).toBe('available')
    expect(perfRuntime.gl.unmaskedRenderer).toBe('ANGLE (SwiftShader)')
    expect(perfRuntime.gl.unmaskedVendor).toBe('Google Inc.')
    expect(perfRuntime.gl.renderer).toBe('MaskedRenderer')
  })

  it('says "unavailable" rather than leaving the unmasked fields ambiguously null', () => {
    recordGlContext({ ...base, getExtension: () => null } as unknown as WebGL2RenderingContext)
    expect(perfRuntime.gl.debugRendererInfo, 'the gap is explicit').toBe('unavailable')
    expect(perfRuntime.gl.unmaskedRenderer).toBeNull()
    // The masked strings it WILL give are still recorded, so the report is not empty.
    expect(perfRuntime.gl.renderer).toBe('MaskedRenderer')
    expect(perfRuntime.gl.version).toBe('WebGL 2.0')
  })

  /**
   * The isolated cases below each start from a cleared runtime, so none of them can catch a capture
   * that LEAVES an earlier reading standing. These run captures back to back, which is the shape the
   * probe actually has: its effect re-runs whenever the renderer identity changes.
   */
  it('a later, less informative capture never leaves the earlier renderer standing', () => {
    const full = {
      ...base,
      getParameter(k: number) {
        return { 1: 'MaskedVendor', 2: 'MaskedRenderer', 3: 'WebGL 2.0', 10: 'Google Inc.', 11: 'ANGLE (SwiftShader)' }[k] ?? null
      },
      getExtension: () => ({ UNMASKED_VENDOR_WEBGL: 10, UNMASKED_RENDERER_WEBGL: 11 }),
    } as unknown as WebGL2RenderingContext

    // 1. available -> null context. Nothing may survive, masked or unmasked.
    recordGlContext(full)
    expect(perfRuntime.gl.unmaskedRenderer).toBe('ANGLE (SwiftShader)')
    recordGlContext(null)
    expect(perfRuntime.gl.debugRendererInfo).toBe('unavailable')
    expect(perfRuntime.gl.unmaskedRenderer, 'a null context keeps no renderer').toBeNull()
    expect(perfRuntime.gl.unmaskedVendor).toBeNull()
    expect(perfRuntime.gl.renderer, 'nor the masked strings').toBeNull()
    expect(perfRuntime.gl.vendor).toBeNull()
    expect(perfRuntime.gl.version).toBeNull()

    // 2. available -> extension gone. The masked strings are THIS context's and stay; the unmasked
    //    ones belonged to the previous capture and must not.
    recordGlContext(full)
    recordGlContext({ ...base, getExtension: () => null } as unknown as WebGL2RenderingContext)
    expect(perfRuntime.gl.debugRendererInfo).toBe('unavailable')
    expect(perfRuntime.gl.unmaskedRenderer, 'stale unmasked renderer cleared').toBeNull()
    expect(perfRuntime.gl.unmaskedVendor, 'stale unmasked vendor cleared').toBeNull()
    expect(perfRuntime.gl.renderer, "this context's masked string is reported").toBe('MaskedRenderer')

    // 3. available -> throwing query. Same rule.
    recordGlContext(full)
    recordGlContext({
      ...base,
      getExtension: () => { throw new Error('blocked') },
    } as unknown as WebGL2RenderingContext)
    expect(perfRuntime.gl.debugRendererInfo).toBe('unavailable')
    expect(perfRuntime.gl.unmaskedRenderer).toBeNull()

    // 4. ...and a recapture that CAN read it repopulates, so the reset is not sticky.
    recordGlContext(full)
    expect(perfRuntime.gl.debugRendererInfo).toBe('available')
    expect(perfRuntime.gl.unmaskedRenderer).toBe('ANGLE (SwiftShader)')
  })

  it('a second context replaces the first rather than merging with it', () => {
    recordGlContext({
      ...base,
      getParameter: (k: number) => ({ 1: 'V1', 2: 'R1', 3: 'WebGL 2.0', 10: 'UV1', 11: 'UR1' }[k] ?? null),
      getExtension: () => ({ UNMASKED_VENDOR_WEBGL: 10, UNMASKED_RENDERER_WEBGL: 11 }),
    } as unknown as WebGL2RenderingContext)
    recordGlContext({
      ...base,
      getParameter: (k: number) => ({ 1: 'V2', 2: 'R2', 3: 'WebGL 1.0' }[k] ?? null),
      getExtension: () => null,
    } as unknown as WebGL2RenderingContext)
    expect([perfRuntime.gl.vendor, perfRuntime.gl.renderer, perfRuntime.gl.version]).toEqual(['V2', 'R2', 'WebGL 1.0'])
    expect([perfRuntime.gl.unmaskedVendor, perfRuntime.gl.unmaskedRenderer]).toEqual([null, null])
  })

  it('survives a missing context and a throwing extension query', () => {
    recordGlContext(null)
    expect(perfRuntime.gl.debugRendererInfo).toBe('unavailable')
    reset()
    recordGlContext({
      ...base,
      getExtension: () => { throw new Error('blocked') },
    } as unknown as WebGL2RenderingContext)
    expect(perfRuntime.gl.debugRendererInfo).toBe('unavailable')
    expect(perfRuntime.gl.renderer).toBe('MaskedRenderer')
  })
})
