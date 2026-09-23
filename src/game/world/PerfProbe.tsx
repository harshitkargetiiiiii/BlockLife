import { useEffect } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import { recordFrame } from './perfRuntime'
import { materialProbe } from './materialProbe'

/**
 * Mounts once inside the Canvas (issue #21 §12): folds the renderer's per-frame
 * `info` (draw calls, triangles, geometry/texture counts) plus the real clamped
 * frame delta into `perfRuntime`, which the DEV test API reads for the perf report.
 * Cheap — a handful of scalar reads per frame, no allocations, no React state.
 */
export function PerfProbe() {
  const gl = useThree((s) => s.gl)
  const scene = useThree((s) => s.scene)
  // DEV-only: hand the live scene root to the material probe so the test API can count
  // unique THREE.Material objects (gl.info reports geometry/texture counts, not materials).
  useEffect(() => {
    if (!import.meta.env.DEV) return
    materialProbe.scene = scene
    return () => {
      if (materialProbe.scene === scene) materialProbe.scene = null
    }
  }, [scene])
  useFrame((_, delta) => {
    // The REAL frame interval, unclamped (CONVENTIONS #1 says never a hardcoded 1/60 — headless E2E
    // runs slow). This deliberately does NOT apply the simulation's `Math.min(delta, 0.05)` guard:
    // that clamp protects the physics from a long frame, and clamping the RULER instead pinned
    // `frameMs` at 50 and `fps` at 20, so a 50 ms frame and a 5 s stall reported identically.
    recordFrame(gl.info, delta * 1000)
  })
  return null
}
