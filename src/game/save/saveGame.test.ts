import { beforeEach, describe, expect, it, vi } from 'vitest'
import { INITIAL_STATS } from '../player/playerTypes'
import { COFFEE_QUEST_ID } from '../../data/quests'
import { createEmptyNpcMemory } from '../npc/npcTypes'

// In-memory stand-in for IndexedDB (jsdom has no idb implementation).
const memoryStore = new Map<string, unknown>()
vi.mock('idb-keyval', () => ({
  get: async (key: string) => memoryStore.get(key),
  set: async (key: string, value: unknown) => {
    memoryStore.set(key, value)
  },
  del: async (key: string) => {
    memoryStore.delete(key)
  },
}))

const { createSnapshot, isValidSave, persistSave, loadSave, clearSave } = await import('./saveGame')

function sampleInput() {
  return {
    stats: { ...INITIAL_STATS, money: 123, hour: 15.5 },
    inventory: { coffee: 2 },
    questStates: { [COFFEE_QUEST_ID]: 'has_coffee' as const },
    npcMemory: { npc_ravi_01: { ...createEmptyNpcMemory(), trust: 3 } },
    playerPosition: [1, 2, 3] as [number, number, number],
  }
}

describe('saveGame', () => {
  beforeEach(() => memoryStore.clear())

  it('creates a valid, deeply cloned snapshot', () => {
    const input = sampleInput()
    const snap = createSnapshot(input)
    expect(isValidSave(snap)).toBe(true)
    expect(snap.stats).not.toBe(input.stats)
    expect(snap.stats.money).toBe(123)
    input.inventory.coffee = 99
    expect(snap.inventory.coffee).toBe(2)
  })

  it('round-trips through persistence', async () => {
    const snap = createSnapshot(sampleInput())
    await persistSave(snap)
    const loaded = await loadSave()
    expect(loaded).not.toBeNull()
    expect(loaded?.stats.money).toBe(123)
    expect(loaded?.questStates[COFFEE_QUEST_ID]).toBe('has_coffee')
    expect(loaded?.inventory.coffee).toBe(2)
    expect(loaded?.playerPosition).toEqual([1, 2, 3])
    expect(loaded?.npcMemory['npc_ravi_01'].trust).toBe(3)
  })

  it('returns null when nothing is saved', async () => {
    expect(await loadSave()).toBeNull()
  })

  it('clearSave removes the save', async () => {
    await persistSave(createSnapshot(sampleInput()))
    await clearSave()
    expect(await loadSave()).toBeNull()
  })

  it('accepts saves with and without the optional weather field', () => {
    // Pre-weather saves simply lack the field and stay valid (load → clear).
    const legacy = createSnapshot(sampleInput())
    expect(legacy.weather).toBeUndefined()
    expect(isValidSave(legacy)).toBe(true)

    const withWeather = createSnapshot({
      ...sampleInput(),
      weather: { kind: 'rain', wetness: 0.75 },
    })
    expect(isValidSave(withWeather)).toBe(true)
    expect(withWeather.weather).toEqual({ kind: 'rain', wetness: 0.75 })
  })

  it('accepts saves with and without the optional appearance field', () => {
    // Pre-apartment saves lack the field and stay valid (load → default look).
    const legacy = createSnapshot(sampleInput())
    expect(legacy.appearance).toBeUndefined()
    expect(isValidSave(legacy)).toBe(true)

    const dressed = createSnapshot({
      ...sampleInput(),
      appearance: { shirtColor: '#d1495b', pantsColor: '#2b2d33', accentColor: '#5c4033' },
    })
    expect(isValidSave(dressed)).toBe(true)
    expect(dressed.appearance?.shirtColor).toBe('#d1495b')
  })

  it('persists player health, and old saves stay valid without it', () => {
    const legacy = createSnapshot(sampleInput())
    expect(legacy.playerHealth).toBeUndefined()
    expect(isValidSave(legacy)).toBe(true)

    const hurt = createSnapshot({ ...sampleInput(), playerHealth: 42 })
    expect(isValidSave(hurt)).toBe(true)
    expect(hurt.playerHealth).toBe(42)
  })

  it('rejects saves with malformed player health', () => {
    const bad = createSnapshot(sampleInput()) as unknown as Record<string, unknown>
    bad.playerHealth = 'fine'
    expect(isValidSave(bad)).toBe(false)
  })

  it('rejects saves with malformed appearance', () => {
    const bad = createSnapshot(sampleInput()) as unknown as Record<string, unknown>
    bad.appearance = { shirtColor: '#fff' }
    expect(isValidSave(bad)).toBe(false)
  })

  it('rejects saves with malformed weather', () => {
    const badKind = createSnapshot(sampleInput()) as unknown as Record<string, unknown>
    badKind.weather = { kind: 'hurricane', wetness: 0 }
    expect(isValidSave(badKind)).toBe(false)
    const badWetness = createSnapshot(sampleInput()) as unknown as Record<string, unknown>
    badWetness.weather = { kind: 'rain', wetness: 'soaked' }
    expect(isValidSave(badWetness)).toBe(false)
  })

  it('rejects corrupted saves', async () => {
    expect(isValidSave(null)).toBe(false)
    expect(isValidSave({})).toBe(false)
    expect(isValidSave({ version: 99 })).toBe(false)
    const bad = createSnapshot(sampleInput()) as unknown as Record<string, unknown>
    bad.stats = { money: 'lots' }
    expect(isValidSave(bad)).toBe(false)
    const badQuest = createSnapshot(sampleInput()) as unknown as {
      questStates: Record<string, string>
    }
    badQuest.questStates[COFFEE_QUEST_ID] = 'flying'
    expect(isValidSave(badQuest)).toBe(false)
  })
})
