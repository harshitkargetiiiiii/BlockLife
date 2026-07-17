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
}

export const DEFAULT_CHARACTER_ASSET_ID = 'blocklife_person'

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
