import { useMemo } from 'react'
import * as THREE from 'three'

/**
 * A dismounted police officer — deliberately cheap (shared geometry, three
 * meshes) in the same style as the ambient citizens, but in a police palette
 * (navy uniform, high-vis vest band, dark cap) so it reads as an officer on
 * foot at a glance. No physics; positioned by the PoliceUnits driver.
 */

const bodyGeometry = new THREE.CylinderGeometry(0.28, 0.32, 1.0, 8)
const vestGeometry = new THREE.CylinderGeometry(0.3, 0.34, 0.42, 8)
const headGeometry = new THREE.SphereGeometry(0.26, 10, 10)
const capGeometry = new THREE.CylinderGeometry(0.27, 0.27, 0.14, 10)

export function OfficerMesh() {
  const [uniformMat, vestMat, headMat, capMat] = useMemo(
    () => [
      new THREE.MeshStandardMaterial({ color: '#1a2540', roughness: 0.85 }),
      new THREE.MeshStandardMaterial({ color: '#f2e34a', roughness: 0.7 }),
      new THREE.MeshStandardMaterial({ color: '#caa07a', roughness: 0.9 }),
      new THREE.MeshStandardMaterial({ color: '#10182c', roughness: 0.8 }),
    ],
    [],
  )
  return (
    <>
      <mesh geometry={bodyGeometry} material={uniformMat} position={[0, 0.52, 0]} castShadow />
      <mesh geometry={vestGeometry} material={vestMat} position={[0, 0.7, 0]} />
      <mesh geometry={headGeometry} material={headMat} position={[0, 1.28, 0]} name="officer-head" />
      <mesh geometry={capGeometry} material={capMat} position={[0, 1.46, 0]} />
    </>
  )
}
