/**
 * Character Model + Animation Pipeline v1.
 *
 * Ownership boundaries:
 * - gameplay movement owns position/velocity/heading/driving state
 * - physics owns the collider
 * - THIS module owns the visual model, skeleton, clips, per-instance
 *   materials and animation playback
 * - wardrobe owns appearance selection; save/load owns its persistence
 * - the visibility system owns occlusion; it reads bounds from here
 * - NPC behavior owns destinations; animation reads normalized INTENT,
 *   never raw input keys — animation must never become a second movement
 *   system.
 */

/** Semantic animation roles — gameplay never references clip names. */
export type AnimationRole = 'idle' | 'walk' | 'run' | 'sit' | 'drive'

/** Semantic machine states. v1 implements idle/walk/run/driving/disabled;
    the rest are reserved so future work extends data, not interfaces. */
export type CharacterAnimState =
  | 'idle'
  | 'walk'
  | 'run'
  | 'driving'
  | 'disabled'
  // Future-ready (not implemented in v1):
  | 'sit'
  | 'interact'
  | 'emote'
  | 'carry'
  | 'useObject'
  | 'enterVehicle'
  | 'exitVehicle'

export type CharacterRenderMode = 'auto' | 'model' | 'primitive'

/** Future LOD intent: hero animates every frame; ambient will reduce rate. */
export type CharacterQualityTier = 'hero' | 'namedNpc' | 'ambient' | 'primitive'

/** Semantic wardrobe slots → material names inside the asset. */
export interface MaterialSlotMap {
  skin?: string[]
  hair?: string[]
  shirt?: string[]
  pants?: string[]
  shoes?: string[]
  accessory?: string[]
}

export interface CharacterBounds {
  visualHeight: number
  radius: number
  centerY: number
  headY: number
}

/** Root-relative anchors (labels, prompts, bubbles, future items/emotes). */
export interface CharacterAnchors {
  headY: number
  chestY: number
}

export interface CharacterAssetDefinition {
  id: string
  modelPath: string
  scale: number
  /** Yaw correction if the asset's forward axis isn't +z. */
  rotationOffset?: number
  verticalOffset?: number
  skeletonRootName?: string
  materialSlots: MaterialSlotMap
  /** Semantic role → clip-name aliases, tried in order. */
  clips: Partial<Record<AnimationRole, string[]>>
  /** Bounded playback-rate scaling relative to movement speed. */
  animationSpeedScale?: { walk?: number; run?: number }
  /**
   * When the asset has no distinct idle clip (its `idle` role aliases the walk
   * clip, e.g. a Meshy rig that only ships walk+run), hold the idle at a single
   * static frame instead of looping the walk cycle in place while standing.
   */
  staticIdle?: boolean
  /**
   * Whether the population registry's `bodyBuild` silhouette may scale this body.
   *
   * `'registry'` (the default, and the only pre-issue-#47 behaviour) multiplies the NON-UNIFORM
   * build vector onto `scale` — that is how issue #23 gives the shared rig visibly distinct
   * silhouettes, and it is right for a rig whose proportions the repo authors.
   *
   * `'authored'` renders the body at its own proportions, uniformly. An owner-approved 1:1 body
   * is a fixed piece of geometry depicting a specific person; stretching it 1.13x in X/Z to make
   * it "broad" distorts the approved art and silently changes its height too (a `stocky` build
   * multiplies Y by 0.93). The registry appearance is NOT discarded — it still drives that NPC's
   * `blocklife_person` error fallback, which is a rig and takes the build as it always did.
   */
  proportions?: 'registry' | 'authored'
  bounds: CharacterBounds
  anchors: CharacterAnchors
  fallback: { primitiveStyle: string }
}

/** Normalized visual locomotion — derived from authoritative movement. */
export interface CharacterMotionState {
  locomotion: 'idle' | 'walk' | 'run' | 'driving' | 'disabled'
  /** World units/second. */
  speed: number
  /** 0..1 within the current gait band. */
  normalizedSpeed: number
  facingAngle: number
  grounded: boolean
  moving: boolean
}

/** Per-instance appearance (mirrors the wardrobe's PlayerAppearance).
 *  The three required fields keep the wardrobe/save contract; issue #23 adds the
 *  richer population-identity axes as OPTIONAL — when a colour is omitted the rig's
 *  source material for that slot is left untouched (no recolor), so existing
 *  characters that set only shirt/pants/accent render byte-identically. */
export interface CharacterAppearance {
  shirtColor: string
  pantsColor: string
  /** Hair colour (legacy name kept for the player wardrobe + save shape). */
  accentColor: string
  /** Issue #23 colour axes (optional, additive). */
  skinColor?: string
  shoesColor?: string
  accessoryColor?: string
  /**
   * Issue #23 (PR #24 review) GEOMETRY-variant axes — which authored variant mesh /
   * silhouette to show, not just its colour. Optional + additive: when omitted the rig
   * shows its default (`short` hair, `scarf` accessory, `average` build). One gameplay
   * identity, one rig — the runtime toggles mesh visibility + a scale-safe body build.
   */
  hairVariant?: string
  accessoryVariant?: string
  bodyBuild?: string
}
