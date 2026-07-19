import { useFrame } from '@react-three/fiber'
import { tickIntegrity } from './integrityRuntime'

/**
 * Drives the observe-only integrity scan on the frame loop (DEV only — mounted
 * behind `import.meta.env.DEV` in CanvasRoot). Uses the REAL clamped delta so
 * the ~4 Hz throttle survives slow headless E2E frames (CONVENTIONS gotcha #1),
 * and never throws out of `useFrame` (gotcha #13) — a detector failure becomes a
 * console diagnostic, never a frozen game loop.
 */
export function IntegritySystem() {
  useFrame((_, rawDelta) => {
    const dt = Math.min(rawDelta, 0.1)
    try {
      tickIntegrity(dt)
    } catch (err) {
      if (import.meta.env.DEV) console.error('[integrity] scan failed', err)
    }
  })
  return null
}
