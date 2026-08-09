/**
 * Deterministic randomness for traffic routing. Never Math.random: same
 * seed + same call sequence = same fleet behavior, so tests can pin routes.
 */

/** FNV-1a 32-bit hash for stable string → seed conversion. */
export function hashString(input: string): number {
  let h = 0x811c9dc5
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i)
    h = Math.imul(h, 0x01000193)
  }
  return h >>> 0
}

export type SeededRng = () => number

/**
 * Stable [0, 1) drawn from a string key — deterministic and CLOCK-INDEPENDENT.
 * Unlike a running RNG stream (whose value depends on how many prior draws
 * happened, which in a headless run varies with the frame count), a value keyed
 * by `id:purpose:ordinal` is reproducible across runs. Used for ambient
 * citizen / NPC bark + wander jitter so those are seeded, never `Math.random`.
 */
export function stableUnit(key: string): number {
  return createRng(hashString(key))()
}

/** mulberry32 — small, fast, deterministic sequence generator in [0, 1). */
export function createRng(seed: number): SeededRng {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** Weighted pick with deterministic order sensitivity (stable iteration). */
export function pickWeighted<T>(items: T[], weightOf: (item: T) => number, rng: SeededRng): T | null {
  let total = 0
  for (const item of items) total += Math.max(0, weightOf(item))
  if (total <= 0) return items.length > 0 ? items[0] : null
  let roll = rng() * total
  for (const item of items) {
    roll -= Math.max(0, weightOf(item))
    if (roll <= 0) return item
  }
  return items[items.length - 1]
}
