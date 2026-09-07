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

// Issue #23: the population-identity axes. skin/shoes/accessory join shirt/pants/hair as
// per-instance isolated (recolorable) slots. Isolation clones a slot's material only when
// the asset actually declares it (a rig without an `accessory` material simply isolates
// nothing for it) and recolor happens only when the appearance specifies that colour — so
// characters that set only shirt/pants/accent stay byte-identical.
export const CUSTOMIZABLE_SLOTS = ['shirt', 'pants', 'hair', 'skin', 'shoes', 'accessory'] as const
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

/** Wardrobe → materials. Missing slots are silently fine (fail-graceful). The three
 *  core axes always apply; the #23 skin/shoes/accessory axes apply ONLY when specified,
 *  so an appearance that omits them leaves those slots at their source colour. */
export function applyCharacterAppearance(
  slots: ResolvedSlots,
  appearance: CharacterAppearance,
): void {
  const variant: Record<string, { color?: string }> = {
    shirt: { color: appearance.shirtColor },
    pants: { color: appearance.pantsColor },
    hair: { color: appearance.accentColor },
  }
  if (appearance.skinColor) variant.skin = { color: appearance.skinColor }
  if (appearance.shoesColor) variant.shoes = { color: appearance.shoesColor }
  if (appearance.accessoryColor) variant.accessory = { color: appearance.accessoryColor }
  applyVariant(slots as VariantResolvedSlots, variant)
}

// ---- Issue #23 (PR #24 review): GEOMETRY variants -----------------------------------
// The rig authors one mesh per hair / accessory variant (buildCharacterGlb `VARIANT_GROUPS`);
// the runtime shows exactly ONE per identity and hides the rest. Body silhouette is a
// scale-safe build composed with the asset scale. All orthogonal to the colour recolor above.

export const HAIR_VARIANTS = ['short', 'long', 'bun', 'bald'] as const
export const ACCESSORY_VARIANTS = ['scarf', 'glasses', 'bag', 'none'] as const
/** x/z width + y height, multiplied onto the asset scale — visibly distinct silhouettes. */
export const BODY_BUILDS: Record<string, readonly [number, number, number]> = {
  slim: [0.9, 1.01, 0.9],
  average: [1, 1, 1],
  broad: [1.13, 0.99, 1.13],
  tall: [0.97, 1.07, 0.97],
  stocky: [1.08, 0.93, 1.08],
}
export const BODY_BUILD_KEYS = Object.keys(BODY_BUILDS)

const HAIR_PREFIX = 'person_hair__'
const ACCESSORY_PREFIX = 'person_accessory__'

/**
 * Toggle the authored hair + accessory variant meshes so exactly the chosen variant is
 * visible (defaults: `short` hair, `scarf` accessory; `bald`/`none` show neither). A
 * hidden variant mesh isn't rendered, so the unused geometry costs nothing. Recolor is
 * orthogonal — it targets the shared per-group material regardless of which mesh shows.
 * No-op on rigs without variant meshes (e.g. the Meshy humanoids), so it's universally safe.
 */
export function applyCharacterVariants(
  scene: THREE.Object3D,
  appearance: CharacterAppearance,
): void {
  const hair = HAIR_PREFIX + (appearance.hairVariant ?? 'short')
  const accessory = ACCESSORY_PREFIX + (appearance.accessoryVariant ?? 'scarf')
  scene.traverse((node) => {
    const mesh = node as THREE.Mesh
    if (!mesh.isMesh) return
    if (mesh.name.startsWith(HAIR_PREFIX)) mesh.visible = mesh.name === hair
    else if (mesh.name.startsWith(ACCESSORY_PREFIX)) mesh.visible = mesh.name === accessory
  })
}

/** The silhouette scale [x,y,z] for an appearance's build (defaults to `average`). */
export function bodyBuildScale(
  appearance: CharacterAppearance,
): readonly [number, number, number] {
  return BODY_BUILDS[appearance.bodyBuild ?? 'average'] ?? BODY_BUILDS.average
}

/** Identity build, i.e. "do not reshape this body". */
export const AUTHORED_BUILD: readonly [number, number, number] = [1, 1, 1]

/**
 * The build vector actually applied to a body, honouring its `proportions` policy — the ONE place
 * that decision is made, so the renderer and the contract gate cannot disagree about it.
 */
export function effectiveBuildScale(
  def: { proportions?: 'registry' | 'authored' },
  appearance: CharacterAppearance,
): readonly [number, number, number] {
  return def.proportions === 'authored' ? AUTHORED_BUILD : bodyBuildScale(appearance)
}

/** Disposes isolated (customizable) materials on unmount (no leak across remounts). */
export function disposeIsolatedMaterials(slots: ResolvedSlots): void {
  disposeVariantMaterials(slots as VariantResolvedSlots, CUSTOMIZABLE_SLOTS)
}
