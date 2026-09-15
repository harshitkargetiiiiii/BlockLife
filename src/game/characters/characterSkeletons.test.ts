import { describe, expect, it } from 'vitest'
import * as THREE from 'three'
import { clone as cloneSkinnedScene } from 'three/examples/jsm/utils/SkeletonUtils.js'
import { disposeOwnedSkeletons } from './characterSkeletons'

/** A real skinned scene: `meshCount` meshes bound to ONE shared skeleton, the last one hidden. */
function skinnedScene(meshCount: number): { scene: THREE.Group; skeleton: THREE.Skeleton } {
  const hips = new THREE.Bone()
  hips.name = 'Hips'
  const skeleton = new THREE.Skeleton([hips])
  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.Float32BufferAttribute([0, 0, 0, 0, 1, 0, 1, 0, 0], 3))
  geometry.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(new Array(12).fill(0), 4))
  geometry.setAttribute('skinWeight', new THREE.Float32BufferAttribute([1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0], 4))
  const scene = new THREE.Group()
  scene.add(hips)
  for (let i = 0; i < meshCount; i++) {
    const mesh = new THREE.SkinnedMesh(geometry, new THREE.MeshStandardMaterial())
    mesh.visible = i < meshCount - 1
    mesh.bind(skeleton)
    scene.add(mesh)
  }
  return { scene, skeleton }
}

const skeletonsOf = (root: THREE.Object3D): THREE.Skeleton[] => {
  const found = new Set<THREE.Skeleton>()
  root.traverse((n) => {
    if ((n as THREE.SkinnedMesh).isSkinnedMesh) found.add((n as THREE.SkinnedMesh).skeleton)
  })
  return [...found]
}

const watchDispose = (texture: THREE.Texture): (() => number) => {
  let n = 0
  texture.addEventListener('dispose', () => { n++ })
  return () => n
}

describe('disposeOwnedSkeletons (issue #53)', () => {
  it('releases each distinct cloned skeleton once, hidden meshes included, never the source', () => {
    const { scene: source, skeleton: sourceSkeleton } = skinnedScene(3)
    sourceSkeleton.computeBoneTexture()
    const sourceTexture = sourceSkeleton.boneTexture!
    const sourceWatch = watchDispose(sourceTexture)

    const clone = cloneSkinnedScene(source)
    const owned = skeletonsOf(clone)
    // The real SkeletonUtils behaviour this fix depends on: one skeleton per skinned mesh.
    expect(owned).toHaveLength(3)
    expect(owned).not.toContain(sourceSkeleton)
    owned.forEach((s) => s.computeBoneTexture())
    const watches = owned.map((s) => watchDispose(s.boneTexture!))

    expect(disposeOwnedSkeletons(clone, source)).toBe(3)
    expect(watches.map((w) => w())).toEqual([1, 1, 1])
    expect(owned.every((s) => s.boneTexture === null)).toBe(true)
    expect(sourceWatch()).toBe(0)
    expect(sourceSkeleton.boneTexture).toBe(sourceTexture)
  })

  it('is safe when no bone texture was ever allocated, and idempotent on repeated cleanup', () => {
    const { scene: source } = skinnedScene(2)
    const clone = cloneSkinnedScene(source)
    expect(disposeOwnedSkeletons(clone, source)).toBe(0)

    skeletonsOf(clone).forEach((s) => s.computeBoneTexture())
    expect(disposeOwnedSkeletons(clone, source)).toBe(2)
    expect(disposeOwnedSkeletons(clone, source)).toBe(0)
  })

  it('never disposes a skeleton the shared source still references (an un-rebound mesh)', () => {
    const { scene: source, skeleton: sourceSkeleton } = skinnedScene(2)
    sourceSkeleton.computeBoneTexture()
    const watch = watchDispose(sourceSkeleton.boneTexture!)
    // Plain .clone(true) leaves meshes bound to the SOURCE skeleton — exactly the case to refuse.
    const naive = source.clone(true)
    expect(disposeOwnedSkeletons(naive, source)).toBe(0)
    expect(watch()).toBe(0)
    expect(sourceSkeleton.boneTexture).not.toBeNull()
  })

  it('never disposes a bone texture ALIASED from the source skeleton; drops only the clone reference', () => {
    const { scene: source, skeleton: sourceSkeleton } = skinnedScene(2)
    sourceSkeleton.computeBoneTexture()
    const sourceTexture = sourceSkeleton.boneTexture!
    const watch = watchDispose(sourceTexture)
    const clone = cloneSkinnedScene(source)
    const [aliased, own] = skeletonsOf(clone)
    aliased.boneTexture = sourceTexture // a distinct skeleton object sharing the cache's texture
    own.computeBoneTexture()
    const ownWatch = watchDispose(own.boneTexture!)

    expect(disposeOwnedSkeletons(clone, source)).toBe(1)
    expect(watch(), 'source texture never disposed through an alias').toBe(0)
    expect(sourceSkeleton.boneTexture).toBe(sourceTexture)
    expect(aliased.boneTexture, 'alias reference dropped').toBeNull()
    expect(ownWatch()).toBe(1)
  })

  it('disposes a texture object shared by two owned skeletons once, and clears both references', () => {
    const { scene: source } = skinnedScene(2)
    const clone = cloneSkinnedScene(source)
    const [a, b] = skeletonsOf(clone)
    a.computeBoneTexture()
    b.boneTexture = a.boneTexture
    const watch = watchDispose(a.boneTexture!)
    expect(disposeOwnedSkeletons(clone, source)).toBe(1)
    expect(watch()).toBe(1)
    expect(a.boneTexture).toBeNull()
    expect(b.boneTexture).toBeNull()
  })

  it('lets the renderer recreate a released texture on the next draw of the same clone', () => {
    const { scene: source } = skinnedScene(1)
    const clone = cloneSkinnedScene(source)
    const [skeleton] = skeletonsOf(clone)
    skeleton.computeBoneTexture()
    const first = skeleton.boneTexture
    disposeOwnedSkeletons(clone, source)
    // WebGLRenderer: `if (skeleton.boneTexture === null) skeleton.computeBoneTexture()`
    skeleton.computeBoneTexture()
    expect(skeleton.boneTexture).not.toBeNull()
    expect(skeleton.boneTexture).not.toBe(first)
  })
})
