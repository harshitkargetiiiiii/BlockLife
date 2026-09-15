import { StrictMode } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import ReactThreeTestRenderer from '@react-three/test-renderer'
import * as THREE from 'three'
import { AnimatedCharacter } from './AnimatedCharacter'
import { CHARACTER_ASSETS } from './characterManifest'
import { characterRuntime } from './characterRuntime'
import type { CharacterAppearance, CharacterAssetDefinition, CharacterMotionState } from './characterTypes'

/**
 * Issue #53 — instance-owned cloned skeletons must be released on unmount.
 *
 * `AnimatedCharacter` renders a `SkeletonUtils.clone` of the cached GLB through `<primitive>`,
 * which React Three Fiber never auto-disposes. `SkeletonUtils.clone` gives EVERY skinned mesh its
 * own `sourceMesh.skeleton.clone()`, and three's WebGLRenderer allocates a float `boneTexture` for
 * each of those clones the first time it draws them (`WebGLRenderer.js` — `if (skeleton.boneTexture
 * === null) skeleton.computeBoneTexture()`). This suite drives the REAL component over a REAL
 * three.js skinned scene — no mocked Three — and plays the renderer's part by calling
 * `computeBoneTexture()`, since the test renderer has no WebGL context of its own.
 */

// The cached GLB is ONE shared object, exactly like drei's loader cache.
const gltfHolder = vi.hoisted(() => ({ current: null as unknown }))
vi.mock('@react-three/drei', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useGLTF: () => gltfHolder.current,
}))
vi.spyOn(console, 'warn').mockImplementation(() => {})

const SLOT_NAMES = ['shirt', 'pants', 'skin', 'hair', 'shoes', 'accessory'] as const

interface Fixture {
  scene: THREE.Group
  animations: THREE.AnimationClip[]
  sourceSkeleton: THREE.Skeleton
  sharedGeometry: THREE.BufferGeometry
  sharedEyeMaterial: THREE.MeshStandardMaterial
}

/** A real skinned scene shaped like the production rig: several meshes share ONE skeleton, one of
 *  them is hidden (a variant mesh), plus an un-skinned mesh on a non-customizable material. */
function buildFixture(): Fixture {
  const hips = new THREE.Bone()
  hips.name = 'Hips'
  const spine = new THREE.Bone()
  spine.name = 'Spine'
  hips.add(spine)
  const skeleton = new THREE.Skeleton([hips, spine])

  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.Float32BufferAttribute([0, 0, 0, 0, 1, 0, 1, 0, 0], 3))
  geometry.setAttribute('skinIndex', new THREE.Uint16BufferAttribute([0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0], 4))
  geometry.setAttribute('skinWeight', new THREE.Float32BufferAttribute([1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0], 4))

  const scene = new THREE.Group()
  scene.add(hips)
  SLOT_NAMES.forEach((slot, i) => {
    const material = new THREE.MeshStandardMaterial({ color: 0xffffff })
    material.name = slot
    const mesh = new THREE.SkinnedMesh(geometry, material)
    mesh.name = `body_${slot}`
    if (i === SLOT_NAMES.length - 1) mesh.visible = false // a hidden variant mesh still owns a clone
    mesh.bind(skeleton)
    scene.add(mesh)
  })
  const eyeMaterial = new THREE.MeshStandardMaterial({ color: 0x000000 })
  eyeMaterial.name = 'eyes'
  scene.add(new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.1, 0.1), eyeMaterial))

  const track = new THREE.QuaternionKeyframeTrack('Spine.quaternion', [0, 1], [0, 0, 0, 1, 0, 0.7071068, 0, 0.7071068])
  const animations = ['Idle', 'Walk', 'Run'].map((name) => new THREE.AnimationClip(name, 1, [track]))
  return { scene, animations, sourceSkeleton: skeleton, sharedGeometry: geometry, sharedEyeMaterial: eyeMaterial }
}

const DEF: CharacterAssetDefinition = { ...CHARACTER_ASSETS.blocklife_person, modelPath: 'fixture/person.glb' }
const APPEARANCE: CharacterAppearance = { shirtColor: '#f4a259', pantsColor: '#3d405b', accentColor: '#5c4033' }
const IDLE: CharacterMotionState = { locomotion: 'idle', speed: 0, normalizedSpeed: 0, facingAngle: 0, grounded: true, moving: false }

const character = (instanceId: string, tier: 'hero' | 'namedNpc' = 'hero') => (
  <AnimatedCharacter
    instanceId={instanceId}
    tier={tier}
    def={DEF}
    appearance={APPEARANCE}
    getMotion={() => IDLE}
    fallback={null}
  />
)

/** Every distinct skeleton reachable from the rendered (cloned) scene graph. */
function renderedSkeletons(root: THREE.Object3D, sourceSkeleton: THREE.Skeleton): THREE.Skeleton[] {
  const found = new Set<THREE.Skeleton>()
  root.traverse((node) => {
    const skinned = node as THREE.SkinnedMesh
    if (skinned.isSkinnedMesh && skinned.skeleton !== sourceSkeleton) found.add(skinned.skeleton)
  })
  return [...found]
}

/** Stand in for WebGLRenderer's first draw: allocate each clone's bone texture, and watch it. */
function allocateBoneTextures(skeletons: THREE.Skeleton[]): { texture: THREE.DataTexture; disposed: () => number }[] {
  return skeletons.map((skeleton) => {
    skeleton.computeBoneTexture()
    const texture = skeleton.boneTexture!
    let count = 0
    texture.addEventListener('dispose', () => { count++ })
    return { texture, disposed: () => count }
  })
}

let fixture: Fixture
beforeEach(() => {
  fixture = buildFixture()
  gltfHolder.current = { scene: fixture.scene, animations: fixture.animations }
  characterRuntime.instances.clear()
})
afterEach(() => {
  characterRuntime.instances.clear()
})

describe('AnimatedCharacter releases its owned cloned skeletons (issue #53)', () => {
  it('disposes every distinct cloned bone texture exactly once on unmount, and nothing shared', async () => {
    // The shared source skeleton is allowed to have a bone texture of its own; it must survive.
    fixture.sourceSkeleton.computeBoneTexture()
    const sourceTexture = fixture.sourceSkeleton.boneTexture!
    let sourceDisposed = 0
    sourceTexture.addEventListener('dispose', () => { sourceDisposed++ })
    let geometryDisposed = 0
    fixture.sharedGeometry.addEventListener('dispose', () => { geometryDisposed++ })
    let eyeMaterialDisposed = 0
    fixture.sharedEyeMaterial.addEventListener('dispose', () => { eyeMaterialDisposed++ })

    const renderer = await ReactThreeTestRenderer.create(character('player'))
    const skeletons = renderedSkeletons(renderer.scene.instance, fixture.sourceSkeleton)
    // SkeletonUtils.clone gives each of the six skinned meshes its OWN skeleton clone.
    expect(skeletons).toHaveLength(SLOT_NAMES.length)
    const watched = allocateBoneTextures(skeletons)

    await renderer.unmount()

    expect(watched.map((w) => w.disposed()), 'each cloned bone texture disposed exactly once').toEqual(
      skeletons.map(() => 1),
    )
    expect(skeletons.every((s) => s.boneTexture === null), 'disposed clones drop their texture reference').toBe(true)
    expect(sourceDisposed, 'shared source skeleton texture untouched').toBe(0)
    expect(fixture.sourceSkeleton.boneTexture).toBe(sourceTexture)
    expect(geometryDisposed, 'shared geometry untouched').toBe(0)
    expect(eyeMaterialDisposed, 'shared non-customizable material untouched').toBe(0)
  })

  it('concurrently mounted clones are independent: unmounting one leaves the other intact', async () => {
    const a = await ReactThreeTestRenderer.create(character('npc_a'))
    const b = await ReactThreeTestRenderer.create(character('npc_b'))
    const aSkeletons = renderedSkeletons(a.scene.instance, fixture.sourceSkeleton)
    const bSkeletons = renderedSkeletons(b.scene.instance, fixture.sourceSkeleton)
    expect(aSkeletons.some((s) => bSkeletons.includes(s)), 'no skeleton shared between instances').toBe(false)
    const aWatched = allocateBoneTextures(aSkeletons)
    const bWatched = allocateBoneTextures(bSkeletons)

    await a.unmount()
    expect(aWatched.every((w) => w.disposed() === 1), 'unmounted instance released').toBe(true)
    expect(bWatched.every((w) => w.disposed() === 0), 'still-mounted instance untouched').toBe(true)
    expect(bSkeletons.every((s) => s.boneTexture !== null)).toBe(true)

    await b.unmount()
    expect(bWatched.every((w) => w.disposed() === 1)).toBe(true)
  })

  it('StrictMode mount, then a real cleanup/re-setup on the SAME memoized clone after allocation', async () => {
    // StrictMode replays setup→cleanup→setup inside create(), i.e. BEFORE any bone texture exists,
    // so it cannot by itself prove the reuse path. It is kept here to show the replay ends mounted.
    const renderer = await ReactThreeTestRenderer.create(<StrictMode>{character('player')}</StrictMode>)
    expect(characterRuntime.instances.get('player')!.modelLoaded, 'StrictMode replay ends mounted').toBe(true)
    expect(characterRuntime.instances.get('player')!.resolvedSlots.slice().sort(), 'all six wardrobe slots').toEqual(
      [...SLOT_NAMES].sort(),
    )

    const skeletons = renderedSkeletons(renderer.scene.instance, fixture.sourceSkeleton)
    const first = allocateBoneTextures(skeletons)
    const firstTextures = first.map((w) => w.texture)
    const sourceShirt = (fixture.scene.getObjectByName('body_shirt') as THREE.Mesh).material

    // Force the controller effect's cleanup + setup WITHOUT recreating the clone: `tier` rebuilds
    // `info` (an effect dependency), while the clone's memo depends only on [gltf, def]. This is the
    // StrictMode/HMR reuse path, taken deliberately AFTER the textures were allocated.
    await renderer.update(<StrictMode>{character('player', 'namedNpc')}</StrictMode>)

    const after = renderedSkeletons(renderer.scene.instance, fixture.sourceSkeleton)
    expect(after, 'the SAME memoized clone survived the effect re-run').toEqual(skeletons)
    expect(first.map((w) => w.disposed()), 'cleanup released each texture exactly once at the boundary').toEqual(
      skeletons.map(() => 1),
    )
    expect(skeletons.every((s) => s.boneTexture === null), 'references cleared at the boundary').toBe(true)
    expect(characterRuntime.instances.get('player')!.modelLoaded, 're-setup ran on the reused clone').toBe(true)

    // The renderer's next draw recreates each texture — a NEW object, not the disposed one.
    skeletons.forEach((s) => s.computeBoneTexture())
    skeletons.forEach((s, i) => expect(s.boneTexture).not.toBe(firstTextures[i]))

    // Animation still advances on the re-set-up clone.
    const spine = renderer.scene.instance.getObjectByName('Spine')!
    const before = spine.quaternion.clone()
    await renderer.advanceFrames(20, 1 / 30)
    expect(spine.quaternion.angleTo(before), 'mixer advances after the re-setup').toBeGreaterThan(1e-4)

    // Wardrobe isolation holds on the reused clone.
    expect((renderer.scene.instance.getObjectByName('body_shirt') as THREE.Mesh).material).not.toBe(sourceShirt)

    await renderer.unmount()
    expect(skeletons.every((s) => s.boneTexture === null), 'recreated textures released by the final unmount').toBe(true)
  })
})
