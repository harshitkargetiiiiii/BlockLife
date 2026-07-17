import * as THREE from 'three'
import type {
  CharacterAppearance,
  CharacterAssetDefinition,
  MaterialSlotMap,
} from './characterTypes'

/**
 * Material policy:
 * - Slots the wardrobe can recolor (shirt/pants/hair) are ISOLATED: cloned
 *   once per character instance so the player's outfit never touches an
 *   NPC's, and the shared GLB source cache is never mutated.
 * - Untouched slots (skin/shoes/eyes/…) keep the source materials — shared
 *   is fine because nothing writes to them.
 * - Cloning preserves every property (maps, roughness, skinning, alpha,
 *   emissive); appearance application only writes `color`.
 *
 * Future extension: add a slot to CUSTOMIZABLE_SLOTS + a manifest mapping
 * and it becomes recolorable — skin tones, shoes, accessories need no new
 * machinery. Model swapping/body variants are new manifest entries.
 */

export const CUSTOMIZABLE_SLOTS = ['shirt', 'pants', 'hair'] as const
export type CustomizableSlot = (typeof CUSTOMIZABLE_SLOTS)[number]

export type ResolvedSlots = Partial<Record<keyof MaterialSlotMap, THREE.Material[]>>

/** One traversal: slot name → the material instances currently on meshes. */
export function resolveCharacterMaterialSlots(
  def: CharacterAssetDefinition,
  scene: THREE.Object3D,
): ResolvedSlots {
  const wanted = new Map<string, keyof MaterialSlotMap>()
  for (const [slot, names] of Object.entries(def.materialSlots) as [
    keyof MaterialSlotMap,
    string[],
  ][]) {
    for (const name of names ?? []) wanted.set(name, slot)
  }
  const resolved: ResolvedSlots = {}
  scene.traverse((node) => {
    const mesh = node as THREE.Mesh
    if (!mesh.isMesh || !mesh.material) return
    const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material]
    for (const material of materials) {
      const slot = wanted.get(material.name)
      if (!slot) continue
      const list = (resolved[slot] ??= [])
      if (!list.includes(material)) list.push(material)
    }
  })
  return resolved
}

/**
 * Clones the customizable slots' materials and swaps them onto the meshes
 * (supports multi-material meshes and several meshes sharing one slot).
 * Returns the isolated materials per slot. Runs once per instance.
 */
export function createCustomizableMaterialInstances(
  def: CharacterAssetDefinition,
  scene: THREE.Object3D,
): ResolvedSlots {
  const customizableNames = new Set<string>()
  for (const slot of CUSTOMIZABLE_SLOTS) {
    for (const name of def.materialSlots[slot] ?? []) customizableNames.add(name)
  }
  const clones = new Map<THREE.Material, THREE.Material>()
  scene.traverse((node) => {
    const mesh = node as THREE.Mesh
    if (!mesh.isMesh || !mesh.material) return
    const swap = (m: THREE.Material): THREE.Material => {
      if (!customizableNames.has(m.name)) return m
      let clone = clones.get(m)
      if (!clone) {
        clone = m.clone() // preserves maps/roughness/skinning/alpha/emissive
        clone.name = m.name
        clones.set(m, clone)
      }
      return clone
    }
    mesh.material = Array.isArray(mesh.material)
      ? mesh.material.map(swap)
      : swap(mesh.material)
  })
  return resolveCharacterMaterialSlots(def, scene)
}

/** Wardrobe → materials. Missing slots are silently fine (fail-graceful). */
export function applyCharacterAppearance(
  slots: ResolvedSlots,
  appearance: CharacterAppearance,
): void {
  const paint = (slot: keyof MaterialSlotMap, color: string) => {
    for (const material of slots[slot] ?? []) {
      const m = material as THREE.MeshStandardMaterial
      if (m.color) m.color.set(color)
    }
  }
  paint('shirt', appearance.shirtColor)
  paint('pants', appearance.pantsColor)
  paint('hair', appearance.accentColor)
}

/** Disposes isolated materials on unmount (no leak across remounts). */
export function disposeIsolatedMaterials(slots: ResolvedSlots): void {
  for (const slot of CUSTOMIZABLE_SLOTS) {
    for (const material of slots[slot] ?? []) material.dispose()
  }
}
