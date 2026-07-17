import type { CharacterAssetDefinition, CharacterBounds } from './characterTypes'

/**
 * Reusable character bounds — computed ONCE from the manifest (never from
 * per-frame Box3 traversal). Consumers: visibility subject samples, label
 * and prompt anchors, camera readability, future crowd spacing and
 * multiplayer interest regions.
 */

export function validateCharacterBounds(b: CharacterBounds): string[] {
  const errors: string[] = []
  if (!(b.visualHeight > 0)) errors.push('visualHeight must be positive')
  if (!(b.radius > 0)) errors.push('radius must be positive')
  if (!(b.centerY > 0 && b.centerY < b.visualHeight)) errors.push('centerY outside body')
  if (!(b.headY > b.centerY && b.headY <= b.visualHeight)) errors.push('headY implausible')
  return errors
}

/**
 * Occlusion sample heights (feet / torso / head) derived from real model
 * bounds instead of primitive assumptions.
 */
export function getVisibilitySampleHeights(def: CharacterAssetDefinition): number[] {
  return [0.2, def.bounds.centerY, def.bounds.headY]
}
