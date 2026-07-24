import { describe, expect, it } from 'vitest'
import { effectiveSalience, insertMemory, pruneDecayed, sanitizeMemories } from './memoryLedger'
import { MEMORY_MAX_PER_NPC, type MemoryEntry } from './socialTypes'

let seq = 0
const mem = (over: Partial<MemoryEntry> = {}): MemoryEntry => ({
  id: over.id ?? `m${seq++}`,
  npcId: 'npc_ravi_01',
  kind: 'conversation',
  gameDay: 0,
  salience: 50,
  valence: 0,
  sourceEventId: over.sourceEventId ?? `e${seq}`,
  pinned: false,
  summaryToken: 'talk',
  ...over,
})

describe('memory ledger — bounded insert, dedupe, decay, eviction', () => {
  it('inserts a new memory', () => {
    const led = insertMemory([], mem({ id: 'a' }), 0)
    expect(led).toHaveLength(1)
    expect(led[0].id).toBe('a')
  })

  it('dedupes a repeated id (reinforces, never duplicates)', () => {
    const led0 = insertMemory([], mem({ id: 'a', salience: 40, gameDay: 1 }), 1)
    const led1 = insertMemory(led0, mem({ id: 'a', salience: 40, gameDay: 3 }), 3)
    expect(led1).toHaveLength(1)
    expect(led1[0].salience).toBe(46) // +REINFORCE
    expect(led1[0].gameDay).toBe(3) // recency refreshed
  })

  it('decay is derived (idempotent) and pins never fade', () => {
    const m = mem({ id: 'a', salience: 50, gameDay: 0 })
    expect(effectiveSalience(m, 0)).toBe(50)
    expect(effectiveSalience(m, 5)).toBe(40) // 50 - 2*5
    expect(effectiveSalience(m, 5)).toBe(40) // idempotent
    const pinned = mem({ id: 'p', salience: 50, gameDay: 0, pinned: true })
    expect(effectiveSalience(pinned, 100)).toBe(50)
  })

  it('prunes faded non-pinned memories but keeps pins', () => {
    const led = [mem({ id: 'weak', salience: 4, gameDay: 0 }), mem({ id: 'pin', salience: 4, gameDay: 0, pinned: true })]
    const pruned = pruneDecayed(led, 10) // weak decays to 0 (<1); pin stays
    expect(pruned.map((m) => m.id)).toEqual(['pin'])
  })

  it('evicts the weakest NON-pinned memory when full, protecting pins', () => {
    let led: MemoryEntry[] = []
    // Fill to max: one low-salience non-pinned, the rest high + one pinned.
    led = insertMemory(led, mem({ id: 'lowest', salience: 10, gameDay: 0 }), 0)
    led = insertMemory(led, mem({ id: 'pinned', salience: 10, gameDay: 0, pinned: true }), 0)
    for (let i = 0; i < MEMORY_MAX_PER_NPC - 2; i++) led = insertMemory(led, mem({ id: `h${i}`, salience: 90, gameDay: 0 }), 0)
    expect(led).toHaveLength(MEMORY_MAX_PER_NPC)
    // One more → evicts 'lowest' (weakest non-pinned), never the pin.
    led = insertMemory(led, mem({ id: 'new', salience: 80, gameDay: 0 }), 0)
    expect(led).toHaveLength(MEMORY_MAX_PER_NPC)
    expect(led.find((m) => m.id === 'lowest')).toBeUndefined()
    expect(led.find((m) => m.id === 'pinned')).toBeDefined()
    expect(led.find((m) => m.id === 'new')).toBeDefined()
  })

  it('sanitizeMemories drops malformed entries, clamps, dedupes, and bounds length', () => {
    const raw = [
      { id: 'ok', kind: 'gift_given', sourceEventId: 'e1', salience: 999, valence: 1, pinned: true, summaryToken: 'gift' },
      { id: 'ok', kind: 'gift_given', sourceEventId: 'e1' }, // duplicate id → dropped
      { kind: 'no_id' }, // missing id → dropped
      'garbage',
      { id: 'bad_salience', kind: 'conversation', sourceEventId: 'e2', salience: -50, valence: 7 },
    ]
    const out = sanitizeMemories(raw, 'npc_x')
    expect(out.map((m) => m.id)).toEqual(['ok', 'bad_salience'])
    expect(out[0].salience).toBe(100) // clamped
    expect(out[0].npcId).toBe('npc_x')
    expect(out[1].salience).toBe(0)
    expect(out[1].valence).toBe(0) // invalid valence → neutral
  })

  it('returns [] for non-array save data', () => {
    expect(sanitizeMemories(null, 'npc_x')).toEqual([])
    expect(sanitizeMemories({ not: 'array' }, 'npc_x')).toEqual([])
  })
})
