import { beforeEach, describe, expect, it } from 'vitest'
import { emitCrime, resetCrimeRuntime } from './crimeRuntime'
import { hasLineOfSight } from './lineOfSight'
import {
  collectDueReports,
  getWitnessPersonality,
  observeEvent,
  reactionDelayFor,
  resetWitnessRuntime,
  willReport,
  witnessVerdict,
} from './witnessSystem'
import type { WitnessCandidate, WitnessContext } from './witnessTypes'

const CLEAR: WitnessContext = { raining: false, isNight: false }
// Two points on opposite z-sides of building_gate_hotel_01 (centre 63,-110,
// footprint z -114..-106) — the building sits on the sightline.
const THRU_HOTEL_A: [number, number] = [63, -116]
const THRU_HOTEL_B: [number, number] = [63, -104]
// Far outside the city → guaranteed open ground.
const OPEN_A: [number, number] = [500, -500]

beforeEach(() => {
  resetCrimeRuntime()
  resetWitnessRuntime()
})

function crime(type: Parameters<typeof emitCrime>[0]['type'], xz: [number, number], t = 1) {
  return emitCrime({ type, position: [xz[0], 1, xz[1]], suspectEntityId: 'player', vehicleId: 'v1', weaponId: 'handgun' }, t)!
}

describe('line of sight', () => {
  it('a building blocks the sightline; open ground does not', () => {
    expect(hasLineOfSight(THRU_HOTEL_A, THRU_HOTEL_B)).toBe(false)
    expect(hasLineOfSight(OPEN_A, [505, -500])).toBe(true)
  })
})

describe('witness verdict (pure)', () => {
  const cand = (position: [number, number], capable = true): WitnessCandidate => ({ id: 'cit_a', position, capable })

  it('sees a nearby crime with clear line of sight', () => {
    const e = crime('vehicle_theft', OPEN_A)
    expect(witnessVerdict(cand([502, -500]), e, CLEAR)).toBe('saw')
  })

  it('a building blocks visual witnessing of a non-audible crime', () => {
    const e = crime('vehicle_theft', THRU_HOTEL_B) // theft is not audible-reportable
    // Within visible range (dist 12 < 22) but the hotel blocks the sightline.
    expect(witnessVerdict(cand(THRU_HOTEL_A), e, CLEAR)).toBe('none')
  })

  it('hears a gunshot without line of sight, beyond visible range', () => {
    const e = crime('weapon_discharge', THRU_HOTEL_B) // visible 30, noise 45
    // 12 units through the hotel: no LOS, but audible + within noise radius.
    expect(witnessVerdict(cand(THRU_HOTEL_A), e, CLEAR)).toBe('heard')
  })

  it('an incapable witness sees nothing', () => {
    const e = crime('vehicle_theft', OPEN_A)
    expect(witnessVerdict(cand([502, -500], false), e, CLEAR)).toBe('none')
  })

  it('rain and night shrink the sight range', () => {
    const e = crime('vehicle_theft', OPEN_A) // visible 22
    // 20 units: seen in the clear, missed once night+rain shrink it (~11).
    const far = cand([520, -500])
    expect(witnessVerdict(far, e, CLEAR)).toBe('saw')
    expect(witnessVerdict(far, e, { raining: true, isNight: true })).toBe('none')
  })
})

describe('witness personality (seeded, stable)', () => {
  it('is deterministic per citizen and differs across citizens', () => {
    const a1 = getWitnessPersonality('cit_a')
    const a2 = getWitnessPersonality('cit_a')
    expect(a1).toEqual(a2)
    expect(getWitnessPersonality('cit_b')).not.toEqual(a1)
    expect(a1.reportProbability).toBeGreaterThanOrEqual(0.45)
    expect(a1.reportProbability).toBeLessThanOrEqual(0.95)
  })

  it('willReport and reaction delay are deterministic', () => {
    const e = crime('assault', OPEN_A)
    expect(willReport('cit_a', e)).toBe(willReport('cit_a', e))
    const d = reactionDelayFor('cit_a', e)
    expect(d).toBeGreaterThanOrEqual(1)
    expect(d).toBeLessThanOrEqual(3.5)
    expect(reactionDelayFor('cit_a', e)).toBe(d)
  })
})

describe('observe → report pipeline', () => {
  it('a witness reports after its reaction delay, only if still capable', () => {
    const e = crime('weapon_discharge', OPEN_A, 0)
    // A reporter (high report chance) and a witness who flees and is lost.
    const reporterId = firstIdThatReports(e)
    observeEvent({ id: reporterId, position: [502, -500], capable: true }, e, CLEAR, 0)
    // Before the delay: nothing due.
    expect(collectDueReports(0.5, () => true)).toEqual([])
    // After the delay, capable → reports.
    const due = collectDueReports(10, () => true)
    expect(due).toEqual([{ eventId: e.id, reporterId }])
    // Idempotent — not reported twice.
    expect(collectDueReports(11, () => true)).toEqual([])
  })

  it('a witness interrupted (incapacitated) before its timer never reports', () => {
    const e = crime('weapon_discharge', OPEN_A, 0)
    const reporterId = firstIdThatReports(e)
    observeEvent({ id: reporterId, position: [502, -500], capable: true }, e, CLEAR, 0)
    // Never capable when the timer comes due → no report ever.
    expect(collectDueReports(10, () => false)).toEqual([])
    expect(collectDueReports(20, () => false)).toEqual([])
  })
})

/** Find a citizen id whose seeded roll reports this event (deterministic). */
function firstIdThatReports(e: ReturnType<typeof crime>): string {
  for (let i = 0; i < 100; i++) {
    const id = `cit_${i}`
    if (willReport(id, e)) return id
  }
  throw new Error('no reporting id found')
}
