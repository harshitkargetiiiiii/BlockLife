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
    // Issue #47 Wave 4 — FITTED to the rig it replaces. The approved bodies are authored at
    // real-world human height (1.70-1.84 m); `blocklife_person`, which every one of these NPCs
    // rendered as before this wave and which the PLAYER still renders as, stands 2.930 m. Shipping
    // these at scale 1 made each named resident ~60 % of the player's height — measured at a
    // 1.674x rendered silhouette ratio, against 1.665 predicted from the bytes. So the rig's height
    // sizes the body, never the reverse (CONVENTIONS #36 restated for characters), and each body
    // keeps the EXACT rendered height its NPC had before Wave 4. Gated in wave4Contract.test.ts.
    scale: 1.6648,
    rotationOffset: 0,
    verticalOffset: 0,
    skeletonRootName: 'Hips',
    materialSlots: {},
    clips: { idle: ['Idle'], walk: ['Walk'], run: ['Run'] },
    animationSpeedScale: { walk: 1, run: 1 },
    bounds: { visualHeight: 1.76, radius: 0.4, centerY: 0.88, headY: 1.64 },
    anchors: { headY: 2.15, chestY: 1.1 },
    fallback: { primitiveStyle: 'blocklife_primitive' },
  },
  // ---- Issue #47 Integration Wave 4 — NAMED-RESIDENT bodies (strict 1:1) ----
  // Each of these is the ONE owner-approved sprint body for ONE named NPC, assembled by
  // scripts/asset-intake/buildWave4.mjs exactly the way Wave 0 assembled Kabir and Ravi: three
  // per-clip sprint GLBs sharing a byte-identical mesh/texture/24-bone `c432d433d51d` skeleton,
  // merged onto ONE production GLB whose clips are renamed to the literal role names the alias
  // tables below already list. Nothing new is needed in the controller — idle/walk/run resolve
  // through the EXISTING `resolveClips` path, and the procedural `blocklife_person` stays the
  // fallback with that NPC's full registry appearance intact.
  //
  // Baked appearance (ONE material) => `materialSlots: {}`. That is why the PLAYER keeps
  // `blocklife_person` (see PLAYER_CHARACTER_ASSET_ID): the save-backed wardrobe needs
  // recolorable slots these bodies cannot expose. For a NAMED NPC the trade is different and
  // issue #47 authorises it explicitly — the approved body IS that character's authored identity,
  // and its baked clothing is immutable (no tint, palette wash or atlas rewrite).
  //
  // `bounds.visualHeight` is the height measured from the SHIPPED bytes by the intake
  // (`inspectRig`), not a transcription; `wave4Contract.test.ts` re-measures it.
  blocklife_maya_01: {
    id: 'blocklife_maya_01',
    modelPath: 'assets/models/characters/blocklife_maya_01.glb',
    // Issue #47 Wave 4 — FITTED to the rig it replaces. The approved bodies are authored at
    // real-world human height (1.70-1.84 m); `blocklife_person`, which every one of these NPCs
    // rendered as before this wave and which the PLAYER still renders as, stands 2.930 m. Shipping
    // these at scale 1 made each named resident ~60 % of the player's height — measured at a
    // 1.674x rendered silhouette ratio, against 1.665 predicted from the bytes. So the rig's height
    // sizes the body, never the reverse (CONVENTIONS #36 restated for characters), and each body
    // keeps the EXACT rendered height its NPC had before Wave 4. Gated in wave4Contract.test.ts.
    scale: 1.7235,
    rotationOffset: 0,
    verticalOffset: 0,
    skeletonRootName: 'Hips',
    materialSlots: {},
    clips: { idle: ['Idle'], walk: ['Walk'], run: ['Run'] },
    animationSpeedScale: { walk: 1, run: 1 },
    bounds: { visualHeight: 1.7, radius: 0.4, centerY: 0.85, headY: 1.58 },
    anchors: { headY: 2.15, chestY: 1.1 },
    fallback: { primitiveStyle: 'blocklife_primitive' },
  },
  blocklife_bruno_01: {
    id: 'blocklife_bruno_01',
    modelPath: 'assets/models/characters/blocklife_bruno_01.glb',
    // Issue #47 Wave 4 — FITTED to the rig it replaces. The approved bodies are authored at
    // real-world human height (1.70-1.84 m); `blocklife_person`, which every one of these NPCs
    // rendered as before this wave and which the PLAYER still renders as, stands 2.930 m. Shipping
    // these at scale 1 made each named resident ~60 % of the player's height — measured at a
    // 1.674x rendered silhouette ratio, against 1.665 predicted from the bytes. So the rig's height
    // sizes the body, never the reverse (CONVENTIONS #36 restated for characters), and each body
    // keeps the EXACT rendered height its NPC had before Wave 4. Gated in wave4Contract.test.ts.
    scale: 1.5924,
    rotationOffset: 0,
    verticalOffset: 0,
    skeletonRootName: 'Hips',
    materialSlots: {},
    clips: { idle: ['Idle'], walk: ['Walk'], run: ['Run'] },
    animationSpeedScale: { walk: 1, run: 1 },
    bounds: { visualHeight: 1.84, radius: 0.42, centerY: 0.92, headY: 1.72 },
    anchors: { headY: 2.15, chestY: 1.1 },
    fallback: { primitiveStyle: 'blocklife_primitive' },
  },
  blocklife_kim_01: {
    id: 'blocklife_kim_01',
    modelPath: 'assets/models/characters/blocklife_kim_01.glb',
    // Issue #47 Wave 4 — FITTED to the rig it replaces. The approved bodies are authored at
    // real-world human height (1.70-1.84 m); `blocklife_person`, which every one of these NPCs
    // rendered as before this wave and which the PLAYER still renders as, stands 2.930 m. Shipping
    // these at scale 1 made each named resident ~60 % of the player's height — measured at a
    // 1.674x rendered silhouette ratio, against 1.665 predicted from the bytes. So the rig's height
    // sizes the body, never the reverse (CONVENTIONS #36 restated for characters), and each body
    // keeps the EXACT rendered height its NPC had before Wave 4. Gated in wave4Contract.test.ts.
    scale: 1.7135,
    rotationOffset: 0,
    verticalOffset: 0,
    skeletonRootName: 'Hips',
    materialSlots: {},
    clips: { idle: ['Idle'], walk: ['Walk'], run: ['Run'] },
    animationSpeedScale: { walk: 1, run: 1 },
    bounds: { visualHeight: 1.71, radius: 0.4, centerY: 0.86, headY: 1.59 },
    anchors: { headY: 2.15, chestY: 1.1 },
    fallback: { primitiveStyle: 'blocklife_primitive' },
  },
  blocklife_nisha_01: {
    id: 'blocklife_nisha_01',
    modelPath: 'assets/models/characters/blocklife_nisha_01.glb',
    // Issue #47 Wave 4 — FITTED to the rig it replaces. The approved bodies are authored at
    // real-world human height (1.70-1.84 m); `blocklife_person`, which every one of these NPCs
    // rendered as before this wave and which the PLAYER still renders as, stands 2.930 m. Shipping
    // these at scale 1 made each named resident ~60 % of the player's height — measured at a
    // 1.674x rendered silhouette ratio, against 1.665 predicted from the bytes. So the rig's height
    // sizes the body, never the reverse (CONVENTIONS #36 restated for characters), and each body
    // keeps the EXACT rendered height its NPC had before Wave 4. Gated in wave4Contract.test.ts.
    scale: 1.7235,
    rotationOffset: 0,
    verticalOffset: 0,
    skeletonRootName: 'Hips',
    materialSlots: {},
    clips: { idle: ['Idle'], walk: ['Walk'], run: ['Run'] },
    animationSpeedScale: { walk: 1, run: 1 },
    bounds: { visualHeight: 1.7, radius: 0.4, centerY: 0.85, headY: 1.58 },
    anchors: { headY: 2.15, chestY: 1.1 },
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
 * Candidate characters: owner-approved, provenance-tracked, byte-pinned and loadable through the
 * ONE existing AnimatedCharacter pipeline — but deliberately NOT wired to the player slot or any
 * NPC def. A candidate is a body with no runtime home: either no NPC in the cast is the person it
 * depicts, or its own named slot rejected it.
 *
 * Issue #38 Wave 0 introduced this list with Kabir AND Ravi on it, because at that time NO baked
 * body was allowed in a runtime slot at all. Issue #47 narrows that decision rather than
 * reversing it: the PLAYER still may never be a baked body (the save-backed wardrobe needs
 * recolorable slots — see PLAYER_CHARACTER_ASSET_ID), but a NAMED NPC may ride the ONE approved
 * body that depicts that exact character. `blocklife_ravi_01` therefore graduated to
 * `WAVE4_NAMED_BODIES`; `blocklife_kabir_01` stays a candidate because Kabir is not a member of
 * the shipped six-resident cast. (The two issue #21 §4 humanoids `blocklife_female_01` /
 * `blocklife_male_01` are also unmapped, but they predate this list and keep their own
 * documented status in docs/3D_ASSET_PIPELINE.md; this list stays the sprint-intake register.)
 */
export const CANDIDATE_CHARACTER_ASSET_IDS = ['blocklife_kabir_01'] as const

/**
 * Issue #47 Wave 4 — the STRICT 1:1 named-resident mapping: NPC id → the ONE approved body that
 * depicts that character.
 *
 * This is the wave's central safety property in data form. Issue #47 permits "Ravi, Maya, Bruno,
 * Leo, Officer Kim and Nisha [to] use their corresponding approved sources only. No identity
 * swapping." A `Record` keyed by NPC id makes the mapping total, one-way and auditable:
 * `wave4Contract.test.ts` asserts it is injective (no body serves two people), that every entry
 * matches `NPC_DEFS[].characterAssetId` exactly, that the intake config built each body from that
 * same character's sources, and that the player is not in it.
 *
 * `npc_leo_01` is deliberately ABSENT. His approved source (`leo-fernandes`) is a hard-hat,
 * hi-vis CONSTRUCTION worker; Leo's shipped role is "Delivery guy" with a delivery-bag accessory.
 * That mapping would drop his role signifier and substitute a different occupation's, which
 * issue #47's wardrobe/identity lock says to reject — so Leo keeps his procedural body and the
 * source is catalogued as ineligible (docs/ASSET_INTEGRATION_WAVE_4.md §Rejected).
 */
export const WAVE4_NAMED_BODIES: Readonly<Record<string, string>> = {
  npc_ravi_01: 'blocklife_ravi_01',
  npc_maya_01: 'blocklife_maya_01',
  npc_bruno_01: 'blocklife_bruno_01',
  npc_kim_01: 'blocklife_kim_01',
  npc_nisha_01: 'blocklife_nisha_01',
}

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
