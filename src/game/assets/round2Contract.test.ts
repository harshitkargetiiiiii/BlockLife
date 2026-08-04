import { describe, expect, it } from 'vitest'
import * as THREE from 'three'
import { VEHICLE_DEFS } from '../vehicles/vehicleRegistry'
import { ASSET_MANIFEST_BY_ID } from './assetManifest'
import { shouldLoadGlb } from './modelRegistry'
import { CHARACTER_ASSETS, DEFAULT_CHARACTER_ASSET_ID } from '../characters/characterManifest'
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

describe('§13 #4 — shipped-asset motion contract (distinct gaits vs an honest walk-only degrade)', () => {
  // The animation PIPELINE proves idle/walk/run + the staticIdle hold in
  // CharacterAnimationController.test.ts. Here we lock the contract for the SPECIFIC
  // shipped assets the reviewer flagged, so a regression can't silently alias all gaits.

  it("the player's default rig has three genuinely distinct locomotion clips", () => {
    // The representative-player avatar path rides this rig → real idle/walk/run.
    const def = CHARACTER_ASSETS[DEFAULT_CHARACTER_ASSET_ID]
    expect(def.id).toBe('blocklife_person')
    expect(def.staticIdle).not.toBe(true)
    const [idle, walk, run] = [def.clips.idle, def.clips.walk, def.clips.run]
    // No clip-name alias is shared across roles → the three gaits cannot collapse to one clip.
    const overlap = (a: string[], b: string[]) => a.some((n) => b.includes(n))
    expect(overlap(idle, walk)).toBe(false)
    expect(overlap(walk, run)).toBe(false)
    expect(overlap(idle, run)).toBe(false)
  })

  it('the two Meshy humanoids declare staticIdle (a walk-only rig holds still, never marches)', () => {
    // Meshy → rig ships a single walk clip; staticIdle is the honest, tested degradation
    // (CharacterAnimationController.test.ts §4). This asserts the SHIPPED assets opt into it.
    for (const id of ['blocklife_male_01', 'blocklife_female_01']) {
      const def = CHARACTER_ASSETS[id]
      expect(def, `${id} must be a shipped asset`).toBeDefined()
      expect(def.staticIdle, `${id} must hold a still idle (walk-only rig)`).toBe(true)
      // walk is a real clip (so movement is animated); idle aliases it (held at frame 0 by the controller).
      expect(def.clips.walk.length).toBeGreaterThan(0)
    }
  })
})
