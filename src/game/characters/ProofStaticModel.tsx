import { useMemo } from 'react'
import { useGLTF } from '@react-three/drei'
import * as THREE from 'three'

/**
 * DEV/test only (issue #27 H0 Calibration): render an UN-RIGGED GLB statically in the player
 * slot for candidate review. image_to_3d / remesh outputs have no animation clips, so they
 * cannot go through AnimatedCharacter (which requires idle/walk/run) — this plain loader grounds
 * the mesh (feet at y=0) and applies a review yaw so every side can be inspected in the real
 * diorama camera. Never used in production; gated behind `debugPlayerStaticGlb`.
 */
export function ProofStaticModel({
  path,
  yawDeg,
  scale = 1,
  lift = 0,
}: {
  path: string
  yawDeg: number
  scale?: number
  lift?: number
}) {
  const url = `${import.meta.env.BASE_URL}${path}`
  const gltf = useGLTF(url)
  const scene = useMemo(() => {
    const s = gltf.scene.clone(true)
    // Ground it: drop the lowest vertex to y=0 (models arrive centered or bottom-origin).
    const box = new THREE.Box3().setFromObject(s)
    s.position.y -= box.min.y
    s.traverse((o) => {
      const m = o as THREE.Mesh
      if (m.isMesh) {
        m.castShadow = true
        m.receiveShadow = true
      }
    })
    return s
  }, [gltf.scene])
  // Scale about the grounded feet (origin), then lift so the camera (which aims ~1m up) can be
  // pointed at the face for a close read without a bespoke review camera.
  return (
    <group position={[0, lift, 0]} rotation={[0, (yawDeg * Math.PI) / 180, 0]} scale={scale}>
      <primitive object={scene} />
    </group>
  )
}
