/**
 * Asset material-variant system (issue #21 §3).
 *
 * ONE category-agnostic mechanism for per-instance color/material variants on a
 * loaded GLB, with NO geometry duplication: only the isolated slots' materials
 * are cloned per instance; the shared drei GLTF cache scene is never mutated, so
 * one file backs many differently-painted instances. Character wardrobe
 * (shirt/pants/hair) and vehicle paint (body/wheel) both consume this — the
 * character material module is now a thin adapter over it.
 *
 * A "slot" is a semantic name (e.g. 'paint', 'shirt') mapped to the GLB material
 * names that carry it. Cloning preserves every property (maps, roughness,
 * metalness, skinning, alpha, emissive); a variant override currently writes
 * `color` (the field 100% of our recolor needs use), with the shape left open
 * for future roughness/metalness/emissive overrides without touching callers.
 */
import * as THREE from 'three'

/** Semantic slot name → the GLB material names that carry it. */
export type MaterialSlotMap = Record<string, string[]>

/** Slot name → the live material instances currently on the meshes. */
export type ResolvedSlots = Record<string, THREE.Material[]>

/** Per-slot override. `color` is the only field used today; extensible. */
export interface VariantOverride {
  color?: string
}

/** Slot name → override (a named palette entry resolves to one of these). */
export type MaterialVariant = Record<string, VariantOverride>

/** One traversal: slot name → the unique material instances currently on meshes. */
export function resolveMaterialSlots(
  scene: THREE.Object3D,
  slotMap: MaterialSlotMap,
): ResolvedSlots {
  const nameToSlot = new Map<string, string>()
  for (const [slot, names] of Object.entries(slotMap)) {
    for (const name of names ?? []) nameToSlot.set(name, slot)
  }
  const resolved: ResolvedSlots = {}
  scene.traverse((node) => {
    const mesh = node as THREE.Mesh
    if (!mesh.isMesh || !mesh.material) return
    const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material]
    for (const material of materials) {
      const slot = nameToSlot.get(material.name)
      if (!slot) continue
      const list = (resolved[slot] ??= [])
      if (!list.includes(material)) list.push(material)
    }
  })
  return resolved
}

/**
 * Clones the materials of the given slots and swaps them onto the meshes, so
 * recoloring THIS instance never touches the shared cache or another instance.
 * Multi-material meshes and several meshes sharing one slot are handled. Returns
 * the isolated materials per slot (the set a variant then recolors). Once per
 * instance.
 */
export function createVariantInstances(
  scene: THREE.Object3D,
  slotMap: MaterialSlotMap,
  isolate: readonly string[],
): ResolvedSlots {
  const isolateNames = new Set<string>()
  for (const slot of isolate) {
    for (const name of slotMap[slot] ?? []) isolateNames.add(name)
  }
  const clones = new Map<THREE.Material, THREE.Material>()
  scene.traverse((node) => {
    const mesh = node as THREE.Mesh
    if (!mesh.isMesh || !mesh.material) return
    const swap = (m: THREE.Material): THREE.Material => {
      if (!isolateNames.has(m.name)) return m
      let clone = clones.get(m)
      if (!clone) {
        clone = m.clone() // preserves maps/roughness/metalness/skinning/alpha/emissive
        clone.name = m.name
        clones.set(m, clone)
      }
      return clone
    }
    mesh.material = Array.isArray(mesh.material) ? mesh.material.map(swap) : swap(mesh.material)
  })
  const isolatedMap: MaterialSlotMap = {}
  for (const slot of isolate) isolatedMap[slot] = slotMap[slot] ?? []
  return resolveMaterialSlots(scene, isolatedMap)
}

/** Applies a variant's overrides (currently color) to resolved slots. Missing slots are fine. */
export function applyVariant(slots: ResolvedSlots, variant: MaterialVariant): void {
  for (const [slot, override] of Object.entries(variant)) {
    if (!override.color) continue
    for (const material of slots[slot] ?? []) {
      const m = material as THREE.MeshStandardMaterial
      if (m.color) m.color.set(override.color)
    }
  }
}

/** Disposes the isolated materials on unmount (no leak across remounts). */
export function disposeVariantMaterials(slots: ResolvedSlots, isolate?: readonly string[]): void {
  const which = isolate ?? Object.keys(slots)
  for (const slot of which) {
    for (const material of slots[slot] ?? []) material.dispose()
  }
}
