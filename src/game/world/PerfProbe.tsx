import { useEffect } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import { recordFrame, recordGlContext } from './perfRuntime'
import { materialProbe } from './materialProbe'

/**
 * Mounts once inside the Canvas (issue #21 §12): folds the renderer's per-frame
 * `info` (draw calls, triangles, geometry/texture counts) plus the real frame
 * interval into `perfRuntime`, which the DEV test API reads for the perf report.
 * Cheap — a handful of scalar reads per frame, no allocations, no React state,
 * no logging, and a fixed-size histogram rather than a list of frames.
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
  // Identify the pipeline actually being measured. This reads THE GAME'S OWN context — the one R3F
  // draws the scene with — because a separately created canvas or context can resolve to a
  // different backend and would describe something other than what the numbers above came from.
  useEffect(() => {
    try {
      recordGlContext(gl.getContext())
    } catch {
      recordGlContext(null)
    }
  }, [gl])
  useFrame((_, delta) => {
    // The REAL frame interval, unclamped (CONVENTIONS #1 says never a hardcoded 1/60 — headless E2E
    // runs slow). This deliberately does NOT apply the simulation's `Math.min(delta, 0.05)` guard:
    // that clamp protects the physics from a long frame, and clamping the RULER instead pinned
    // `frameMs` at 50 and `fps` at 20, so a 50 ms frame and a 5 s stall reported identically.
    recordFrame(gl.info, delta * 1000, {
      nowMs: typeof performance !== 'undefined' ? performance.now() : undefined,
      // A hidden page is throttled by the browser; without this, background frames are
      // indistinguishable from a slow renderer.
      hidden: typeof document !== 'undefined' ? document.visibilityState === 'hidden' : undefined,
    })
  })
  return null
}
