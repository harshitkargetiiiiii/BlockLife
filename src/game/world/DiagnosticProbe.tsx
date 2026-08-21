import { useEffect } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import { diagnosticProbe } from './diagnosticTelemetry'

/**
 * DEV/TEST-ONLY. Mounted once inside the Canvas behind `import.meta.env.DEV` (same pattern as
 * PerfProbe), it feeds the RAW R3F frame delta into `diagnosticProbe` for the E2E-environment
 * telemetry experiment. Unlike PerfProbe it does NOT clamp the delta — measuring true host FPS is
 * the point. Cheap: one scalar per frame. Never mounted in production (tree-shaken from dist).
 */
export function DiagnosticProbe() {
  const gl = useThree((s) => s.gl)
  useEffect(() => {
    diagnosticProbe.attach(gl)
  }, [gl])
  useFrame((_, rawDelta) => {
    diagnosticProbe.record(rawDelta)
  })
  return null
}
