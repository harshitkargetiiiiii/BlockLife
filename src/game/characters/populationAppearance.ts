import type { CharacterAppearance } from './characterTypes'
import { createRng, hashString, type SeededRng } from '../traffic/routing/routeRng'
import { HAIR_VARIANTS, ACCESSORY_VARIANTS, BODY_BUILD_KEYS } from './characterMaterials'

/**
 * Issue #23 — the ONE reusable population appearance registry. It turns a stable
 * identity key into a rich, art-directed `CharacterAppearance` across the six
 * variant axes (skin / hair / shirt / pants / shoes / accessory), and is the single
 * source of visual identity for the named cast, the ambient crowd, and the
 * representative-player path.
 *
 * It sits ON TOP of the existing per-instance variant machinery (`characterMaterials`
 * → `assetVariants`) — it produces the DATA; the pipeline applies it. It reuses the
 * project's deterministic RNG (`routeRng`), so the same id always yields the same
 * look (streaming, save/load and visual tests stay stable). **Visual identity only —
 * gameplay identity (the NPC/social id) is separate and never derived from this.**
 */

// Curated per-axis palettes: broad enough for a distinct-feeling population, small
// enough to stay art-directed. Ordered light→deep / dark→light so a stable index reads.
export const SKIN_TONES = [
  '#ffdbac', '#f1c27d', '#e0ac69', '#c68642', '#8d5524', '#5c3836',
] as const
export const HAIR_COLORS = [
  '#0b0b0b', '#2b1b17', '#3d2314', '#5c4033', '#7a5230', '#a8763e', '#d9b382', '#8a8a8a',
] as const
export const SHIRT_COLORS = [
  '#b62032', '#2f8f5b', '#3a5fb0', '#e2b04a', '#8d6a9f', '#c25b52',
  '#f4a259', '#3d9a9a', '#d98553', '#556f7a', '#9a5fc0', '#4a7fd4',
] as const
export const PANTS_COLORS = [
  '#1e2631', '#333333', '#2b3a55', '#4a3b2a', '#556633', '#3d405b', '#5a5a5a', '#2e2e38',
] as const
export const SHOES_COLORS = ['#2b2620', '#111111', '#5c4033', '#7a7a7a', '#3a2a1a'] as const
export const ACCESSORY_COLORS = ['#b62032', '#2f8f5b', '#e2b04a', '#3a5fb0', '#2b2620', '#f4f4f4'] as const

/** Distinct draw per axis from a running RNG (independent axes, not a shared modulo). */
function pick<T>(arr: readonly T[], rng: SeededRng): T {
  return arr[Math.min(arr.length - 1, Math.floor(rng() * arr.length))]
}

/**
 * Deterministic rich appearance from a numeric seed — each of the six axes is drawn
 * independently from the same RNG stream, so two ids that collide on one axis still
 * differ on the others. ~6·8·12·8·5·6 ≈ 138k combinations.
 */
export function appearanceForSeed(seed: number): CharacterAppearance {
  const rng = createRng(seed >>> 0)
  return {
    skinColor: pick(SKIN_TONES, rng),
    accentColor: pick(HAIR_COLORS, rng), // accentColor === hair (legacy field name)
    shirtColor: pick(SHIRT_COLORS, rng),
    pantsColor: pick(PANTS_COLORS, rng),
    shoesColor: pick(SHOES_COLORS, rng),
    accessoryColor: pick(ACCESSORY_COLORS, rng),
    // Geometry variants (issue #23 / PR #24 review) — drawn independently so silhouette,
    // hairstyle and accessory type vary across the crowd, not just colour.
    hairVariant: pick(HAIR_VARIANTS, rng),
    accessoryVariant: pick(ACCESSORY_VARIANTS, rng),
    bodyBuild: pick(BODY_BUILD_KEYS, rng),
  }
}

/**
 * Curated UNIQUE identity per named NPC — recognizable + art-directed. Each keeps its
 * long-standing signature colour as the shirt (so the cast stays recognizable across
 * the upgrade) while gaining distinct skin / hair / shoes / accessory. Keyed by the
 * NPC id (== social + save id); this is VISUAL identity only.
 */
export const NAMED_IDENTITIES: Record<string, CharacterAppearance> = {
  // Ravi — your friend; warm casual, signature blue.
  npc_ravi_01: { skinColor: '#e0ac69', accentColor: '#2b1b17', shirtColor: '#4a7fd4', pantsColor: '#2b3a55', shoesColor: '#2b2620', accessoryColor: '#b62032', hairVariant: 'short', accessoryVariant: 'scarf', bodyBuild: 'average' },
  // Maya — food-truck owner; apron warmth, signature pink.
  npc_maya_01: { skinColor: '#c68642', accentColor: '#0b0b0b', shirtColor: '#e0576f', pantsColor: '#333333', shoesColor: '#2b2620', accessoryColor: '#f4a259', hairVariant: 'bun', accessoryVariant: 'none', bodyBuild: 'average' },
  // Officer Kim — neighbourhood patrol; uniform blue + cap.
  npc_kim_01: { skinColor: '#f1c27d', accentColor: '#2b1b17', shirtColor: '#3f5f8f', pantsColor: '#2b3a55', shoesColor: '#111111', accessoryColor: '#1e2631', hairVariant: 'short', accessoryVariant: 'glasses', bodyBuild: 'broad' },
  // Coach Bruno — gym trainer; athletic orange.
  npc_bruno_01: { skinColor: '#8d5524', accentColor: '#0b0b0b', shirtColor: '#d4763a', pantsColor: '#333333', shoesColor: '#5c4033', accessoryColor: '#b62032', hairVariant: 'short', accessoryVariant: 'none', bodyBuild: 'stocky' },
  // Leo — delivery; hi-vis green + bag.
  npc_leo_01: { skinColor: '#ffdbac', accentColor: '#a8763e', shirtColor: '#6cc24a', pantsColor: '#333333', shoesColor: '#2b2620', accessoryColor: '#e2b04a', hairVariant: 'short', accessoryVariant: 'bag', bodyBuild: 'tall' },
  // Nisha — your neighbour; signature purple.
  npc_nisha_01: { skinColor: '#c68642', accentColor: '#2b1b17', shirtColor: '#9a5fc0', pantsColor: '#3d405b', shoesColor: '#5c4033', accessoryColor: '#d9b382', hairVariant: 'long', accessoryVariant: 'scarf', bodyBuild: 'average' },
}

/**
 * The ONE entry point: a rich appearance for any character id. Named NPCs get their
 * curated identity; everyone else (ambient citizens, ad-hoc ids) gets deterministic,
 * stable variety seeded from the id. Same id → same look, every session.
 */
export function appearanceForId(id: string): CharacterAppearance {
  return NAMED_IDENTITIES[id] ?? appearanceForSeed(hashString(id))
}

/** Registry summary for DEV/tests — how many curated identities + axis sizes. */
export function populationAppearanceInfo() {
  return {
    namedIdentities: Object.keys(NAMED_IDENTITIES).length,
    axes: {
      skin: SKIN_TONES.length,
      hair: HAIR_COLORS.length,
      shirt: SHIRT_COLORS.length,
      pants: PANTS_COLORS.length,
      shoes: SHOES_COLORS.length,
      accessory: ACCESSORY_COLORS.length,
    },
  }
}
