import { useMemo, useRef } from 'react'
import * as THREE from 'three'
import { useFrame } from '@react-three/fiber'
import { getBlendedModifiers, weatherRuntime } from './weatherSystem'
import { seededRandom } from '../world/materials'
import { getFollowTargetPosition, registry } from '../world/runtimeRegistry'
import { useGameStore } from '../store/useGameStore'

const DROP_COUNT = 900
const BOX = { x: 46, y: 22, z: 46 } // camera-relative volume
const FALL_SPEED = 17

/**
 * Cheap camera-relative rain: one THREE.Points cloud that rides along with
 * the camera and wraps drops vertically. Deterministic seeded layout; the
 * fall offset freezes (and resets) on pause so screenshots are stable.
 */
export function RainEffect() {
  const pointsRef = useRef<THREE.Points>(null)
  const materialRef = useRef<THREE.PointsMaterial>(null)
  const fallOffset = useRef(0)
  const pauseSeq = useRef(-1)

  const { geometry, baseY } = useMemo(() => {
    const positions = new Float32Array(DROP_COUNT * 3)
    const baseY = new Float32Array(DROP_COUNT)
    for (let i = 0; i < DROP_COUNT; i++) {
      positions[i * 3] = (seededRandom(i * 3.1 + 5) - 0.5) * BOX.x
      baseY[i] = seededRandom(i * 7.7 + 11) * BOX.y
      positions[i * 3 + 1] = baseY[i]
      positions[i * 3 + 2] = (seededRandom(i * 13.3 + 23) - 0.5) * BOX.z
    }
    const geometry = new THREE.BufferGeometry()
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3))
    return { geometry, baseY }
  }, [])

  useFrame((_, dt) => {
    const points = pointsRef.current
    const material = materialRef.current
    if (!points || !material) return

    const strength = getBlendedModifiers(weatherRuntime).rainStrength
    material.opacity = Math.min(1, strength) * 0.55
    const store = useGameStore.getState()
    // No rain indoors — the apartment window carries the weather mood instead.
    points.visible = strength > 0.02 && store.location !== 'apartment'
    if (!points.visible) return

    // Center the cloud on what the camera is LOOKING AT (the diorama camera
    // itself sits offset up-diagonal, which would shift the rain off-view).
    const target = getFollowTargetPosition(store.mode === 'driving' ? 'driving' : 'walking')
    points.position.set(target.x, 0, target.z)

    if (store.worldPaused) {
      // Canonical pose for visual tests: drops at their seeded positions.
      if (pauseSeq.current !== registry.pauseSeq) {
        pauseSeq.current = registry.pauseSeq
        fallOffset.current = 0
      }
    } else {
      fallOffset.current = (fallOffset.current + dt * FALL_SPEED) % BOX.y
    }

    const positions = geometry.attributes.position as THREE.BufferAttribute
    for (let i = 0; i < DROP_COUNT; i++) {
      let y = baseY[i] - fallOffset.current
      if (y < 0) y += BOX.y
      positions.setY(i, y)
    }
    positions.needsUpdate = true
  })

  return (
    <points ref={pointsRef} geometry={geometry} frustumCulled={false}>
      {/* Fixed pixel size: with the orthographic camera, attenuated sizes
          collapse to sub-pixel and the rain becomes invisible. */}
      <pointsMaterial
        ref={materialRef}
        color="#c3d2e6"
        size={2.4}
        transparent
        opacity={0}
        depthWrite={false}
        sizeAttenuation={false}
      />
    </points>
  )
}
