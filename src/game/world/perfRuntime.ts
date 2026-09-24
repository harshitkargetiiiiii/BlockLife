/**
 * Render-stats probe (issue #21 §12). A module singleton updated once per frame from
 * the R3F renderer's `info`, read by the DEV test API for the before/after performance
 * report. Stores scalars only (draw calls, triangles, resource counts, smoothed frame
 * time) — never scene objects — so it survives sector streaming like the other runtimes.
 *
 * Constant memory by construction: the frame-time distribution is a fixed set of counters, never a
 * list of frames, and nothing here logs per frame.
 */

/** Upper bounds (ms, inclusive) of the frame-time histogram. The last bucket is unbounded. */
export const FRAME_MS_BUCKETS: readonly number[] = [8, 16, 33, 50, 100, 250, 500, 1000, 2000, Infinity]

/** Human-readable bucket names. `JSON.stringify` turns `Infinity` into `null`, which a reader of a
 *  CI log could easily take for "missing" rather than "unbounded" — these labels remove the doubt. */
export const FRAME_MS_BUCKET_LABELS: readonly string[] = FRAME_MS_BUCKETS.map((upper, i) => {
  const lower = i === 0 ? 0 : FRAME_MS_BUCKETS[i - 1]
  return Number.isFinite(upper) ? `${lower}-${upper}ms` : `>${lower}ms`
})

/** What the game's own WebGL context says it is. Captured once, never per frame. */
export interface GlContextInfo {
  vendor: string | null
  renderer: string | null
  /** From WEBGL_debug_renderer_info, which is the only way to see past the masked strings. */
  unmaskedVendor: string | null
  unmaskedRenderer: string | null
  /** Explicit, so "we could not read it" is never confused with "it said nothing". */
  debugRendererInfo: 'available' | 'unavailable' | 'not-captured'
  version: string | null
}

export interface RenderStats {
  drawCalls: number
  triangles: number
  geometries: number
  textures: number
  programs: number
  /** Exponentially-smoothed frame time (ms) and derived FPS. Recency-weighted: this describes
   *  RECENT frames, not the run as a whole. The histogram below is what describes the run. */
  frameMs: number
  fps: number
  /** Longest single frame observed since load (ms). */
  worstFrameMs: number
  /** Frames observed since load — lets a test wait for a stable sample, and is the histogram total. */
  samples: number
  /** Counts per `FRAME_MS_BUCKETS` bucket. Fixed length, so memory does not grow with runtime. */
  frameMsBuckets: number[]
  /** Summed frame time (ms) — the simulated/rendered span the samples cover. */
  elapsedMs: number
  /** `performance.now()` at the first and most recent sample: WHERE in the page's life the window
   *  sits, so a startup burst is distinguishable from a steady-state stretch. */
  windowStartMs: number | null
  windowEndMs: number | null
  /** Frames recorded while the page was hidden — background throttling looks like slowness. */
  hiddenFrames: number
  /** The game's own GL context, captured once from the renderer R3F actually draws with. */
  gl: GlContextInfo
}

function emptyBuckets(): number[] {
  return FRAME_MS_BUCKETS.map(() => 0)
}

export const perfRuntime: RenderStats = {
  drawCalls: 0,
  triangles: 0,
  geometries: 0,
  textures: 0,
  programs: 0,
  frameMs: 0,
  fps: 0,
  worstFrameMs: 0,
  samples: 0,
  frameMsBuckets: emptyBuckets(),
  elapsedMs: 0,
  windowStartMs: null,
  windowEndMs: null,
  hiddenFrames: 0,
  gl: {
    vendor: null,
    renderer: null,
    unmaskedVendor: null,
    unmaskedRenderer: null,
    debugRendererInfo: 'not-captured',
    version: null,
  },
}

const SMOOTH = 0.1

interface ThreeInfo {
  render: { calls: number; triangles: number }
  memory: { geometries: number; textures: number }
  programs?: readonly unknown[] | null
}

/** Per-frame context the probe knows and this module should not reach out for. */
export interface FrameContext {
  /** `performance.now()` for this frame. */
  nowMs?: number
  /** Whether the page was hidden when the frame ran. */
  hidden?: boolean
}

/** Index of the bucket a frame time falls in. Buckets are UPPER-INCLUSIVE: a frame of exactly
 *  16 ms lands in the `<= 16` bucket, not the next one. */
export function bucketIndexFor(dtMs: number): number {
  for (let i = 0; i < FRAME_MS_BUCKETS.length; i++) {
    if (dtMs <= FRAME_MS_BUCKETS[i]) return i
  }
  return FRAME_MS_BUCKETS.length - 1
}

/** Fold one rendered frame's stats in. `dtMs` MUST be the REAL, UNCLAMPED frame interval.
 *
 *  Two different mistakes are possible here and this probe has to avoid both. A hardcoded 1/60
 *  reports a fake FPS (headless E2E runs slow). But so does the simulation's own `Math.min(delta,
 *  0.05)` guard: that clamp exists to stop a long frame tunnelling the physics, and feeding it to a
 *  MEASUREMENT pins `frameMs` at 50 and floors `fps` at 20 — the instrument then reads exactly the
 *  same whether a frame took 50 ms or 5 s. CI reports were saturated at 49.96–50.00 ms / 20 fps for
 *  precisely that reason, which made them useless for telling a slow runner from a stalled one.
 *  Clamp the simulation, never the ruler. */
export function recordFrame(info: ThreeInfo, dtMs: number, ctx: FrameContext = {}): void {
  const p = perfRuntime
  p.drawCalls = info.render.calls
  p.triangles = info.render.triangles
  p.geometries = info.memory.geometries
  p.textures = info.memory.textures
  p.programs = info.programs?.length ?? p.programs
  p.frameMs = p.samples === 0 ? dtMs : p.frameMs * (1 - SMOOTH) + dtMs * SMOOTH
  p.fps = p.frameMs > 0 ? 1000 / p.frameMs : 0
  if (dtMs > p.worstFrameMs) p.worstFrameMs = dtMs
  p.frameMsBuckets[bucketIndexFor(dtMs)]++
  p.elapsedMs += dtMs
  if (ctx.nowMs != null) {
    if (p.windowStartMs == null) p.windowStartMs = ctx.nowMs
    p.windowEndMs = ctx.nowMs
  }
  if (ctx.hidden === true) p.hiddenFrames++
  p.samples++
}

/** Reset the context block. Every capture starts here so a later, less informative capture can
 *  never leave an earlier renderer standing: a null context, a missing extension or a throwing
 *  query would otherwise keep strings describing a pipeline that is no longer the one in use. */
function clearGlContext(): void {
  const c = perfRuntime.gl
  c.vendor = null
  c.renderer = null
  c.unmaskedVendor = null
  c.unmaskedRenderer = null
  c.version = null
  c.debugRendererInfo = 'not-captured'
}

/** Record what the game's OWN WebGL context reports, with the context R3F actually renders into —
 *  reading a separate canvas or a fresh context would describe a different pipeline than the one
 *  being measured.
 *
 *  Safe to call more than once (the renderer identity can change): each call CLEARS the previous
 *  reading first and then reports only what THIS context provides. */
export function recordGlContext(gl: WebGLRenderingContext | WebGL2RenderingContext | null): void {
  clearGlContext()
  const c = perfRuntime.gl
  if (!gl) {
    c.debugRendererInfo = 'unavailable'
    return
  }
  const read = (k: number): string | null => {
    try {
      const v = gl.getParameter(k) as unknown
      return typeof v === 'string' ? v : null
    } catch {
      return null
    }
  }
  c.vendor = read(gl.VENDOR)
  c.renderer = read(gl.RENDERER)
  c.version = read(gl.VERSION)
  let ext: { UNMASKED_VENDOR_WEBGL: number; UNMASKED_RENDERER_WEBGL: number } | null = null
  try {
    ext = gl.getExtension('WEBGL_debug_renderer_info')
  } catch {
    ext = null
  }
  if (!ext) {
    // The masked strings above are all this browser will say. Report the gap rather than leaving
    // the unmasked fields null and letting a reader assume the query simply returned nothing.
    // They are already null from the reset, so nothing from an earlier capture survives here.
    c.debugRendererInfo = 'unavailable'
    return
  }
  c.debugRendererInfo = 'available'
  c.unmaskedVendor = read(ext.UNMASKED_VENDOR_WEBGL)
  c.unmaskedRenderer = read(ext.UNMASKED_RENDERER_WEBGL)
}
