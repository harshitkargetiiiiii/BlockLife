import { useFrame, useThree } from '@react-three/fiber'
import { recordFrame } from './perfRuntime'

/**
 * Mounts once inside the Canvas (issue #21 §12): folds the renderer's per-frame
 * `info` (draw calls, triangles, geometry/texture counts) plus the real clamped
 * frame delta into `perfRuntime`, which the DEV test API reads for the perf report.
 * Cheap — a handful of scalar reads per frame, no allocations, no React state.
 */
export function PerfProbe() {
  const gl = useThree((s) => s.gl)
  useFrame((_, delta) => {
    // Real clamped delta (CONVENTIONS #1) — headless E2E runs slow; never 1/60.
    recordFrame(gl.info, Math.min(delta, 0.05) * 1000)
  })
  return null
}
