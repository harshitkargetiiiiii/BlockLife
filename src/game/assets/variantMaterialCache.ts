import * as THREE from 'three'
import type { MaterialSlotMap, MaterialVariant } from './assetVariants'

/**
 * Shared immutable variant-material cache (issue #25).
 *
 * At Stage-B reuse scale (~60 GLB building placements) the per-instance clone path
 * (`createVariantInstances`) would allocate 120+ materials and blow the ≤80 material
 * budget. This cache instead builds ONE immutable tinted material-set per
 * `(source identity, slot-map signature, resolved palette values)` and shares it across
 * every instance with that key.
 *
 * Deliberately **process-lifetime and never disposed** (the user's "small bounded
 * immutable palette cache" option): the key space is bounded (archetypes × ≤4 palettes),
 * so it holds a small, fixed number of materials for the session — and it has NO refcount,
 * NO React-lifecycle retain/release, and therefore no StrictMode / Suspense /
 * abandoned-render disposal hazard, and cannot leak. It clones from a FRESH scene clone's
 * materials and never mutates or disposes the shared `useGLTF` source materials.
 */

type TintedSet = Map<string, THREE.Material> // source material name → shared tinted clone

const cache = new Map<string, TintedSet>()

function slotSignature(slotMap: MaterialSlotMap): string {
  return Object.keys(slotMap)
    .sort()
    .map((slot) => `${slot}:${[...(slotMap[slot] ?? [])].sort().join(',')}`)
    .join('|')
}

function paletteSignature(variant: MaterialVariant | undefined): string {
  if (!variant) return '∅'
  return Object.keys(variant)
    .sort()
    .map((slot) => `${slot}=${variant[slot]?.color ?? ''}`)
    .join(',')
}

/** Stable cache key: source/manifest identity + slot-map signature + resolved palette values. */
export function variantCacheKey(
  sourceId: string,
  slotMap: MaterialSlotMap,
  variant: MaterialVariant | undefined,
): string {
  return `${sourceId}|${slotSignature(slotMap)}|${paletteSignature(variant)}`
}

/**
 * Returns the shared tinted material-set for `key`, building it once from `sourceScene`'s
 * slot materials (cloned, then recolored per `variant`). Never mutates/disposes the source.
 */
export function acquireTintedMaterials(
  key: string,
  sourceScene: THREE.Object3D,
  slotMap: MaterialSlotMap,
  variant: MaterialVariant | undefined,
): TintedSet {
  const existing = cache.get(key)
  if (existing) return existing

  const slotOfName = new Map<string, string>()
  for (const [slot, names] of Object.entries(slotMap)) {
    for (const name of names ?? []) slotOfName.set(name, slot)
  }

  const tinted: TintedSet = new Map()
  sourceScene.traverse((obj) => {
    const mesh = obj as THREE.Mesh
    if (!mesh.isMesh || !mesh.material) return
    const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material]
    for (const material of materials) {
      const slot = slotOfName.get(material.name)
      if (!slot || tinted.has(material.name)) continue
      const clone = material.clone() // clone the SOURCE (never mutate/dispose it)
      clone.name = material.name
      const color = variant?.[slot]?.color
      const std = clone as THREE.MeshStandardMaterial
      if (color && std.color) std.color.set(color)
      tinted.set(material.name, clone)
    }
  })

  cache.set(key, tinted)
  return tinted
}

/** Swaps an instance's cloned-scene materials to the shared tinted set (by material name). */
export function assignTintedMaterials(instanceScene: THREE.Object3D, tinted: TintedSet): void {
  instanceScene.traverse((obj) => {
    const mesh = obj as THREE.Mesh
    if (!mesh.isMesh || !mesh.material) return
    const swap = (m: THREE.Material): THREE.Material => tinted.get(m.name) ?? m
    mesh.material = Array.isArray(mesh.material) ? mesh.material.map(swap) : swap(mesh.material)
  })
}

/** DEV/test: cache occupancy (distinct keys + total cached material objects). */
export function variantCacheStats(): { keys: number; materials: number } {
  let materials = 0
  for (const set of cache.values()) materials += set.size
  return { keys: cache.size, materials }
}

/** Test-only: clear the process cache between cases. */
export function _resetVariantMaterialCache(): void {
  cache.clear()
}
