import type * as THREE from 'three'
import type {
  CharacterAppearance,
  CharacterAssetDefinition,
  MaterialSlotMap,
} from './characterTypes'
import {
  applyVariant,
  createVariantInstances,
  disposeVariantMaterials,
  resolveMaterialSlots,
  type MaterialSlotMap as VariantSlotMap,
  type ResolvedSlots as VariantResolvedSlots,
} from '../assets/assetVariants'

/**
 * Character material policy (issue #21 §3 adapter). The wardrobe's semantic
 * slots (skin/shirt/pants/hair/…) are the character-specific naming over the ONE
 * shared variant system in `assetVariants.ts` (which vehicle paint also uses):
 * - Customizable slots (shirt/pants/hair) are ISOLATED — cloned once per instance
 *   so the player's outfit never touches an NPC's and the shared GLB cache is
 *   never mutated.
 * - Untouched slots (skin/shoes/eyes/…) keep the source materials — shared is fine
 *   because nothing writes to them.
 * - Cloning preserves every property (maps, roughness, skinning, alpha, emissive);
 *   appearance application only writes `color`.
 *
 * Future extension: add a slot to CUSTOMIZABLE_SLOTS + a manifest mapping and it
 * becomes recolorable — skin tones, shoes, accessories need no new machinery.
 * Model swapping/body variants are new manifest + CHARACTER_ASSETS entries.
 */

export const CUSTOMIZABLE_SLOTS = ['shirt', 'pants', 'hair'] as const
export type CustomizableSlot = (typeof CUSTOMIZABLE_SLOTS)[number]

export type ResolvedSlots = Partial<Record<keyof MaterialSlotMap, THREE.Material[]>>

/** characterTypes' optional-keyed slot map → the variant system's Record<string,string[]>. */
function toVariantSlotMap(slots: MaterialSlotMap): VariantSlotMap {
  const out: VariantSlotMap = {}
  for (const [slot, names] of Object.entries(slots)) if (names && names.length) out[slot] = names
  return out
}

/** One traversal: slot name → the material instances currently on meshes. */
export function resolveCharacterMaterialSlots(
  def: CharacterAssetDefinition,
  scene: THREE.Object3D,
): ResolvedSlots {
  return resolveMaterialSlots(scene, toVariantSlotMap(def.materialSlots)) as ResolvedSlots
}

/**
 * Clones the customizable slots' materials and swaps them onto the meshes
 * (supports multi-material meshes and several meshes sharing one slot), then
 * returns ALL resolved slots. Runs once per instance.
 */
export function createCustomizableMaterialInstances(
  def: CharacterAssetDefinition,
  scene: THREE.Object3D,
): ResolvedSlots {
  createVariantInstances(scene, toVariantSlotMap(def.materialSlots), CUSTOMIZABLE_SLOTS)
  return resolveCharacterMaterialSlots(def, scene)
}

/** Wardrobe → materials. Missing slots are silently fine (fail-graceful). */
export function applyCharacterAppearance(
  slots: ResolvedSlots,
  appearance: CharacterAppearance,
): void {
  applyVariant(slots as VariantResolvedSlots, {
    shirt: { color: appearance.shirtColor },
    pants: { color: appearance.pantsColor },
    hair: { color: appearance.accentColor },
  })
}

/** Disposes isolated (customizable) materials on unmount (no leak across remounts). */
export function disposeIsolatedMaterials(slots: ResolvedSlots): void {
  disposeVariantMaterials(slots as VariantResolvedSlots, CUSTOMIZABLE_SLOTS)
}
