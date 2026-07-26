/**
 * Career save/load (issue #15 §13) — ONE additive, fail-safe slice inside the
 * existing `SaveData`. Old saves lack `career` and load unemployed with zero skills;
 * a malformed blob is sanitized field-by-field (skills clamped, unknown career/rank/
 * template ids dropped, collections bounded) and can never corrupt the wider save.
 * No runtime object references or streaming registries are persisted. Load is
 * idempotent (reset → apply), and the reload-safe `shiftSeq` is restored so a
 * reload can never mint a duplicate shift id.
 */
import {
  APPLIED_CAREER_EVENT_ID_MAX,
  EMPLOYER_STANDING_MAX,
  EMPLOYER_STANDING_MIN,
  PAID_ATTEMPT_KEY_MAX,
  PERFORMANCE_HISTORY_MAX,
  RANK_ORDER,
  SCHEDULED_SHIFTS_MAX,
  UNLOCKS_MAX,
  type CareerHistory,
  type CareerId,
  type CareerSaveData,
  type EmployerId,
  type PerformanceRecord,
  type RankId,
  type ScheduledShift,
  type ShiftStatus,
} from './careerTypes'
import { isCareerId } from './careerRegistry'
import { sanitizeSkills } from './skills'
import { careerRuntime } from './careerRuntime'
import { defaultCareerState, type CareerState } from './careerEvents'

const CAREER_SAVE_VERSION = 1
const SHIFT_STATUSES: ShiftStatus[] = ['scheduled', 'available', 'active', 'completed', 'missed', 'failed', 'cancelled']

const isRankId = (v: unknown): v is RankId => typeof v === 'string' && (RANK_ORDER as readonly string[]).includes(v)
const clampInt = (v: unknown, lo: number, hi: number, dflt: number): number =>
  typeof v === 'number' && Number.isFinite(v) ? Math.max(lo, Math.min(hi, Math.trunc(v))) : dflt
const strList = (v: unknown, max: number): string[] => {
  if (!Array.isArray(v)) return []
  const out: string[] = []
  for (const x of v) if (typeof x === 'string' && !out.includes(x)) out.push(x)
  return out.slice(-max)
}

/** Serialize the live runtime state into the save slice (plain data only). */
export function serializeCareers(): CareerSaveData {
  const s = careerRuntime.state
  return {
    version: CAREER_SAVE_VERSION,
    skills: { ...s.skills },
    skillLedger: { ...s.skillLedger },
    activeJob: s.activeJob,
    ranks: { ...s.ranks },
    history: { ...s.history },
    employerStanding: { ...s.employerStanding },
    scheduledShifts: s.scheduledShifts.map((sh) => ({ ...sh })),
    activeShift: s.activeShift ? { ...s.activeShift } : null,
    performanceHistory: s.performanceHistory.map((p) => ({ ...p })),
    unlocks: [...s.unlocks],
    appliedEventIds: [...s.appliedEventIds],
    paidAttemptKeys: [...s.paidAttemptKeys],
    recommendations: [...s.recommendations],
    shiftSeq: s.shiftSeq,
  }
}

function sanitizeHistory(raw: unknown): Partial<Record<CareerId, CareerHistory>> {
  const out: Partial<Record<CareerId, CareerHistory>> = {}
  if (!raw || typeof raw !== 'object') return out
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    if (!isCareerId(k) || !v || typeof v !== 'object') continue
    const h = v as Record<string, unknown>
    out[k] = {
      careerId: k,
      completedShifts: clampInt(h.completedShifts, 0, 100000, 0),
      missedShifts: clampInt(h.missedShifts, 0, 100000, 0),
      failedShifts: clampInt(h.failedShifts, 0, 100000, 0),
      highestRank: isRankId(h.highestRank) ? h.highestRank : 'trainee',
      totalEarned: clampInt(h.totalEarned, 0, 100000000, 0),
    }
  }
  return out
}

function sanitizeShift(raw: unknown): ScheduledShift | null {
  if (!raw || typeof raw !== 'object') return null
  const s = raw as Record<string, unknown>
  if (typeof s.id !== 'string' || !isCareerId(s.careerId as string) || !isRankId(s.rank)) return null
  if (typeof s.attemptKey !== 'string') return null
  const status = typeof s.status === 'string' && SHIFT_STATUSES.includes(s.status as ShiftStatus) ? (s.status as ShiftStatus) : 'scheduled'
  return {
    id: s.id,
    careerId: s.careerId as CareerId,
    employerId: typeof s.employerId === 'string' ? s.employerId : '',
    rank: s.rank as RankId,
    templateId: (typeof s.templateId === 'string' ? s.templateId : 'delivery_route') as ScheduledShift['templateId'],
    scheduledDay: clampInt(s.scheduledDay, 0, 1000000, 0),
    startHour: clampInt(s.startHour, 0, 23, 9),
    graceHours: clampInt(s.graceHours, 0, 24, 3),
    durationHours: clampInt(s.durationHours, 1, 24, 4),
    workplaceInteractableId: typeof s.workplaceInteractableId === 'string' ? s.workplaceInteractableId : '',
    status,
    attemptKey: s.attemptKey,
  }
}

function sanitizePerf(raw: unknown): PerformanceRecord[] {
  if (!Array.isArray(raw)) return []
  const out: PerformanceRecord[] = []
  for (const v of raw) {
    if (!v || typeof v !== 'object') continue
    const p = v as Record<string, unknown>
    if (!isCareerId(p.careerId as string) || typeof p.shiftId !== 'string') continue
    out.push({
      careerId: p.careerId as CareerId,
      shiftId: p.shiftId,
      score: clampInt(p.score, 0, 100, 0),
      onTime: p.onTime === true,
      day: clampInt(p.day, 0, 1000000, 0),
    })
  }
  return out.slice(-PERFORMANCE_HISTORY_MAX)
}

/** Turn arbitrary loaded data into a valid {@link CareerState}. Never throws. */
export function sanitizeCareerSave(raw: unknown): CareerState {
  const base = defaultCareerState()
  if (!raw || typeof raw !== 'object') return base
  const d = raw as CareerSaveData

  base.skills = sanitizeSkills(d.skills)
  // Skill ledger: numeric values keyed by `${day}:${reason}` — keep bounded + numeric.
  if (d.skillLedger && typeof d.skillLedger === 'object') {
    const led: Record<string, number> = {}
    for (const [k, v] of Object.entries(d.skillLedger)) if (typeof v === 'number' && Number.isFinite(v)) led[k] = Math.max(0, Math.trunc(v))
    base.skillLedger = led
  }
  base.activeJob = isCareerId(d.activeJob as string) ? (d.activeJob as CareerId) : null
  if (d.ranks && typeof d.ranks === 'object') {
    for (const [k, v] of Object.entries(d.ranks)) if (isCareerId(k) && isRankId(v)) base.ranks[k] = v
  }
  base.history = sanitizeHistory(d.history)
  if (d.employerStanding && typeof d.employerStanding === 'object') {
    const st: Record<EmployerId, number> = {}
    for (const [k, v] of Object.entries(d.employerStanding)) if (typeof k === 'string') st[k] = clampInt(v, EMPLOYER_STANDING_MIN, EMPLOYER_STANDING_MAX, EMPLOYER_STANDING_MIN)
    base.employerStanding = st
  }
  base.scheduledShifts = (Array.isArray(d.scheduledShifts) ? d.scheduledShifts : [])
    .map(sanitizeShift)
    .filter((x): x is ScheduledShift => x !== null)
    .slice(-SCHEDULED_SHIFTS_MAX)
  // An active shift does NOT restore mid-flight: reinstating a partly-done work route
  // deterministically (cargo, markers, objectives) is unsafe, so a persisted active
  // shift migrates to a documented cancelled record with NO pay (§13). Its scheduled
  // twin (if any) survives above.
  base.activeShift = null
  base.performanceHistory = sanitizePerf(d.performanceHistory)
  base.unlocks = strList(d.unlocks, UNLOCKS_MAX)
  base.appliedEventIds = strList(d.appliedEventIds, APPLIED_CAREER_EVENT_ID_MAX)
  base.paidAttemptKeys = strList(d.paidAttemptKeys, PAID_ATTEMPT_KEY_MAX)
  base.recommendations = strList(d.recommendations, 16)
  base.shiftSeq = clampInt(d.shiftSeq, 0, Number.MAX_SAFE_INTEGER, 0)
  // Guard: a saved shift id could exceed the counter → keep the counter ahead so no
  // future shift id can collide with a loaded one (reload-safe, §13).
  const maxSeq = base.scheduledShifts.reduce((m, sh) => {
    const n = Number(sh.id.split(':').pop())
    return Number.isFinite(n) ? Math.max(m, n) : m
  }, base.shiftSeq)
  base.shiftSeq = maxSeq
  return base
}

/** Load a career save (or reset when absent). Idempotent — reset then apply. */
export function applyCareerSave(data: CareerSaveData | undefined): void {
  careerRuntime.state = data ? sanitizeCareerSave(data) : defaultCareerState()
}
