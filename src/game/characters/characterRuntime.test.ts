import { afterEach, describe, expect, it } from 'vitest'
import {
  characterRuntime,
  createCharacterInstanceInfo,
  registerCharacterInstance,
  unregisterCharacterInstance,
} from './characterRuntime'
import { CHARACTER_ASSETS, DEFAULT_CHARACTER_ASSET_ID } from './characterManifest'

const DEF = CHARACTER_ASSETS[DEFAULT_CHARACTER_ASSET_ID]

afterEach(() => {
  characterRuntime.instances.clear()
  characterRuntime.npcMotion.clear()
  characterRuntime.forcedAnimation = null
})

describe('characterRuntime registry', () => {
  it('creates info with safe defaults (primitive until the model mounts)', () => {
    const info = createCharacterInstanceInfo('player', 'hero', DEF)
    expect(info.activeVisual).toBe('primitive')
    expect(info.modelLoaded).toBe(false)
    expect(info.animState).toBe('idle')
    expect(info.assetId).toBe(DEF.id)
    // Pure factory: nothing registered yet.
    expect(characterRuntime.instances.size).toBe(0)
  })

  it('registers and unregisters by id', () => {
    const info = createCharacterInstanceInfo('player', 'hero', DEF)
    registerCharacterInstance(info)
    expect(characterRuntime.instances.get('player')).toBe(info)
    unregisterCharacterInstance(info)
    expect(characterRuntime.instances.has('player')).toBe(false)
  })

  it('a stale unregister cannot evict a newer registration (StrictMode/HMR)', () => {
    const first = createCharacterInstanceInfo('player', 'hero', DEF)
    const second = createCharacterInstanceInfo('player', 'hero', DEF)
    registerCharacterInstance(first)
    registerCharacterInstance(second) // remount replaced it
    unregisterCharacterInstance(first) // late cleanup from the old mount
    expect(characterRuntime.instances.get('player')).toBe(second)
  })
})
