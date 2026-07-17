import { useFrame } from '@react-three/fiber'
import { updateWetMaterials } from '../world/materials'
import { weatherRuntime } from './weatherSystem'

/**
 * Feeds the live wetness into the shared road/sidewalk materials each frame
 * (darker + glossier asphalt while wet). Render-only; no React state.
 */
export function WetSurfaceController() {
  useFrame(() => {
    updateWetMaterials(weatherRuntime.wetness)
  })
  return null
}
