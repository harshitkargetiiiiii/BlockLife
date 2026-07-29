/**
 * The five-skill model (issue #15 §2). PURE + deterministic: bounded integer XP
 * per skill, a derived integer level (0–10) from an inspectable threshold table,
 * and a centralized award reducer that clamps XP, buckets awards by reason for
 * per-day anti-farming caps, and is idempotent when the caller dedupes the event.
 *
 * Skills only ever go UP in v1 (no loss, no time decay — §2). Money/items/
 * relationships are NOT touched here; this file owns XP and nothing else.
 */
import {
  SKILL_DAILY_CAP,
  SKILL_IDS,
  SKILL_LEVEL_THRESHOLDS,
  SKILL_MAX_LEVEL,
  SKILL_XP_MAX,
  SKILL_XP_MIN,
  type SkillAward,
  type SkillMap,
} from './careerTypes'

export function defaultSkills(): SkillMap {
  return { fitness: 0, driving: 0, social: 0, street_smarts: 0, work_ethic: 0 }
}

/** Clamp raw XP to the bounded integer range. */
export function clampXp(xp: number): number {
  if (!Number.isFinite(xp)) return SKILL_XP_MIN
  return Math.max(SKILL_XP_MIN, Math.min(SKILL_XP_MAX, Math.trunc(xp)))
}

/** Derived integer level (0–{@link SKILL_MAX_LEVEL}) from XP — the highest threshold met. */
export function skillLevel(xp: number): number {
  const x = clampXp(xp)
  let level = 0
  for (let i = 1; i < SKILL_LEVEL_THRESHOLDS.length; i++) {
    if (x >= SKILL_LEVEL_THRESHOLDS[i]) level = i
  }
  return Math.min(SKILL_MAX_LEVEL, level)
}

/** Progress toward the NEXT level: { level, xp, into, span, atMax }. Inspectable in the UI. */
export function skillProgress(xp: number): { level: number; xp: number; into: number; span: number; atMax: boolean } {
  const x = clampXp(xp)
  const level = skillLevel(x)
  if (level >= SKILL_MAX_LEVEL) return { level, xp: x, into: 0, span: 0, atMax: true }
  const base = SKILL_LEVEL_THRESHOLDS[level]
  const next = SKILL_LEVEL_THRESHOLDS[level + 1]
  return { level, xp: x, into: x - base, span: next - base, atMax: false }
}

/** A per-day, per-reason spent ledger for anti-farming (bounded by construction). */
export type SkillDailyLedger = Record<string, number> // key: `${day}:${reason}` → xp granted

/** The result of applying an award: the new XP + the actually-granted amount (may be
 *  capped by the daily bucket or the XP ceiling) + the updated ledger. */
export interface SkillAwardResult {
  skills: SkillMap
  ledger: SkillDailyLedger
  grantedAmount: number
}

/**
 * Apply ONE bounded XP award to one skill, respecting the per-source daily cap for
 * farmable reasons. Deterministic + pure; the caller owns exact-once (a duplicate
 * event id must never reach here twice). Returns granted 0 when the daily bucket or
 * the XP ceiling is already full.
 */
export function applySkillAward(skills: SkillMap, ledger: SkillDailyLedger, award: SkillAward, gameDay: number): SkillAwardResult {
  const amount = Math.max(0, Math.trunc(award.amount))
  if (amount === 0 || !SKILL_IDS.includes(award.skill)) return { skills, ledger, grantedAmount: 0 }

  const cap = SKILL_DAILY_CAP[award.reason]
  let allowed = amount
  let nextLedger = ledger
  if (cap !== undefined) {
    const key = `${Math.trunc(gameDay)}:${award.reason}`
    const spent = ledger[key] ?? 0
    allowed = Math.max(0, Math.min(amount, cap - spent))
    if (allowed > 0) nextLedger = { ...ledger, [key]: spent + allowed }
  }
  if (allowed === 0) return { skills, ledger: nextLedger, grantedAmount: 0 }

  const before = clampXp(skills[award.skill])
  const after = clampXp(before + allowed)
  const granted = after - before
  if (granted === 0) return { skills, ledger: nextLedger, grantedAmount: 0 }
  return { skills: { ...skills, [award.skill]: after }, ledger: nextLedger, grantedAmount: granted }
}

/** Apply a batch of awards in order (deterministic). Used by the event pipeline. */
export function applySkillAwards(skills: SkillMap, ledger: SkillDailyLedger, awards: SkillAward[], gameDay: number): SkillAwardResult {
  let s = skills
  let l = ledger
  let total = 0
  for (const a of awards) {
    const r = applySkillAward(s, l, a, gameDay)
    s = r.skills
    l = r.ledger
    total += r.grantedAmount
  }
  return { skills: s, ledger: l, grantedAmount: total }
}

/** Drop stale daily-ledger entries so the map can't grow unbounded across many days. */
export function pruneSkillLedger(ledger: SkillDailyLedger, gameDay: number, keepDays = 2): SkillDailyLedger {
  const cutoff = Math.trunc(gameDay) - keepDays
  const next: SkillDailyLedger = {}
  for (const [key, val] of Object.entries(ledger)) {
    const day = Number(key.split(':')[0])
    if (Number.isFinite(day) && day >= cutoff) next[key] = val
  }
  return next
}

/** Sanitize a loaded skill map field-by-field (unknown skills dropped, XP clamped). */
export function sanitizeSkills(raw: unknown): SkillMap {
  const out = defaultSkills()
  if (!raw || typeof raw !== 'object') return out
  for (const id of SKILL_IDS) {
    const v = (raw as Record<string, unknown>)[id]
    if (typeof v === 'number') out[id] = clampXp(v)
  }
  return out
}

/** Highest level across all skills — a cheap "career readiness" summary for DEV/UI. */
export function topSkillLevel(skills: SkillMap): number {
  return Math.max(...SKILL_IDS.map((id) => skillLevel(skills[id])))
}
