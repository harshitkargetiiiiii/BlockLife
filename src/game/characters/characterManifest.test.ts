import { describe, expect, it } from 'vitest'
import * as THREE from 'three'
import {
  CHARACTER_ASSETS,
  DEFAULT_CHARACTER_ASSET_ID,
  getCharacterAsset,
  resolveClips,
  validateCharacterAsset,
} from './characterManifest'
import type { CharacterAssetDefinition } from './characterTypes'

function makeClip(name: string, duration = 1): THREE.AnimationClip {
  const track = new THREE.QuaternionKeyframeTrack('.quaternion', [0, duration], [0, 0, 0, 1, 0, 0, 0, 1])
  return new THREE.AnimationClip(name, duration, [track])
}

function validDef(overrides: Partial<CharacterAssetDefinition> = {}): CharacterAssetDefinition {
  return {
    ...CHARACTER_ASSETS[DEFAULT_CHARACTER_ASSET_ID],
    ...overrides,
  }
}

describe('validateCharacterAsset', () => {
  it('accepts every shipped asset definition', () => {
    for (const def of Object.values(CHARACTER_ASSETS)) {
      expect(validateCharacterAsset(def)).toEqual([])
    }
  })

  // Issue #27 H0: the calibration human is a REVIEW-only asset — it must NOT leak into the
  // production character manifest (that would ship an unapproved human). Guard against re-adding it.
  it('does not carry the not-yet-approved calibration human in the production manifest', () => {
    expect(getCharacterAsset('human_gold_calibration_01')).toBeUndefined()
    expect(Object.keys(CHARACTER_ASSETS)).not.toContain('human_gold_calibration_01')
  })

  it('rejects a non-glb model path', () => {
    const errors = validateCharacterAsset(validDef({ modelPath: 'assets/person.fbx' }))
    expect(errors.some((e) => e.includes('.glb'))).toBe(true)
  })

  it('rejects a non-positive scale', () => {
    expect(validateCharacterAsset(validDef({ scale: 0 }))).not.toEqual([])
    expect(validateCharacterAsset(validDef({ scale: -1 }))).not.toEqual([])
  })

  it('requires alias lists for idle, walk and run', () => {
    const errors = validateCharacterAsset(validDef({ clips: { idle: ['Idle'], walk: ['Walk'] } }))
    expect(errors.some((e) => e.includes('"run"'))).toBe(true)
  })

  it('rejects implausible bounds', () => {
    const def = validDef({
      bounds: { visualHeight: 40, radius: 0.01, centerY: 2, headY: 1 },
    })
    const errors = validateCharacterAsset(def)
    expect(errors.some((e) => e.includes('visualHeight'))).toBe(true)
    expect(errors.some((e) => e.includes('radius'))).toBe(true)
    expect(errors.some((e) => e.includes('headY'))).toBe(true)
  })

  it('requires a primitive fallback style', () => {
    const errors = validateCharacterAsset(
      validDef({ fallback: { primitiveStyle: '' } }),
    )
    expect(errors.some((e) => e.includes('fallback'))).toBe(true)
  })
})

describe('resolveClips', () => {
  it('resolves each role through its alias list in order', () => {
    const clips = [makeClip('Idle'), makeClip('Walk'), makeClip('Run')]
    const { resolved, missing } = resolveClips(validDef(), clips)
    expect(missing).toEqual([])
    expect(resolved.idle?.name).toBe('Idle')
    expect(resolved.walk?.name).toBe('Walk')
    expect(resolved.run?.name).toBe('Run')
  })

  it('falls through to later aliases when the first is absent', () => {
    // The default def lists run aliases ['Run', 'run', 'Running', 'Sprint'].
    const clips = [makeClip('Idle'), makeClip('Walk'), makeClip('Sprint')]
    const { resolved, missing } = resolveClips(validDef(), clips)
    expect(missing).toEqual([])
    expect(resolved.run?.name).toBe('Sprint')
  })

  it('prefers the earliest alias when several match', () => {
    const clips = [makeClip('Idle'), makeClip('Walk'), makeClip('Sprint'), makeClip('Run')]
    const { resolved } = resolveClips(validDef(), clips)
    expect(resolved.run?.name).toBe('Run')
  })

  it('reports required roles that cannot be resolved', () => {
    const clips = [makeClip('Idle')]
    const { missing } = resolveClips(validDef(), clips)
    expect(missing).toContain('walk')
    expect(missing).toContain('run')
    expect(missing).not.toContain('idle')
  })

  it('treats optional roles (sit/drive) as non-fatal when absent', () => {
    const def = validDef({
      clips: { idle: ['Idle'], walk: ['Walk'], run: ['Run'], drive: ['Drive'] },
    })
    const { resolved, missing } = resolveClips(def, [makeClip('Idle'), makeClip('Walk'), makeClip('Run')])
    expect(missing).toEqual([])
    expect(resolved.drive).toBeUndefined()
  })
})

describe('getCharacterAsset', () => {
  it('returns the default asset and undefined for unknown ids', () => {
    expect(getCharacterAsset(DEFAULT_CHARACTER_ASSET_ID)?.id).toBe(DEFAULT_CHARACTER_ASSET_ID)
    expect(getCharacterAsset('does_not_exist')).toBeUndefined()
  })
})
