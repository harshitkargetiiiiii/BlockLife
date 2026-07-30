/**
 * Derived home metrics (issue #17 §7) — ONE pure, bounded, deterministic calculator.
 * Comfort/Style (0–100), effective Storage capacity, Sleep Quality (0–100), and
 * Hosting Capacity are COMPUTED from the property base + fixtures + placed furniture,
 * never separately persisted. Anti-inflation is structural:
 *  - category COVERAGE beats spam: the best piece in a category counts full, the 2nd
 *    at 0.4, the 3rd+ at 0.15;
 *  - DUPLICATE copies of the same def add sharply less STYLE (2nd 0.25, 3rd+ 0);
 *  - a theme-coherence bonus is capped at +8 style;
 *  - everything clamps to [0,100].
 * So N identical sofas can never push a metric to the cap — proven by invariant tests.
 */
import type { FurnitureDef, HomeMetrics, MetricContribution, PropertyDef } from './housingTypes'

const clamp100 = (v: number): number => Math.max(0, Math.min(100, Math.round(v)))

/** Coverage multiplier by rank within a category (best piece first). */
function coverageMult(rankInCategory: number): number {
  return rankInCategory === 0 ? 1 : rankInCategory === 1 ? 0.4 : 0.15
}
/** Duplicate-def STYLE multiplier by how many of THIS def are already counted. */
function dupStyleMult(dupIndex: number): number {
  return dupIndex === 0 ? 1 : dupIndex === 1 ? 0.25 : 0
}

/** Seats a guest needs — one per guest. */
const SEATS_PER_GUEST = 1

export function computeHomeMetrics(property: PropertyDef, placed: readonly FurnitureDef[]): HomeMetrics {
  const contributions: MetricContribution[] = []
  let comfort = property.baseComfort
  let style = property.baseStyle
  let storageCapacity = property.baseStorageCapacity
  contributions.push({ source: `${property.displayName} (base)`, comfort: property.baseComfort, style: property.baseStyle, storage: property.baseStorageCapacity })
  for (const f of property.fixtures) {
    comfort += f.comfort
    style += f.style
    storageCapacity += f.storage ?? 0
    contributions.push({ source: `Fixture: ${f.id}`, comfort: f.comfort, style: f.style, storage: f.storage ?? 0 })
  }

  // Group placed furniture by category so coverage applies per category.
  const byCategory = new Map<string, FurnitureDef[]>()
  for (const d of placed) {
    const arr = byCategory.get(d.category) ?? []
    arr.push(d)
    byCategory.set(d.category, arr)
  }

  const defCount = new Map<string, number>()
  let seating = 0
  let bestBedSleep = 0
  for (const defs of byCategory.values()) {
    // Best piece (comfort+style) first, so a duplicate never out-ranks a distinct upgrade.
    const sorted = [...defs].sort((a, b) => b.comfort + b.style - (a.comfort + a.style))
    sorted.forEach((def, rank) => {
      const seen = defCount.get(def.id) ?? 0
      defCount.set(def.id, seen + 1)
      const cov = coverageMult(rank)
      const addComfort = def.comfort * cov
      const addStyle = def.style * cov * dupStyleMult(seen)
      comfort += addComfort
      style += addStyle
      storageCapacity += def.storage // storage is capacity — full, not diminished
      seating += def.seating
      if (def.category === 'bed') bestBedSleep = Math.max(bestBedSleep, def.sleepQuality)
      if (addComfort > 0 || addStyle > 0 || def.storage > 0) {
        contributions.push({ source: def.displayName, comfort: Math.round(addComfort), style: Math.round(addStyle), storage: def.storage })
      }
    })
  }

  // Capped theme-coherence bonus: +2 style per placed item sharing the dominant tag
  // beyond the first, capped at +8.
  const themeCounts = new Map<string, number>()
  for (const d of placed) for (const t of d.themeTags ?? []) themeCounts.set(t, (themeCounts.get(t) ?? 0) + 1)
  const dominant = Math.max(0, ...themeCounts.values())
  const themeBonus = Math.min(8, Math.max(0, dominant - 1) * 2)
  style += themeBonus

  const sleepQuality = clamp100(property.baseSleepQuality + bestBedSleep)
  const hostingCapacity = Math.max(0, Math.min(property.hostingCapacity, Math.floor(seating / SEATS_PER_GUEST)))

  return {
    comfort: clamp100(comfort),
    style: clamp100(style),
    storageCapacity: Math.max(0, Math.round(storageCapacity)),
    sleepQuality,
    hostingCapacity,
    contributions,
    nextUpgrade: nextUpgradeHint(placed, seating, bestBedSleep),
    themeBonus,
  }
}

/** A short, deterministic "next useful upgrade" hint (issue §7). */
function nextUpgradeHint(placed: readonly FurnitureDef[], seating: number, bestBedSleep: number): string {
  const has = (cat: string): boolean => placed.some((d) => d.category === cat)
  if (bestBedSleep === 0) return 'Add a bed for better sleep.'
  if (seating < 2) return 'Add seating so you can host guests.'
  if (!has('storage')) return 'Add storage to expand your capacity.'
  if (!has('wardrobe')) return 'Add a wardrobe to save outfit presets.'
  if (!has('entertainment')) return 'Add a TV to unlock Movie Night.'
  if (!has('decor')) return 'Add decor to raise your style.'
  return 'Your home is looking great.'
}
