import { describe, expect, it } from 'vitest'
import * as THREE from 'three'
import {
  applyCharacterAppearance,
  createCustomizableMaterialInstances,
  disposeIsolatedMaterials,
  resolveCharacterMaterialSlots,
} from './characterMaterials'
import { CHARACTER_ASSETS, DEFAULT_CHARACTER_ASSET_ID } from './characterManifest'
import type { CharacterAppearance } from './characterTypes'

const DEF = CHARACTER_ASSETS[DEFAULT_CHARACTER_ASSET_ID]

const APPEARANCE: CharacterAppearance = {
  shirtColor: '#ff0000',
  pantsColor: '#00ff00',
  accentColor: '#0000ff',
}

/**
 * Miniature stand-in for the shared GLB scene: named materials matching the
 * manifest slots, with the shirt material SHARED by two meshes (torso +
 * sleeves) the way the real asset shares it.
 */
function makeSourceScene() {
  const scene = new THREE.Group()
  const geo = new THREE.BoxGeometry(1, 1, 1)
  const mat = (name: string, color: string) => {
    const m = new THREE.MeshStandardMaterial({ color })
    m.name = name
    return m
  }
  const shirt = mat('shirt', '#f4a259')
  const materials = {
    shirt,
    pants: mat('pants', '#3d405b'),
    hair: mat('hair', '#5c4033'),
    skin: mat('skin', '#e0ac69'),
  }
  const torso = new THREE.Mesh(geo, shirt)
  const sleeves = new THREE.Mesh(geo, shirt) // shared shirt material
  const legs = new THREE.Mesh(geo, materials.pants)
  const head = new THREE.Mesh(geo, [materials.skin, materials.hair]) // multi-material
  scene.add(torso, sleeves, legs, head)
  return { scene, materials, meshes: { torso, sleeves, legs, head } }
}

describe('resolveCharacterMaterialSlots', () => {
  it('maps slot names to the material instances on the meshes', () => {
    const { scene, materials } = makeSourceScene()
    const slots = resolveCharacterMaterialSlots(DEF, scene)
    expect(slots.shirt).toEqual([materials.shirt])
    expect(slots.pants).toEqual([materials.pants])
    expect(slots.hair).toEqual([materials.hair])
    expect(slots.skin).toEqual([materials.skin])
  })

  it('deduplicates a material shared by several meshes', () => {
    const { scene } = makeSourceScene()
    const slots = resolveCharacterMaterialSlots(DEF, scene)
    expect(slots.shirt).toHaveLength(1)
  })
})

describe('createCustomizableMaterialInstances', () => {
  it('clones customizable slots and leaves the rest shared', () => {
    const { scene, materials } = makeSourceScene()
    const slots = createCustomizableMaterialInstances(DEF, scene)
    expect(slots.shirt![0]).not.toBe(materials.shirt) // isolated
    expect(slots.pants![0]).not.toBe(materials.pants)
    expect(slots.hair![0]).not.toBe(materials.hair)
    expect(slots.skin![0]).toBe(materials.skin) // shared untouched slot
  })

  it('reuses ONE clone for a material shared across meshes', () => {
    const { scene, meshes } = makeSourceScene()
    createCustomizableMaterialInstances(DEF, scene)
    expect(meshes.torso.material).toBe(meshes.sleeves.material)
  })

  it('handles multi-material meshes', () => {
    const { scene, meshes, materials } = makeSourceScene()
    createCustomizableMaterialInstances(DEF, scene)
    const headMats = meshes.head.material as THREE.Material[]
    expect(headMats[0]).toBe(materials.skin) // skin stays shared
    expect(headMats[1]).not.toBe(materials.hair) // hair got isolated
    expect(headMats[1].name).toBe('hair')
  })

  it('never mutates the source materials (shared GLB cache stays pristine)', () => {
    const { scene, materials } = makeSourceScene()
    const sourceShirt = materials.shirt.color.getHexString()
    const slots = createCustomizableMaterialInstances(DEF, scene)
    applyCharacterAppearance(slots, APPEARANCE)
    expect(materials.shirt.color.getHexString()).toBe(sourceShirt)
  })

  it('keeps material properties on the clone (color carried over)', () => {
    const { scene, materials } = makeSourceScene()
    const slots = createCustomizableMaterialInstances(DEF, scene)
    const clone = slots.shirt![0] as THREE.MeshStandardMaterial
    expect(clone.color.getHexString()).toBe(materials.shirt.color.getHexString())
    expect(clone.name).toBe('shirt')
  })
})

describe('applyCharacterAppearance', () => {
  it('writes shirt/pants/accent colors to the mapped slots', () => {
    const { scene } = makeSourceScene()
    const slots = createCustomizableMaterialInstances(DEF, scene)
    applyCharacterAppearance(slots, APPEARANCE)
    expect((slots.shirt![0] as THREE.MeshStandardMaterial).color.getHexString()).toBe('ff0000')
    expect((slots.pants![0] as THREE.MeshStandardMaterial).color.getHexString()).toBe('00ff00')
    expect((slots.hair![0] as THREE.MeshStandardMaterial).color.getHexString()).toBe('0000ff')
  })

  it('leaves non-customizable slots untouched', () => {
    const { scene, materials } = makeSourceScene()
    const skinBefore = materials.skin.color.getHexString()
    const slots = createCustomizableMaterialInstances(DEF, scene)
    applyCharacterAppearance(slots, APPEARANCE)
    expect(materials.skin.color.getHexString()).toBe(skinBefore)
  })

  it('tolerates missing slots (fail-graceful)', () => {
    expect(() => applyCharacterAppearance({}, APPEARANCE)).not.toThrow()
  })

  it('two instances stay independent: recoloring one never touches the other', () => {
    const a = makeSourceScene()
    const b = makeSourceScene()
    const slotsA = createCustomizableMaterialInstances(DEF, a.scene)
    const slotsB = createCustomizableMaterialInstances(DEF, b.scene)
    applyCharacterAppearance(slotsA, APPEARANCE)
    const shirtB = slotsB.shirt![0] as THREE.MeshStandardMaterial
    expect(shirtB.color.getHexString()).not.toBe('ff0000')
  })
})

describe('disposeIsolatedMaterials', () => {
  it('disposes only the isolated (customizable) materials', () => {
    const { scene, materials } = makeSourceScene()
    const slots = createCustomizableMaterialInstances(DEF, scene)
    let disposedClone = false
    let disposedSource = false
    ;(slots.shirt![0] as THREE.Material).addEventListener('dispose', () => (disposedClone = true))
    materials.skin.addEventListener('dispose', () => (disposedSource = true))
    disposeIsolatedMaterials(slots)
    expect(disposedClone).toBe(true)
    expect(disposedSource).toBe(false)
  })
})
