import type * as THREE from 'three'
import type { AnimationRole, CharacterAssetDefinition } from './characterTypes'

/**
 * Data-driven character asset contract. Gameplay refers to semantic roles;
 * every asset quirk (clip names, forward axis, scale, slots) lives HERE and
 * in the adapter — never in components.
 */

export const CHARACTER_ASSETS: Record<string, CharacterAssetDefinition> = {
  blocklife_person: {
    id: 'blocklife_person',
    modelPath: 'assets/models/characters/blocklife_person.glb',
    scale: 1,
    rotationOffset: 0, // authored facing +z, matching heading = atan2(x, z)
    verticalOffset: 0, // authored with feet at y = 0
    skeletonRootName: 'Hips',
    materialSlots: {
      skin: ['skin'],
      hair: ['hair'],
      shirt: ['shirt'],
      pants: ['pants'],
      shoes: ['shoes'],
      accessory: ['accessory'], // issue #23: recolorable cap (the population accessory axis)
    },
    clips: {
      // Aliases tried in order — future packs list their own names here.
      idle: ['Idle', 'idle', 'IDLE_01'],
      walk: ['Walk', 'walk', 'Walking'],
      run: ['Run', 'run', 'Running', 'Sprint'],
    },
    animationSpeedScale: { walk: 1, run: 1 },
    bounds: { visualHeight: 1.92, radius: 0.38, centerY: 1.0, headY: 1.78 },
    anchors: { headY: 2.15, chestY: 1.1 },
    fallback: { primitiveStyle: 'blocklife_primitive' },
  },
  // ---- Issue #21 §4: production low-poly humanoids (Meshy → rig). Single baked
  // texture (no wardrobe slots — appearance is the model's own), Hips-rooted rig.
  // v1 maps all locomotion roles to the one rigged walk clip; a distinct run is a
  // bounded follow-up (see docs/3D_ASSET_PIPELINE.md). ----
  blocklife_female_01: {
    id: 'blocklife_female_01',
    modelPath: 'assets/models/characters/blocklife_female_01.glb',
    scale: 1,
    rotationOffset: 0,
    verticalOffset: 0,
    skeletonRootName: 'Hips',
    materialSlots: {}, // one baked material; no per-slot wardrobe recolor
    clips: {
      idle: ['Armature|walking_man|baselayer'],
      walk: ['Armature|walking_man|baselayer'],
      run: ['Armature|walking_man|baselayer'],
    },
    animationSpeedScale: { walk: 1, run: 1 },
    staticIdle: true, // rig ships only a walk clip → hold still when idle, don't march in place
    bounds: { visualHeight: 1.8, radius: 0.4, centerY: 0.9, headY: 1.68 },
    anchors: { headY: 2.0, chestY: 1.1 },
    fallback: { primitiveStyle: 'blocklife_primitive' },
  },
  blocklife_male_01: {
    id: 'blocklife_male_01',
    modelPath: 'assets/models/characters/blocklife_male_01.glb',
    scale: 1,
    rotationOffset: 0,
    verticalOffset: 0,
    skeletonRootName: 'Hips',
    materialSlots: {},
    clips: {
      idle: ['Armature|walking_man|baselayer'],
      walk: ['Armature|walking_man|baselayer'],
      run: ['Armature|walking_man|baselayer'],
    },
    animationSpeedScale: { walk: 1, run: 1 },
    staticIdle: true, // rig ships only a walk clip → hold still when idle, don't march in place
    bounds: { visualHeight: 1.85, radius: 0.42, centerY: 0.92, headY: 1.72 },
    anchors: { headY: 2.05, chestY: 1.12 },
    fallback: { primitiveStyle: 'blocklife_primitive' },
  },
  // ---- Issue #38 Integration Wave 0 — CANDIDATE characters (not in any runtime slot) ----
  // ONE production GLB per character carrying all three semantic clips on the canonical
  // 24-bone rig (hierarchy signature c432d433d51d). Clip names are the literal role names
  // already listed in the alias tables below, so nothing new is needed in the controller —
  // idle/walk/run resolve through the EXISTING resolveClips path.
  //
  // Baked appearance (ONE material) => `materialSlots: {}` => no wardrobe / identity axes. Per
  // the 2026-08-31 owner decision these are therefore CANDIDATE assets only: present, valid and
  // loadable, but NOT the player and NOT referenced by any NPC def. `wave0Contract.test.ts`
  // gates that separation so a future edit cannot quietly regress the wardrobe.
  blocklife_kabir_01: {
    id: 'blocklife_kabir_01',
    modelPath: 'assets/models/characters/blocklife_kabir_01.glb',
    scale: 1,
    rotationOffset: 0,
    verticalOffset: 0,
    skeletonRootName: 'Hips',
    materialSlots: {},
    clips: { idle: ['Idle'], walk: ['Walk'], run: ['Run'] },
    animationSpeedScale: { walk: 1, run: 1 },
    bounds: { visualHeight: 1.75, radius: 0.4, centerY: 0.88, headY: 1.63 },
    anchors: { headY: 1.95, chestY: 1.08 },
    fallback: { primitiveStyle: 'blocklife_primitive' },
  },
  blocklife_ravi_01: {
    id: 'blocklife_ravi_01',
    modelPath: 'assets/models/characters/blocklife_ravi_01.glb',
    scale: 1,
    rotationOffset: 0,
    verticalOffset: 0,
    skeletonRootName: 'Hips',
    materialSlots: {},
    clips: { idle: ['Idle'], walk: ['Walk'], run: ['Run'] },
    animationSpeedScale: { walk: 1, run: 1 },
    bounds: { visualHeight: 1.76, radius: 0.4, centerY: 0.88, headY: 1.64 },
    anchors: { headY: 1.96, chestY: 1.09 },
    fallback: { primitiveStyle: 'blocklife_primitive' },
  },
  // NOTE (issue #27 H0): the calibration human `human_gold_calibration_01` is deliberately NOT a
  // production CHARACTER_ASSETS entry — it is a not-yet-approved REVIEW asset. It lives outside
  // public/ (dev-review-assets/, absent from the production dist/ bundle) and is loaded only through
  // the DEV review harness (test-API `setReviewCharacterGlb`, which builds a synthetic def). Do NOT
  // add it here until it earns visual sign-off and H1 authorization. See docs/HUMAN_PROOF_H0.md.
}

export const DEFAULT_CHARACTER_ASSET_ID = 'blocklife_person'

/**
 * The asset the PLAYER renders as — the ONE source of truth for that question.
 *
 * Every consumer that describes the player (the renderer, the visibility/occlusion radius,
 * the test/evidence API) must read THIS, never `DEFAULT_CHARACTER_ASSET_ID` directly, so a
 * future change to the player asset cannot leave occlusion or the evidence API describing a
 * character that is not on screen (issue #38 Codex review, finding 3).
 *
 * Issue #38 Wave 0 — OWNER DECISION (2026-08-31): this stays `blocklife_person`. BlockLife's
 * save-backed player wardrobe and the issue #23 identity axes are driven by RECOLORABLE
 * MATERIAL SLOTS; the Wave 0 sprint characters are single-baked-material models that cannot
 * expose them (`materialSlots: {}`), so putting one in this slot would silently retire
 * shipped, save-backed behaviour. They ship as CANDIDATE assets instead — see
 * CANDIDATE_CHARACTER_ASSET_IDS.
 */
export const PLAYER_CHARACTER_ASSET_ID = DEFAULT_CHARACTER_ASSET_ID

/**
 * Issue #38 Wave 0 candidate characters: owner-approved, provenance-tracked, byte-pinned and
 * loadable through the ONE existing AnimatedCharacter pipeline — but deliberately NOT wired to
 * the player slot or any NPC def, because they carry one baked material and therefore cannot
 * expose the wardrobe / identity axes those runtime slots require. They become eligible for a
 * runtime slot only if they are re-authored with real material segmentation.
 */
export const CANDIDATE_CHARACTER_ASSET_IDS = ['blocklife_kabir_01', 'blocklife_ravi_01'] as const

export function getCharacterAsset(id: string): CharacterAssetDefinition | undefined {
  return CHARACTER_ASSETS[id]
}

/** Static definition problems (empty = valid). Exercised by unit tests. */
export function validateCharacterAsset(def: CharacterAssetDefinition): string[] {
  const errors: string[] = []
  if (!def.id) errors.push('missing id')
  if (!def.modelPath?.endsWith('.glb')) errors.push(`"${def.id}": modelPath must be a .glb`)
  if (!(def.scale > 0)) errors.push(`"${def.id}": scale must be positive`)
  for (const role of ['idle', 'walk', 'run'] as AnimationRole[]) {
    if (!def.clips[role]?.length) errors.push(`"${def.id}": missing required clip role "${role}"`)
  }
  const b = def.bounds
  if (!(b.visualHeight > 0.5 && b.visualHeight < 5)) {
    errors.push(`"${def.id}": implausible visualHeight ${b.visualHeight}`)
  }
  if (!(b.radius > 0.1 && b.radius < 2)) errors.push(`"${def.id}": implausible radius`)
  if (!(b.headY > b.centerY)) errors.push(`"${def.id}": headY must be above centerY`)
  if (!def.fallback?.primitiveStyle) errors.push(`"${def.id}": missing primitive fallback`)
  return errors
}

/**
 * Resolves semantic roles → actual clips via the alias lists. Missing
 * OPTIONAL roles are fine; missing required ones are reported so callers
 * can fall back to the primitive.
 */
export function resolveClips(
  def: CharacterAssetDefinition,
  clips: THREE.AnimationClip[],
): { resolved: Partial<Record<AnimationRole, THREE.AnimationClip>>; missing: AnimationRole[] } {
  const byName = new Map(clips.map((c) => [c.name, c]))
  const resolved: Partial<Record<AnimationRole, THREE.AnimationClip>> = {}
  const missing: AnimationRole[] = []
  for (const role of Object.keys(def.clips) as AnimationRole[]) {
    const aliases = def.clips[role] ?? []
    const clip = aliases.map((a) => byName.get(a)).find(Boolean)
    if (clip) resolved[role] = clip
    else if (role === 'idle' || role === 'walk' || role === 'run') missing.push(role)
  }
  return { resolved, missing }
}
