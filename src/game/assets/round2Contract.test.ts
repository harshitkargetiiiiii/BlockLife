import { describe, expect, it } from 'vitest'
import * as THREE from 'three'
import { VEHICLE_DEFS } from '../vehicles/vehicleRegistry'
import { ASSET_MANIFEST_BY_ID } from './assetManifest'
import { shouldLoadGlb } from './modelRegistry'
import { CHARACTER_ASSETS } from '../characters/characterManifest'
import {
  applyCharacterAppearance,
  createCustomizableMaterialInstances,
} from '../characters/characterMaterials'
import type { CharacterAppearance } from '../characters/characterTypes'

/**
 * Round-2 review (#21 §13) production-contract unit tests: the GLB pipeline claims
 * that get exercised without a browser. E2E covers the streaming/save-load/reset
 * behaviours; these lock the static wiring so it can't silently regress.
 */

describe('§13 #14 — every ownable vehicle class resolves a valid, enabled GLB visual', () => {
  it('all four VehicleDefs declare a GLB assetId', () => {
    // Guards against a class silently falling back to CarMesh forever.
    expect(VEHICLE_DEFS.map((d) => d.vehicleClass).sort()).toEqual(['compact', 'scooter', 'sports', 'van'])
    for (const def of VEHICLE_DEFS) expect(def.assetId, `${def.id} must declare a GLB assetId`).toBeTruthy()
  })

  for (const def of VEHICLE_DEFS) {
    it(`${def.id} (${def.vehicleClass}) → enabled vehicle GLB with a recolorable paint slot`, () => {
      const entry = ASSET_MANIFEST_BY_ID.get(def.assetId!)
      expect(entry, `${def.assetId} must exist in the manifest`).toBeDefined()
      expect(entry!.category).toBe('vehicles')
      expect(entry!.enabled).toBe(true)
      expect(entry!.glbPath).toMatch(/\.glb$/)
      expect(shouldLoadGlb(entry)).toBe(true)
      expect(entry!.materialSlots?.paint?.length ?? 0).toBeGreaterThan(0)
    })
  }
})

describe('§13 #8 — six character variants reuse ONE base geometry, materials instance-local', () => {
  const def = CHARACTER_ASSETS['blocklife_person']
  const SLOT_NAMES = ['skin', 'hair', 'shirt', 'pants', 'shoes'] as const

  function makeBaseScene() {
    const group = new THREE.Group()
    const geom = new THREE.BufferGeometry() // ONE shared geometry, like a rigged GLB's mesh
    for (const slot of SLOT_NAMES) {
      group.add(new THREE.Mesh(geom, new THREE.MeshStandardMaterial({ name: slot, color: '#ffffff' })))
    }
    return { group, geom }
  }

  const variants: CharacterAppearance[] = [
    { shirtColor: '#b62032', pantsColor: '#1e2631', accentColor: '#201713' },
    { shirtColor: '#2f8f5b', pantsColor: '#333333', accentColor: '#8a5a2b' },
    { shirtColor: '#3a5fb0', pantsColor: '#222222', accentColor: '#111111' },
    { shirtColor: '#e2b04a', pantsColor: '#556633', accentColor: '#402a12' },
    { shirtColor: '#8d6a9f', pantsColor: '#444433', accentColor: '#2b1b33' },
    { shirtColor: '#c25b52', pantsColor: '#555566', accentColor: '#333344' },
  ]

  it('builds 6 distinct-coloured people from one base without duplicating geometry', () => {
    const base = makeBaseScene()
    const instances = variants.map((appearance) => {
      // three.js clone shares geometry by reference (as SkeletonUtils.clone does for rigs).
      const scene = base.group.clone(true)
      const slots = createCustomizableMaterialInstances(def, scene)
      applyCharacterAppearance(slots, appearance)
      return { scene, slots }
    })

    // (a) geometry is SHARED — every instance's meshes reference the ONE base geometry.
    for (const inst of instances) {
      for (const child of inst.scene.children as THREE.Mesh[]) {
        expect(child.geometry).toBe(base.geom)
      }
    }

    // (b) six visually DISTINCT variants (shirt colours all differ).
    const shirtHex = instances.map(
      (i) => (i.slots.shirt![0] as THREE.MeshStandardMaterial).color.getHexString(),
    )
    expect(new Set(shirtHex).size).toBe(6)
    shirtHex.forEach((hex, i) => expect(hex).toBe(variants[i].shirtColor.slice(1).toLowerCase()))

    // (c) instance-local: each instance's shirt material is a unique object (no shared mutation).
    const shirtMats = instances.map((i) => i.slots.shirt![0])
    expect(new Set(shirtMats).size).toBe(6)
  })
})
