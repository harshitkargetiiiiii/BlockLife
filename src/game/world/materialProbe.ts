import * as THREE from 'three'

/**
 * DEV/test-only unique-material measurement (issue #25).
 *
 * `getRenderStats()` / three's `gl.info` report geometry and texture OBJECT counts but
 * NOT materials, so the ≤80 material-budget gate needs its own probe. `PerfProbe`
 * captures the live scene root here (DEV only); `countUniqueMaterials` traverses it and
 * counts distinct `THREE.Material` objects by uuid. Never read by the simulation.
 */
export const materialProbe: { scene: THREE.Object3D | null } = { scene: null }

/** Distinct live `THREE.Material` objects reachable from `scene` (by uuid). */
export function countUniqueMaterials(scene: THREE.Object3D | null): number {
  if (!scene) return 0
  const seen = new Set<string>()
  scene.traverse((obj) => {
    const mesh = obj as THREE.Mesh
    if (!mesh.isMesh || !mesh.material) return
    const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material]
    for (const material of materials) if (material) seen.add(material.uuid)
  })
  return seen.size
}
