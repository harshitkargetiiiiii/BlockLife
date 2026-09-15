// @vitest-environment node
// (GLTFLoader.parse reads the GLB binary chunks; jsdom mis-handles that.)
import { readFileSync } from 'node:fs'
import * as THREE from 'three'
import { describe, expect, it } from 'vitest'
import { CHARACTER_ASSETS, DEFAULT_CHARACTER_ASSET_ID } from './characterManifest'
import {
  ACCESSORY_VARIANTS,
  CUSTOMIZABLE_SLOTS,
  HAIR_VARIANTS,
  applyCharacterAppearance,
  applyCharacterVariants,
  createCustomizableMaterialInstances,
} from './characterMaterials'
import { RIG_FIT_TOLERANCE_METERS, RIG_HEIGHT_METERS } from '../../../scripts/asset-intake/wave4.config.mjs'

/**
 * Issue #56 — the in-repo `blocklife_person` rig, asserted against the SHIPPED bytes.
 *
 * `scripts/buildCharacterGlb.mjs` used to bind every skin before the bones' world matrices were
 * resolved, so three's `Skeleton.calculateInverses()` inverted identity matrices: every inverse
 * bind was identity and each rest joint offset applied twice at runtime. The rig floated 0.72 m
 * above its origin with detached limbs and a 2.930 m envelope, and every structural gate stayed
 * green — bone count, clips, slots and a height pinned to the defective bytes. These tests state
 * the properties that defect broke, so it cannot come back quietly: the skins bind at the rest
 * pose, rest skinning reproduces the authored geometry, and the per-variant envelope the Wave 4
 * fits derive from is the rig's real one. The player's wardrobe and variant contract ride along,
 * exercised on the real file rather than a mock rig.
 */
const DEF = CHARACTER_ASSETS[DEFAULT_CHARACTER_ASSET_ID]
const FILE = `public/${DEF.modelPath}`
const HAIR_PREFIX = 'person_hair__'
const ACCESSORY_PREFIX = 'person_accessory__'

async function load() {
  ;(globalThis as { self?: unknown }).self ??= globalThis
  const { GLTFLoader } = await import('three/examples/jsm/loaders/GLTFLoader.js')
  const bytes = readFileSync(FILE)
  const buffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer
  const gltf = await new GLTFLoader().parseAsync(buffer, '')
  gltf.scene.updateMatrixWorld(true)
  const meshes: THREE.SkinnedMesh[] = []
  gltf.scene.traverse((o) => {
    if ((o as THREE.SkinnedMesh).isSkinnedMesh) meshes.push(o as THREE.SkinnedMesh)
  })
  return { gltf, meshes }
}

/** Skinned rest-pose box of one mesh (three applies the skin in `computeBoundingBox`). */
function restBox(mesh: THREE.SkinnedMesh): THREE.Box3 {
  mesh.computeBoundingBox()
  return mesh.boundingBox!.clone()
}

describe('issue #56 — blocklife_person binds at its rest pose', () => {
  it('every skin inverse bind is the inverse of its bone rest world matrix — never identity', async () => {
    const { meshes } = await load()
    expect(meshes.length, 'skinned meshes: body slots + hair/accessory variants').toBe(11)
    const product = new THREE.Matrix4()
    for (const mesh of meshes) {
      const { bones, boneInverses } = mesh.skeleton
      expect(boneInverses.length, `${mesh.name} inverse binds`).toBe(bones.length)
      bones.forEach((bone, i) => {
        product.multiplyMatrices(bone.matrixWorld, boneInverses[i])
        product.elements.forEach((e, k) => {
          expect(e, `${mesh.name} ${bone.name} bone x inverse [${k}]`).toBeCloseTo(k % 5 === 0 ? 1 : 0, 5)
        })
      })
      // The defect's exact signature: Hips sits 0.72 m up, so its inverse must carry that back down.
      const hips = bones.findIndex((b) => b.name === 'Hips')
      expect(bones[hips].matrixWorld.elements[13], 'Hips rest height').toBeGreaterThan(0.5)
      expect(boneInverses[hips].elements[13], `${mesh.name} Hips inverse bind`).toBeCloseTo(
        -bones[hips].matrixWorld.elements[13],
        5,
      )
    }
  })

  it('rest skinning reproduces the authored geometry — no joint offset applied twice', async () => {
    const { meshes } = await load()
    const skinned = new THREE.Vector3()
    const raw = new THREE.Vector3()
    let worst = 0
    for (const mesh of meshes) {
      const position = mesh.geometry.getAttribute('position')
      for (let i = 0; i < position.count; i++) {
        mesh.getVertexPosition(i, skinned)
        worst = Math.max(worst, skinned.distanceTo(raw.fromBufferAttribute(position, i)))
      }
    }
    expect(worst, 'max rest-skinned vertex error (m)').toBeLessThan(1e-5)
  })

  it('measures the envelope the Wave 4 fits derive from, per variant, feet at the origin', async () => {
    const { meshes } = await load()
    const body = new THREE.Box3()
    const hair = new Map<string, THREE.Box3>()
    const accessories = new Map<string, THREE.Box3>()
    for (const mesh of meshes) {
      const box = restBox(mesh)
      expect(box.min.y, `${mesh.name} never dips below the origin`).toBeGreaterThanOrEqual(-RIG_FIT_TOLERANCE_METERS)
      if (mesh.name.startsWith(HAIR_PREFIX)) hair.set(mesh.name.slice(HAIR_PREFIX.length), box)
      else if (mesh.name.startsWith(ACCESSORY_PREFIX)) accessories.set(mesh.name.slice(ACCESSORY_PREFIX.length), box)
      else body.union(box)
    }
    const top = (variant: string) => Math.max(body.max.y, hair.get(variant)?.max.y ?? -Infinity)
    expect(body.min.y, 'feet at y = 0').toBeCloseTo(0, 3)
    // The declared `visualHeight` is the bald body; the bun is the tallest hair and the envelope.
    expect(body.max.y, 'bald body height = declared visualHeight').toBeCloseTo(DEF.bounds.visualHeight, 3)
    expect(top('short'), 'short hair').toBeCloseTo(2.055, 3)
    expect(top('long'), 'long hair').toBeCloseTo(2.055, 3)
    expect(Math.abs(top('bun') - RIG_HEIGHT_METERS), 'bun = maximum-variant envelope').toBeLessThanOrEqual(
      RIG_FIT_TOLERANCE_METERS,
    )
    const tallest = Math.max(...[...hair.keys()].map(top))
    expect(tallest, 'no hair variant exceeds the envelope').toBeCloseTo(top('bun'), 6)
    for (const [variant, box] of accessories) {
      expect(box.max.y, `accessory ${variant} never raises the envelope`).toBeLessThanOrEqual(body.max.y)
    }
  })
})

describe('issue #56 — the player wardrobe and variants on the regenerated rig', () => {
  it('all six customizable slots resolve and recolour exactly', async () => {
    const { gltf } = await load()
    const slots = createCustomizableMaterialInstances(DEF, gltf.scene)
    const colours = {
      shirt: '#1f4e79',
      pants: '#3b3b3b',
      hair: '#6b3e26',
      skin: '#c68642',
      shoes: '#2b2620',
      accessory: '#b62032',
    } as const
    applyCharacterAppearance(slots, {
      shirtColor: colours.shirt,
      pantsColor: colours.pants,
      accentColor: colours.hair,
      skinColor: colours.skin,
      shoesColor: colours.shoes,
      accessoryColor: colours.accessory,
    })
    for (const slot of CUSTOMIZABLE_SLOTS) {
      const materials = slots[slot] ?? []
      expect(materials.length, `${slot} resolves on the shipped file`).toBeGreaterThan(0)
      for (const material of materials) {
        expect((material as THREE.MeshStandardMaterial).color.getHexString(), `${slot} colour`).toBe(
          colours[slot].slice(1),
        )
      }
    }
  })

  it('ships exactly the hair/accessory variant meshes, and shows exactly one of each choice', async () => {
    const { gltf, meshes } = await load()
    const names = meshes.map((m) => m.name)
    expect(names.filter((n) => n.startsWith(HAIR_PREFIX)).sort()).toEqual(
      ['bun', 'long', 'short'].map((v) => HAIR_PREFIX + v),
    )
    expect(names.filter((n) => n.startsWith(ACCESSORY_PREFIX)).sort()).toEqual(
      ['bag', 'glasses', 'scarf'].map((v) => ACCESSORY_PREFIX + v),
    )
    const shown = (prefix: string) => meshes.filter((m) => m.name.startsWith(prefix) && m.visible).map((m) => m.name)
    for (const hairVariant of HAIR_VARIANTS) {
      for (const accessoryVariant of ACCESSORY_VARIANTS) {
        applyCharacterVariants(gltf.scene, {
          shirtColor: '#ffffff',
          pantsColor: '#000000',
          accentColor: '#111111',
          hairVariant,
          accessoryVariant,
        })
        expect(shown(HAIR_PREFIX), `hair ${hairVariant}`).toEqual(hairVariant === 'bald' ? [] : [HAIR_PREFIX + hairVariant])
        expect(shown(ACCESSORY_PREFIX), `accessory ${accessoryVariant}`).toEqual(
          accessoryVariant === 'none' ? [] : [ACCESSORY_PREFIX + accessoryVariant],
        )
      }
    }
  })

  it('keeps the three locomotion clips', async () => {
    const { gltf } = await load()
    expect(gltf.animations.map((a) => a.name).sort()).toEqual(['Idle', 'Run', 'Walk'])
  })
})
