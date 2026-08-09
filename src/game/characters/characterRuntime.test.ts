import { afterEach, describe, expect, it } from 'vitest'
import {
  characterPopulationStats,
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

  // Issue #23: bounded population observability for the perf report.
  it('characterPopulationStats counts total, per-tier, and model-vs-primitive', () => {
    const mk = (id: string, tier: 'hero' | 'namedNpc' | 'ambient', visual: 'model' | 'primitive') => {
      const info = createCharacterInstanceInfo(id, tier, DEF)
      info.activeVisual = visual
      registerCharacterInstance(info)
    }
    mk('player', 'hero', 'model')
    mk('npc_ravi_01', 'namedNpc', 'model')
    mk('cit_office_worker', 'ambient', 'model')
    mk('cit_jogger', 'ambient', 'primitive') // e.g. GLB still loading

    const s = characterPopulationStats()
    expect(s.total).toBe(4)
    expect(s.byTier.hero).toBe(1)
    expect(s.byTier.namedNpc).toBe(1)
    expect(s.byTier.ambient).toBe(2)
    expect(s.byTier.primitive).toBe(0)
    expect(s.modelActive).toBe(3)
    expect(s.primitiveActive).toBe(1)
    expect(s.modelActive + s.primitiveActive).toBe(s.total)
  })
})
