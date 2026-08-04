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
  samples: 0,
}

const SMOOTH = 0.1

interface ThreeInfo {
  render: { calls: number; triangles: number }
  memory: { geometries: number; textures: number }
  programs?: readonly unknown[] | null
}

/** Fold one rendered frame's stats in. `dtMs` MUST be the real clamped frame delta
 *  (headless E2E runs slow — a hardcoded 1/60 would report a fake FPS). */
export function recordFrame(info: ThreeInfo, dtMs: number): void {
  const p = perfRuntime
  p.drawCalls = info.render.calls
  p.triangles = info.render.triangles
  p.geometries = info.memory.geometries
  p.textures = info.memory.textures
  p.programs = info.programs?.length ?? p.programs
  p.frameMs = p.samples === 0 ? dtMs : p.frameMs * (1 - SMOOTH) + dtMs * SMOOTH
  p.fps = p.frameMs > 0 ? 1000 / p.frameMs : 0
  p.samples++
}
