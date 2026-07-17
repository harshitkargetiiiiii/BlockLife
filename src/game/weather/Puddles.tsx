import { useRef } from 'react'
import * as THREE from 'three'
import { useFrame } from '@react-three/fiber'
import { PUDDLES } from './weatherData'
import { weatherRuntime } from './weatherSystem'

// One shared material: a single opacity update wets/dries every puddle.
const puddleMaterial = new THREE.MeshStandardMaterial({
  color: '#7d95ad',
  roughness: 0.06,
  metalness: 0.55,
  transparent: true,
  opacity: 0,
  depthWrite: false,
})

/**
 * Deterministic gutter puddles: flat transparent ellipses that fade in with
 * surface wetness and drain away after the rain stops.
 */
export function Puddles() {
  const groupRef = useRef<THREE.Group>(null)

  useFrame(() => {
    const opacity = Math.min(1, weatherRuntime.wetness) * 0.5
    puddleMaterial.opacity = opacity
    if (groupRef.current) groupRef.current.visible = opacity > 0.01
  })

  return (
    <group ref={groupRef} name="puddles" visible={false}>
      {PUDDLES.map((p) => (
        <mesh
          key={p.id}
          material={puddleMaterial}
          position={[p.position[0], 0.045, p.position[1]]}
          rotation={[-Math.PI / 2, 0, p.rotationY]}
          scale={[p.radiusX, p.radiusZ, 1]}
        >
          <circleGeometry args={[1, 20]} />
        </mesh>
      ))}
    </group>
  )
}
