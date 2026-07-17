import { crimeRuntime, expireCrimes, getOpenCrimes } from './crimeRuntime'
import { fileReport } from './reportingSystem'
import { tickWanted } from './wantedRuntime'
import { collectDueReports, observeEvent, witnessRuntime } from './witnessSystem'
import type { WitnessCandidate, WitnessContext } from './witnessTypes'

/**
 * The per-frame crime loop: expire stale events, run BUDGETED witness
 * observation over OPEN crimes only, file any reports that come due, and
 * tick wanted decay. Pure over its inputs (candidates/ctx/clock passed in)
 * so it is deterministic and unit-testable; the React CrimeDirector feeds
 * it live citizen data. Line-of-sight is computed at most once per
 * (citizen,event) pair (observeEvent dedups), so steady-state cost is
 * cheap distance checks.
 */

/** Cap first-contact LOS evaluations in a single frame (spike guard). */
const MAX_LOS_PER_FRAME = 32

export interface CrimeStepInput {
  gameTime: number
  dt: number
  ctx: WitnessContext
  candidates: WitnessCandidate[]
  /** Still capable of reporting (alive, present) when a timer comes due. */
  capableOf: (citizenId: string) => boolean
  /** Any officer currently sees the suspect (blocks wanted decay). */
  hasPoliceLOS: boolean
}

export function stepCrimeDirector(input: CrimeStepInput): void {
  expireCrimes(input.gameTime)

  const open = getOpenCrimes()
  if (open.length > 0 && input.candidates.length > 0) {
    let losBudget = MAX_LOS_PER_FRAME
    for (const event of open) {
      const r = Math.max(event.visibleRadius, event.noiseRadius)
      const r2 = r * r
      for (const cand of input.candidates) {
        if (losBudget <= 0) break
        const dx = cand.position[0] - event.position[0]
        const dz = cand.position[1] - event.position[2]
        if (dx * dx + dz * dz > r2) continue
        // observeEvent early-returns if this pair was already evaluated, so
        // the LOS budget is only spent on genuinely new (citizen,event) pairs.
        const key = `${cand.id}:${event.id}`
        const fresh = !witnessKeySeen(key)
        observeEvent(cand, event, input.ctx, input.gameTime)
        if (fresh) losBudget--
      }
    }
  }

  for (const report of collectDueReports(input.gameTime, input.capableOf)) {
    const event = crimeRuntime.events.find((e) => e.id === report.eventId)
    if (event) fileReport(event, report.reporterId, input.gameTime)
  }

  tickWanted(input.gameTime, input.dt, input.hasPoliceLOS)
}

function witnessKeySeen(key: string): boolean {
  return witnessRuntime.records.has(key)
}
