/**
 * Bounded per-NPC memory ledger (issue #13 §3). Pure + deterministic: dedupe by
 * stable id, salience-based eviction, day-based decay, and durable pins. Memory
 * explains WHY a relationship changed; it never stores dialogue transcripts or
 * unbounded history. All operations return NEW arrays (replay/save-safe).
 *
 * Decay is DERIVED, not destructive: the stored `salience` is the base value and
 * {@link effectiveSalience} subtracts day-based decay on read, so calling decay
 * twice can never compound (idempotent). Eviction and display both rank by the
 * effective value, so faded memories leave first.
 */
import {
  MEMORY_DECAY_PER_DAY,
  MEMORY_MAX_PER_NPC,
  MEMORY_MIN_SALIENCE,
  type MemoryEntry,
} from './socialTypes'

/** Salience added when a duplicate (same id) memory is re-delivered — a repeated
 *  interaction reinforces, capped so it can't run away. */
const REINFORCE_SALIENCE = 6

/** Current salience after day-based decay. Pinned memories never fade. */
export function effectiveSalience(m: MemoryEntry, currentDay: number): number {
  if (m.pinned) return m.salience
  const daysElapsed = Math.max(0, Math.trunc(currentDay) - m.gameDay)
  return Math.max(0, m.salience - MEMORY_DECAY_PER_DAY * daysElapsed)
}

/** Rank key for eviction: lowest effective salience, then oldest, then id. */
function weakest(a: MemoryEntry, b: MemoryEntry, currentDay: number): MemoryEntry {
  const sa = effectiveSalience(a, currentDay)
  const sb = effectiveSalience(b, currentDay)
  if (sa !== sb) return sa < sb ? a : b
  if (a.gameDay !== b.gameDay) return a.gameDay < b.gameDay ? a : b
  return a.id <= b.id ? a : b
}

/**
 * Insert (or reinforce) a memory, keeping the ledger bounded. A repeated id
 * refreshes recency + bumps salience instead of duplicating (deterministic
 * dedupe). When full, the weakest NON-pinned memory is evicted (lowest effective
 * salience → oldest → id); pins are protected, and only the pathological all-pinned
 * overflow falls back to evicting the weakest overall.
 */
export function insertMemory(
  ledger: readonly MemoryEntry[],
  entry: MemoryEntry,
  currentDay: number,
  max = MEMORY_MAX_PER_NPC,
): MemoryEntry[] {
  const existingIdx = ledger.findIndex((m) => m.id === entry.id)
  if (existingIdx >= 0) {
    const prev = ledger[existingIdx]
    const merged: MemoryEntry = {
      ...prev,
      gameDay: entry.gameDay,
      gameHour: entry.gameHour,
      salience: Math.min(100, prev.salience + REINFORCE_SALIENCE),
      pinned: prev.pinned || entry.pinned,
    }
    const out = ledger.slice()
    out[existingIdx] = merged
    return out
  }

  const next = [...ledger, entry]
  if (next.length <= max) return next

  const candidates = next.filter((m) => !m.pinned)
  const pool = candidates.length > 0 ? candidates : next
  let victim = pool[0]
  for (let i = 1; i < pool.length; i++) victim = weakest(victim, pool[i], currentDay)
  return next.filter((m) => m !== victim)
}

/** Drop faded (non-pinned, below floor) memories — call on day rollover, not per
 *  frame. Idempotent because decay is derived from the stored base salience. */
export function pruneDecayed(ledger: readonly MemoryEntry[], currentDay: number): MemoryEntry[] {
  return ledger.filter((m) => m.pinned || effectiveSalience(m, currentDay) >= MEMORY_MIN_SALIENCE)
}

/** Fail-safe load: coerce/clamp every field + bound the array so malformed save
 *  data can never blow the ledger's invariants (§12). Unknown entries dropped. */
export function sanitizeMemories(raw: unknown, npcId: string, max = MEMORY_MAX_PER_NPC): MemoryEntry[] {
  if (!Array.isArray(raw)) return []
  const seen = new Set<string>()
  const out: MemoryEntry[] = []
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue
    const m = item as Record<string, unknown>
    if (typeof m.id !== 'string' || typeof m.kind !== 'string' || typeof m.sourceEventId !== 'string') continue
    if (seen.has(m.id)) continue
    seen.add(m.id)
    out.push({
      id: m.id,
      npcId,
      kind: m.kind as MemoryEntry['kind'],
      counterpartyId: typeof m.counterpartyId === 'string' ? m.counterpartyId : undefined,
      gameDay: Number.isFinite(m.gameDay) ? Math.trunc(m.gameDay as number) : 0,
      gameHour: Number.isFinite(m.gameHour) ? (m.gameHour as number) : undefined,
      district: typeof m.district === 'string' ? m.district : undefined,
      salience: Math.max(0, Math.min(100, Math.round(Number(m.salience) || 0))),
      valence: m.valence === 1 || m.valence === -1 ? m.valence : 0,
      sourceEventId: m.sourceEventId,
      pinned: m.pinned === true,
      summaryToken: typeof m.summaryToken === 'string' ? m.summaryToken : m.kind,
    })
    if (out.length >= max) break
  }
  return out
}
