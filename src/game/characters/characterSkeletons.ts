import type * as THREE from 'three'

/**
 * Releases the GPU bone textures owned by a character instance's CLONED skeletons (issue #53).
 *
 * `SkeletonUtils.clone` gives every skinned mesh its own `sourceMesh.skeleton.clone()` — so a rig
 * whose meshes share ONE source skeleton comes back with one skeleton PER MESH — and three's
 * WebGLRenderer allocates a float `boneTexture` for each of them on first draw. The clone is
 * rendered through `<primitive>`, which React Three Fiber deliberately never auto-disposes, so
 * without this every unmount (sector stream-out, LOD demotion, respawn) strands those textures.
 *
 * Preconditions: `root` is the instance's own `SkeletonUtils.clone` of `source`, and `source` is the
 * shared cached GLB scene it was cloned from. `source` is REQUIRED because it is what makes the
 * ownership rules below checkable rather than assumed:
 *  - only skeletons reachable from `root` are considered, each distinct skeleton once;
 *  - any skeleton ALSO reachable from `source` is skipped, so a mesh that was never rebound to a
 *    clone can't take the cache's texture down with it;
 *  - a clone skeleton whose `boneTexture` is the SAME object as a source skeleton's is never
 *    disposed — only the clone's alias reference is dropped;
 *  - a texture object referenced by two owned skeletons is disposed once;
 *  - geometries, materials and the source scene are never touched (materials have their own path).
 *
 * StrictMode/HMR-safe: disposal nulls `boneTexture`, and the renderer recreates it on the next draw
 * of the memoized clone. That does mean a remount of the same clone releases and reallocates its
 * bone textures once — deliberate, bounded churn in exchange for never stranding them. Idempotent —
 * a second call finds nothing to release. Returns how many textures were disposed.
 */
export function disposeOwnedSkeletons(root: THREE.Object3D, source: THREE.Object3D): number {
  const sharedSkeletons = new Set<THREE.Skeleton>()
  const sharedTextures = new Set<THREE.DataTexture>()
  source.traverse((node) => {
    const skinned = node as THREE.SkinnedMesh
    if (!skinned.isSkinnedMesh || !skinned.skeleton) return
    sharedSkeletons.add(skinned.skeleton)
    if (skinned.skeleton.boneTexture) sharedTextures.add(skinned.skeleton.boneTexture)
  })

  const owned = new Set<THREE.Skeleton>()
  root.traverse((node) => {
    const skinned = node as THREE.SkinnedMesh
    if (skinned.isSkinnedMesh && skinned.skeleton && !sharedSkeletons.has(skinned.skeleton)) owned.add(skinned.skeleton)
  })

  const released = new Set<THREE.DataTexture>()
  for (const skeleton of owned) {
    const texture = skeleton.boneTexture
    if (texture === null) continue
    if (sharedTextures.has(texture) || released.has(texture)) {
      skeleton.boneTexture = null
      continue
    }
    released.add(texture)
    skeleton.dispose()
  }
  return released.size
}
