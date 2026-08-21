import { useEffect } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import { renderSuppressor } from './renderSuppressor'

/**
 * DEV/TEST-ONLY. Mounted once inside the Canvas behind `import.meta.env.DEV`. Hands the live R3F
 * root scene to `renderSuppressor` and drives its per-frame `tick()` (auto-engage-after-settle +
 * visibility re-assert). Its `useFrame` subscription is itself proof the R3F loop keeps running
 * while drawing is suppressed. Never mounted in production (tree-shaken from dist).
 */
export function RenderSuppressorProbe() {
  const scene = useThree((s) => s.scene)
  useEffect(() => {
    renderSuppressor.attach(scene)
    if (import.meta.env.VITE_SUPPRESS_AFTER_SETTLE) renderSuppressor.enableAutoAfterSettle()
  }, [scene])
  useFrame(() => {
    renderSuppressor.tick()
  })
  return null
}
