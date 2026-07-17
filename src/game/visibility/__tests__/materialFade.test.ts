import { describe, expect, it } from 'vitest'
import * as THREE from 'three'
import {
  applyFade,
  collectFadeMeshes,
  restoreOriginalMaterials,
  SHADOW_CUTOFF_OPACITY,
  swapToFadeMaterials,
} from '../materialFade'
import { createOcclusionState } from '../occlusionDetection'
import { getBuildingOccluderDescriptor } from '../occluderData'
import type { RegisteredOccluder } from '../visibilityTypes'

function makeOccluder(group: THREE.Group, excludeMaterialNames?: string[]): RegisteredOccluder {
  const descriptor = getBuildingOccluderDescriptor({
    id: 'building_test',
    position: [0, 0],
    size: [6, 8, 6],
    color: '#888888',
    roofColor: '#555555',
  })
  return {
    descriptor: { ...descriptor, excludeMaterialNames },
    object: group,
    state: createOcclusionState(),
    meshes: null,
    swapped: false,
  }
}

function buildingGroup() {
  const group = new THREE.Group()
  const shared = new THREE.MeshStandardMaterial({ color: '#aa3333' })
  shared.name = 'shared_wall'
  const glow = new THREE.MeshStandardMaterial({
    color: '#222222',
    emissive: '#ffaa00',
    emissiveIntensity: 0.4,
  })
  glow.name = 'window_glow'
  const wall = new THREE.Mesh(new THREE.BoxGeometry(6, 8, 6), shared)
  wall.castShadow = true
  const windowMesh = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), glow)
  const multi = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), [shared, glow])
  group.add(wall, windowMesh, multi)
  return { group, shared, glow, wall, windowMesh, multi }
}

describe('material fade engine (swap-on-fade)', () => {
  it('swap replaces materials with per-occludable clones; sources untouched', () => {
    const { group, shared, wall } = buildingGroup()
    const occ = makeOccluder(group)
    swapToFadeMaterials(occ)
    expect(wall.material).not.toBe(shared)
    applyFade(occ, 0.3)
    // The SHARED source material is never mutated.
    expect(shared.opacity).toBe(1)
    expect(shared.transparent).toBe(false)
    // The clone carries the fade.
    expect((wall.material as THREE.Material).opacity).toBeCloseTo(0.3)
    expect((wall.material as THREE.Material).transparent).toBe(true)
  })

  it('one clone per distinct source material, reused across meshes and fades', () => {
    const { group, wall, multi } = buildingGroup()
    const occ = makeOccluder(group)
    swapToFadeMaterials(occ)
    const wallClone = wall.material
    // multi-material mesh shares the same clone for the same source.
    expect((multi.material as THREE.Material[])[0]).toBe(wallClone)
    restoreOriginalMaterials(occ)
    swapToFadeMaterials(occ)
    // Second fade reuses the cached clone — no repeated cloning.
    expect(wall.material).toBe(wallClone)
    restoreOriginalMaterials(occ)
  })

  it('restore returns exact original materials, shadows and rebuilds nothing', () => {
    const { group, shared, glow, wall, multi } = buildingGroup()
    const occ = makeOccluder(group)
    swapToFadeMaterials(occ)
    applyFade(occ, 0.25)
    expect(wall.castShadow).toBe(false) // below the shadow cutoff
    restoreOriginalMaterials(occ)
    expect(wall.material).toBe(shared)
    expect((multi.material as THREE.Material[])[0]).toBe(shared)
    expect((multi.material as THREE.Material[])[1]).toBe(glow)
    expect(wall.castShadow).toBe(true)
    expect(occ.swapped).toBe(false)
  })

  it('live sync: emissive intensity and transparent-source opacity follow the source mid-fade', () => {
    const { group, glow, windowMesh } = buildingGroup()
    const occ = makeOccluder(group)
    swapToFadeMaterials(occ)
    glow.emissiveIntensity = 1.7 // the world director animates this
    applyFade(occ, 0.5)
    const clone = windowMesh.material as THREE.MeshStandardMaterial
    expect(clone.emissiveIntensity).toBeCloseTo(1.7)
    expect(clone.opacity).toBeCloseTo(0.5)
    // A transparent source (drei-style overlay) multiplies its own opacity.
    glow.transparent = true
    glow.opacity = 0.6
    applyFade(occ, 0.5)
    expect(clone.opacity).toBeCloseTo(0.3)
    restoreOriginalMaterials(occ)
  })

  it('shadow casting toggles at the cutoff and only for original casters', () => {
    const { group, wall, windowMesh } = buildingGroup()
    const occ = makeOccluder(group)
    swapToFadeMaterials(occ)
    applyFade(occ, SHADOW_CUTOFF_OPACITY + 0.05)
    expect(wall.castShadow).toBe(true)
    applyFade(occ, SHADOW_CUTOFF_OPACITY - 0.05)
    expect(wall.castShadow).toBe(false)
    expect(windowMesh.castShadow).toBe(false) // was never a caster
    restoreOriginalMaterials(occ)
  })

  it('excluded material names keep their original material while fading', () => {
    const { group, glow, windowMesh } = buildingGroup()
    const occ = makeOccluder(group, ['window_glow'])
    swapToFadeMaterials(occ)
    expect(windowMesh.material).toBe(glow)
    restoreOriginalMaterials(occ)
  })

  it('collectFadeMeshes finds nested meshes', () => {
    const { group } = buildingGroup()
    const nested = new THREE.Group()
    nested.add(new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshStandardMaterial()))
    group.add(nested)
    const occ = makeOccluder(group)
    expect(collectFadeMeshes(occ)).toHaveLength(4)
  })
})
