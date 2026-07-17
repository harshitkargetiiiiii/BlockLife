import { useEffect, useMemo } from 'react'
import * as THREE from 'three'
import { useFrame, useThree } from '@react-three/fiber'
import { getBlendedModifiers, weatherRuntime } from './weatherSystem'
import { useGameStore } from '../store/useGameStore'

/**
 * Scene-level FogExp2 whose density comes from the blended weather modifiers
 * and whose color tracks the current sky, so fog reads as haze rather than a
 * grey wall. Density 0 (clear) renders identically to no fog.
 */
export function FogEffect() {
  const scene = useThree((s) => s.scene)
  const fog = useMemo(() => new THREE.FogExp2('#c8ccd2', 0), [])

  useEffect(() => {
    scene.fog = fog
    return () => {
      if (scene.fog === fog) scene.fog = null
    }
  }, [scene, fog])

  useFrame(() => {
    // No fog inside the apartment — it would wash out the tiny interior.
    fog.density =
      useGameStore.getState().location === 'apartment'
        ? 0
        : getBlendedModifiers(weatherRuntime).fogDensity
    if (scene.background instanceof THREE.Color) {
      // Blend the fog color toward the sky so buildings fade into it.
      fog.color.copy(scene.background).lerp(whiteScratch, 0.25)
    }
  })

  return null
}

const whiteScratch = new THREE.Color('#e8e8e6')
