import type {
  CharacterAnimState,
  CharacterAppearance,
  CharacterAssetDefinition,
  CharacterQualityTier,
  CharacterRenderMode,
} from './characterTypes'

/**
 * Module-singleton character registry (same pattern as traffic/weather/
 * visibility runtimes): live per-instance state for the debug panel and the
 * dev/test API. Written imperatively from frame loops; never React state.
 */
export interface CharacterInstanceInfo {
  id: string
  tier: CharacterQualityTier
  assetId: string
  renderMode: CharacterRenderMode
  /** What is actually on screen right now. */
  activeVisual: 'model' | 'primitive'
  modelLoaded: boolean
  fallbackReason: string | null
  animState: CharacterAnimState
  previousAnimState: CharacterAnimState
  playbackRate: number
  speed: number
  facingAngle: number
  appearance: CharacterAppearance | null
  resolvedSlots: string[]
  activeActionCount: number
}

export interface CharacterRuntime {
  instances: Map<string, CharacterInstanceInfo>
  /** Debug: force a semantic animation role (null = normal). Frame-loop
      read, so no React subscription needed (unlike render mode, which lives
      in the store). */
  forcedAnimation: 'idle' | 'walk' | 'run' | null
  /** Per-NPC published locomotion intent (walking/speed/heading). */
  npcMotion: Map<string, { walking: boolean; speed: number; heading: number }>
}

export const characterRuntime: CharacterRuntime = {
  instances: new Map(),
  forcedAnimation: null,
  npcMotion: new Map(),
}

/** Pure factory — safe to call from render (no registry side effects). */
export function createCharacterInstanceInfo(
  id: string,
  tier: CharacterQualityTier,
  def: CharacterAssetDefinition,
): CharacterInstanceInfo {
  return {
    id,
    tier,
    assetId: def.id,
    renderMode: 'auto',
    activeVisual: 'primitive',
    modelLoaded: false,
    fallbackReason: null,
    animState: 'idle',
    previousAnimState: 'idle',
    playbackRate: 1,
    speed: 0,
    facingAngle: 0,
    appearance: null,
    resolvedSlots: [],
    activeActionCount: 0,
  }
}

export function registerCharacterInstance(info: CharacterInstanceInfo): void {
  characterRuntime.instances.set(info.id, info)
}

export interface CharacterPopulationStats {
  /** Every registered instance (player + named NPCs + rigged ambient). */
  total: number
  byTier: Record<CharacterQualityTier, number>
  /** Instances actually showing the skinned GLB right now (the real GPU cost). */
  modelActive: number
  /** Instances on the primitive fallback (load pending / forced / failed). */
  primitiveActive: number
}

/**
 * Live population snapshot for the perf report + tests (issue #23). Lets the
 * browser-performance validation attribute frame cost to a concrete, bounded
 * skinned-character count instead of guessing — and lets a test assert the cap
 * holds (no hidden regression from routing the ambient crowd through the rig).
 */
export function characterPopulationStats(): CharacterPopulationStats {
  const byTier: Record<CharacterQualityTier, number> = {
    hero: 0,
    namedNpc: 0,
    ambient: 0,
    primitive: 0,
  }
  let modelActive = 0
  let primitiveActive = 0
  for (const info of characterRuntime.instances.values()) {
    byTier[info.tier] = (byTier[info.tier] ?? 0) + 1
    if (info.activeVisual === 'model') modelActive++
    else primitiveActive++
  }
  return { total: characterRuntime.instances.size, byTier, modelActive, primitiveActive }
}

/**
 * Identity-guarded: only removes the entry if it still belongs to this info
 * object, so a stale cleanup (StrictMode remount, HMR) can't evict a newer
 * registration for the same id.
 */
export function unregisterCharacterInstance(info: CharacterInstanceInfo): void {
  if (characterRuntime.instances.get(info.id) === info) {
    characterRuntime.instances.delete(info.id)
  }
}
