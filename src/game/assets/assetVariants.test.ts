import { describe, expect, it, vi } from 'vitest'
import * as THREE from 'three'
import {
  applyVariant,
  createVariantInstances,
  disposeVariantMaterials,
  resolveMaterialSlots,
  type MaterialSlotMap,
} from './assetVariants'

/** A tiny stand-in "GLB scene": three meshes, each with a named MeshStandardMaterial. */
function makeScene() {
  const group = new THREE.Group()
  const paintMat = new THREE.MeshStandardMaterial({ name: 'body', color: '#ffffff' })
  const wheelMat = new THREE.MeshStandardMaterial({ name: 'tire', color: '#000000' })
  const glassMat = new THREE.MeshStandardMaterial({ name: 'glass', color: '#88ccff' })
  group.add(new THREE.Mesh(new THREE.BoxGeometry(), paintMat))
  group.add(new THREE.Mesh(new THREE.BoxGeometry(), wheelMat))
  group.add(new THREE.Mesh(new THREE.BoxGeometry(), glassMat))
  return { group, paintMat, wheelMat, glassMat }
}

const SLOTS: MaterialSlotMap = { paint: ['body'], wheel: ['tire'] }

describe('assetVariants (§3 material-variant system)', () => {
  it('resolves slot names to the live material instances', () => {
    const { group, paintMat, wheelMat } = makeScene()
    const resolved = resolveMaterialSlots(group, SLOTS)
    expect(resolved.paint).toEqual([paintMat])
    expect(resolved.wheel).toEqual([wheelMat])
    expect(resolved.glass).toBeUndefined() // not a declared slot
  })

  it('isolates only the requested slots — cloned per instance, source untouched', () => {
    const { group, paintMat, wheelMat, glassMat } = makeScene()
    const slots = createVariantInstances(group, SLOTS, ['paint'])
    // paint material is now a CLONE swapped onto the mesh...
    expect(slots.paint).toHaveLength(1)
    expect(slots.paint![0]).not.toBe(paintMat)
    expect(slots.paint![0].name).toBe('body')
    // ...while non-isolated materials are the shared originals.
    const meshMats = (group.children as THREE.Mesh[]).map((m) => m.material)
    expect(meshMats).toContain(wheelMat)
    expect(meshMats).toContain(glassMat)
    expect(meshMats).not.toContain(paintMat) // swapped out for the clone
  })

  it('recoloring a variant never mutates the shared source material', () => {
    const { group, paintMat } = makeScene()
    const slots = createVariantInstances(group, SLOTS, ['paint'])
    applyVariant(slots, { paint: { color: '#ff0000' } })
    expect((slots.paint![0] as THREE.MeshStandardMaterial).color.getHexString()).toBe('ff0000')
    // The original cached material is still white — the whole point of isolation.
    expect(paintMat.color.getHexString()).toBe('ffffff')
  })

  it('two instances of the same source get independent isolated materials', () => {
    const a = makeScene()
    const b = makeScene()
    const sa = createVariantInstances(a.group, SLOTS, ['paint'])
    const sb = createVariantInstances(b.group, SLOTS, ['paint'])
    applyVariant(sa, { paint: { color: '#ff0000' } })
    applyVariant(sb, { paint: { color: '#00ff00' } })
    expect((sa.paint![0] as THREE.MeshStandardMaterial).color.getHexString()).toBe('ff0000')
    expect((sb.paint![0] as THREE.MeshStandardMaterial).color.getHexString()).toBe('00ff00')
    expect(sa.paint![0]).not.toBe(sb.paint![0])
  })

  it('handles a multi-material mesh, isolating only the targeted sub-material', () => {
    const group = new THREE.Group()
    const paintMat = new THREE.MeshStandardMaterial({ name: 'body', color: '#ffffff' })
    const trimMat = new THREE.MeshStandardMaterial({ name: 'glass', color: '#123456' })
    group.add(new THREE.Mesh(new THREE.BoxGeometry(), [paintMat, trimMat]))
    const slots = createVariantInstances(group, SLOTS, ['paint'])
    const mats = (group.children[0] as THREE.Mesh).material as THREE.Material[]
    expect(mats[0]).toBe(slots.paint![0]) // isolated clone
    expect(mats[0]).not.toBe(paintMat)
    expect(mats[1]).toBe(trimMat) // untouched sub-material
  })

  it('disposes only the isolated materials on teardown', () => {
    const { group } = makeScene()
    const slots = createVariantInstances(group, SLOTS, ['paint'])
    const dispose = vi.spyOn(slots.paint![0], 'dispose')
    disposeVariantMaterials(slots, ['paint'])
    expect(dispose).toHaveBeenCalledOnce()
  })

  it('applying a variant for an absent slot is a graceful no-op', () => {
    const { group } = makeScene()
    const slots = createVariantInstances(group, SLOTS, ['paint'])
    expect(() => applyVariant(slots, { spoiler: { color: '#ff0000' } })).not.toThrow()
  })
})
