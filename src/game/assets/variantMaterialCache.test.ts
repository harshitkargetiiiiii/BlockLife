import { beforeEach, describe, expect, it } from 'vitest'
import * as THREE from 'three'
import {
  _resetVariantMaterialCache,
  acquireTintedMaterials,
  assignTintedMaterials,
  variantCacheKey,
  variantCacheSnapshot,
  variantCacheStats,
} from './variantMaterialCache'
import { countUniqueMaterials } from '../world/materialProbe'
import type { MaterialSlotMap } from './assetVariants'

/**
 * Issue #25: the shared immutable variant-material cache. Proves that reused GLB placements
 * share ONE tinted material-set per (source, slots, palette) — the material-budget fix — and
 * that the cache never mutates/disposes the source, keys correctly, survives remount without
 * growth, and its occupancy is measurable.
 */

const SLOTS: MaterialSlotMap = { wall: ['MI_Wall'], trim: ['MI_Trim'] }

function makeSourceScene(): THREE.Group {
  const group = new THREE.Group()
  for (const name of ['MI_Wall', 'MI_Trim', 'MI_Glass']) {
    const mat = new THREE.MeshStandardMaterial({ color: '#ffffff' })
    mat.name = name
    group.add(new THREE.Mesh(new THREE.BoxGeometry(), mat))
  }
  return group
}

function sourceMaterial(scene: THREE.Object3D, name: string): THREE.MeshStandardMaterial {
  let found: THREE.MeshStandardMaterial | undefined
  scene.traverse((o) => {
    const m = (o as THREE.Mesh).material as THREE.MeshStandardMaterial | undefined
    if (m && m.name === name) found = m
  })
  return found!
}

describe('variantMaterialCache', () => {
  beforeEach(() => _resetVariantMaterialCache())

  it('shares one immutable tinted set across acquisitions with the same key', () => {
    const source = makeSourceScene()
    const variant = { wall: { color: '#ff0000' } }
    const key = variantCacheKey('arch_x', SLOTS, variant)
    const t1 = acquireTintedMaterials(key, source, SLOTS, variant)
    const t2 = acquireTintedMaterials(key, source, SLOTS, variant)
    expect(t1).toBe(t2) // same cached object
    expect(t1.size).toBe(2) // only the two slot materials cloned; glass untouched
    expect((t1.get('MI_Wall') as THREE.MeshStandardMaterial).color.getHexString()).toBe('ff0000')
  })

  it('never mutates or disposes the useGLTF source materials', () => {
    const source = makeSourceScene()
    const before = sourceMaterial(source, 'MI_Wall')
    acquireTintedMaterials(variantCacheKey('a', SLOTS, { wall: { color: '#123456' } }), source, SLOTS, {
      wall: { color: '#123456' },
    })
    const after = sourceMaterial(source, 'MI_Wall')
    expect(after).toBe(before) // same object, not replaced
    expect(after.color.getHexString()).toBe('ffffff') // color untouched
  })

  it('reuses one material-set across many instances (the budget fix)', () => {
    const source = makeSourceScene()
    const variant = { wall: { color: '#00aa55' } }
    const key = variantCacheKey('arch_house', SLOTS, variant)
    const tinted = acquireTintedMaterials(key, source, SLOTS, variant)

    const parent = new THREE.Group()
    for (let i = 0; i < 10; i++) {
      const instance = source.clone(true)
      assignTintedMaterials(instance, tinted)
      parent.add(instance)
    }
    // 10 instances → shared wall + trim (2) + the shared source glass (1) = 3 unique, not 30.
    expect(countUniqueMaterials(parent)).toBe(3)
    expect(variantCacheStats()).toEqual({ keys: 1, materials: 2 })
  })

  it('keys distinctly by source identity, slot-map signature, and resolved palette', () => {
    const red = { wall: { color: '#ff0000' } }
    const green = { wall: { color: '#00ff00' } }
    expect(variantCacheKey('a', SLOTS, red)).not.toBe(variantCacheKey('a', SLOTS, green)) // palette
    expect(variantCacheKey('a', SLOTS, red)).not.toBe(variantCacheKey('b', SLOTS, red)) // source
    expect(variantCacheKey('a', SLOTS, undefined)).not.toBe(
      variantCacheKey('a', { wall: ['MI_Wall'] }, undefined),
    ) // slot-map
    // Order-independent slot signature.
    expect(variantCacheKey('a', { wall: ['x'], trim: ['y'] }, undefined)).toBe(
      variantCacheKey('a', { trim: ['y'], wall: ['x'] }, undefined),
    )
  })

  it('survives remount without growth (no leak; no per-instance disposal hazard)', () => {
    const source = makeSourceScene()
    const key = variantCacheKey('arch_house', SLOTS, undefined)
    for (let mount = 0; mount < 5; mount++) {
      const tinted = acquireTintedMaterials(key, source, SLOTS, undefined)
      const instance = source.clone(true)
      assignTintedMaterials(instance, tinted)
      // (instance goes out of scope = "unmount"); the process cache is untouched.
    }
    expect(variantCacheStats()).toEqual({ keys: 1, materials: 2 }) // constant across remounts
  })

  it('resets cleanly for tests', () => {
    acquireTintedMaterials(variantCacheKey('a', SLOTS, undefined), makeSourceScene(), SLOTS, undefined)
    expect(variantCacheStats().keys).toBe(1)
    _resetVariantMaterialCache()
    expect(variantCacheStats()).toEqual({ keys: 0, materials: 0 })
  })

  it('issue #67: the diagnostic snapshot is frozen plain data that cannot reach or change the cache', () => {
    const source = makeSourceScene()
    const key = variantCacheKey('arch_house', SLOTS, undefined)
    const tinted = acquireTintedMaterials(key, source, SLOTS, undefined)
    const snap = variantCacheSnapshot()
    expect(snap).toEqual({
      keys: 1,
      materials: 2,
      entries: [{ key, materials: [
        { name: 'MI_Trim', uuid: tinted.get('MI_Trim')!.uuid, type: 'MeshStandardMaterial' },
        { name: 'MI_Wall', uuid: tinted.get('MI_Wall')!.uuid, type: 'MeshStandardMaterial' },
      ] }],
    })
    expect(JSON.parse(JSON.stringify(snap)), 'nothing but plain data').toEqual(snap)
    expect([snap, snap.entries, snap.entries[0], snap.entries[0].materials, snap.entries[0].materials[0]].every(Object.isFrozen)).toBe(true)
    expect(() => { (snap.entries as unknown as unknown[]).push({ key: 'x', materials: [] }) }).toThrow()
    expect(() => { (snap.entries[0].materials[0] as { uuid: string }).uuid = 'x' }).toThrow()
    expect(variantCacheStats()).toEqual({ keys: 1, materials: 2 })
    expect(acquireTintedMaterials(key, source, SLOTS, undefined)).toBe(tinted)
    expect(tinted.get('MI_Wall')!.uuid).toBe(snap.entries[0].materials[1].uuid)
  })
})
