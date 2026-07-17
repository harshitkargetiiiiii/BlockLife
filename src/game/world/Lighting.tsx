import { useEffect, useRef } from 'react'
import * as THREE from 'three'
import { useFrame, useThree } from '@react-three/fiber'
import { getLightingForHour, getSunPosition } from '../simulation/worldMoodSystem'
import { useGameStore } from '../store/useGameStore'
import { getBlendedModifiers, weatherRuntime } from '../weather/weatherSystem'

/**
 * Ambient + hemisphere + one shadow-casting directional light (sun by day,
 * moon by night), continuously recolored from the in-game clock.
 * `hourOverride` exists for tests and previews.
 */
export function Lighting({ hourOverride }: { hourOverride?: number }) {
  const ambientRef = useRef<THREE.AmbientLight>(null)
  const sunRef = useRef<THREE.DirectionalLight>(null)
  const hemiRef = useRef<THREE.HemisphereLight>(null)
  const scene = useThree((s) => s.scene)
  const background = useRef(new THREE.Color('#a8ddff'))

  const apply = (hour: number) => {
    const lighting = getLightingForHour(hour)
    const [sx, sy, sz] = getSunPosition(hour)
    // Weather MULTIPLIES the day/night mood (never replaces it): overcast
    // dims the sun, tints desaturate the sky, fog density comes from weather.
    const w = getBlendedModifiers(weatherRuntime)
    const [tr, tg, tb] = w.skyTint
    if (ambientRef.current) {
      ambientRef.current.color.setRGB(
        lighting.ambientColor[0] * tr,
        lighting.ambientColor[1] * tg,
        lighting.ambientColor[2] * tb,
      )
      ambientRef.current.intensity = lighting.ambientIntensity * w.ambientFactor
    }
    if (sunRef.current) {
      sunRef.current.color.setRGB(
        lighting.sunColor[0] * tr,
        lighting.sunColor[1] * tg,
        lighting.sunColor[2] * tb,
      )
      sunRef.current.intensity = lighting.sunIntensity * w.sunFactor
      sunRef.current.position.set(sx, sy, sz)
      sunRef.current.target.position.set(0, 0, 0)
      sunRef.current.target.updateMatrixWorld()
    }
    if (hemiRef.current) {
      hemiRef.current.intensity = lighting.hemiIntensity * w.ambientFactor
    }
    background.current.setRGB(
      lighting.skyColor[0] * tr,
      lighting.skyColor[1] * tg,
      lighting.skyColor[2] * tb,
    )
    scene.background = background.current
  }

  // Apply once on mount so the first frame is already correct.
  useEffect(() => {
    apply(hourOverride ?? useGameStore.getState().stats.hour)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hourOverride])

  useFrame(() => {
    apply(hourOverride ?? useGameStore.getState().stats.hour)
  })

  return (
    <group name="lighting">
      <ambientLight ref={ambientRef} intensity={0.8} />
      <hemisphereLight ref={hemiRef} args={['#bfd8ff', '#7a6a55', 0.5]} />
      {/* normalBias cures the crawling shadow-acne triangles on large flat
          GLB faces (roofs/façades) at low sun angles without peter-panning. */}
      <directionalLight
        ref={sunRef}
        position={[20, 30, 14]}
        intensity={2.8}
        castShadow
        shadow-mapSize={[4096, 4096]}
        shadow-camera-left={-80}
        shadow-camera-right={80}
        shadow-camera-top={80}
        shadow-camera-bottom={-80}
        shadow-camera-near={1}
        shadow-camera-far={200}
        shadow-bias={-0.0002}
        shadow-normalBias={0.9}
      />
    </group>
  )
}
