/**
 * Render-stats probe (issue #21 §12). A module singleton updated once per frame from
 * the R3F renderer's `info`, read by the DEV test API for the before/after performance
 * report. Stores scalars only (draw calls, triangles, resource counts, smoothed frame
 * time) — never scene objects — so it survives sector streaming like the other runtimes.
 */
export interface RenderStats {
  drawCalls: number
  triangles: number
  geometries: number
  textures: number
  programs: number
  /** Exponentially-smoothed frame time (ms) and derived FPS. */
  frameMs: number
  fps: number
  /** Longest single frame observed since load (ms). The EMA above smooths a stall away;
   *  this does not, so a report can tell "uniformly slow" from "stalled for a moment". */
  worstFrameMs: number
  /** Frames observed since load — lets a test wait for a stable sample. */
  samples: number
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
}

const SMOOTH = 0.1

interface ThreeInfo {
  render: { calls: number; triangles: number }
  memory: { geometries: number; textures: number }
  programs?: readonly unknown[] | null
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
export function recordFrame(info: ThreeInfo, dtMs: number): void {
  const p = perfRuntime
  p.drawCalls = info.render.calls
  p.triangles = info.render.triangles
  p.geometries = info.memory.geometries
  p.textures = info.memory.textures
  p.programs = info.programs?.length ?? p.programs
  p.frameMs = p.samples === 0 ? dtMs : p.frameMs * (1 - SMOOTH) + dtMs * SMOOTH
  p.fps = p.frameMs > 0 ? 1000 / p.frameMs : 0
  if (dtMs > p.worstFrameMs) p.worstFrameMs = dtMs
  p.samples++
}
