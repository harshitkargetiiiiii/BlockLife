import { beforeEach, describe, expect, it } from 'vitest'
import { emitCrime, getCrimeEventsByStatus, resetCrimeRuntime } from './crimeRuntime'
import { resetIncidentRuntime } from './reportingSystem'
import { stepCrimeDirector } from './crimeStep'
import { getWantedLevel, resetWantedRuntime } from './wantedRuntime'
import { resetWitnessRuntime, willReport } from './witnessSystem'
import type { WitnessCandidate, WitnessContext } from './witnessTypes'

const CLEAR: WitnessContext = { raining: false, isNight: false }
const OPEN: [number, number] = [500, -500] // open ground, guaranteed LOS

beforeEach(() => {
  resetCrimeRuntime()
  resetWitnessRuntime()
  resetWantedRuntime()
  resetIncidentRuntime()
})

function reportingCitizenNear(eventLike: Parameters<typeof willReport>[1]): string {
  for (let i = 0; i < 200; i++) {
    if (willReport(`cit_${i}`, eventLike)) return `cit_${i}`
  }
  throw new Error('no reporting citizen')
}

describe('crime director (per-frame loop)', () => {
  it('a witnessed theft becomes reported and raises wanted to level 1', () => {
    const e = emitCrime({ type: 'vehicle_theft', position: [OPEN[0], 1, OPEN[1]], suspectEntityId: 'player', vehicleId: 'v1' }, 0)!
    const reporterId = reportingCitizenNear(e)
    const candidates: WitnessCandidate[] = [{ id: reporterId, position: [OPEN[0] + 2, OPEN[1]], capable: true }]
    const capableOf = () => true

    // Frame 0: observe → witnessed, report timer seeded (delay 1–3.5s).
    stepCrimeDirector({ gameTime: 0, dt: 0.1, ctx: CLEAR, candidates, capableOf, hasPoliceLOS: false })
    expect(getCrimeEventsByStatus('witnessed')).toHaveLength(1)
    expect(getWantedLevel()).toBe(0) // not reported yet

    // Frame at t=5: report fires → wanted level 1.
    stepCrimeDirector({ gameTime: 5, dt: 0.1, ctx: CLEAR, candidates, capableOf, hasPoliceLOS: false })
    expect(getCrimeEventsByStatus('reported')).toHaveLength(1)
    expect(getWantedLevel()).toBe(1)
  })

  it('an out-of-range citizen never witnesses the crime', () => {
    const e = emitCrime({ type: 'vehicle_theft', position: [OPEN[0], 1, OPEN[1]], suspectEntityId: 'player', vehicleId: 'v1' }, 0)!
    void e
    // 100 units away — well beyond the 22u visible radius.
    const candidates: WitnessCandidate[] = [{ id: 'cit_far', position: [OPEN[0] + 100, OPEN[1]], capable: true }]
    for (let t = 0; t < 20; t++) {
      stepCrimeDirector({ gameTime: t, dt: 1, ctx: CLEAR, candidates, capableOf: () => true, hasPoliceLOS: false })
    }
    expect(getWantedLevel()).toBe(0)
    expect(getCrimeEventsByStatus('unseen').length + getCrimeEventsByStatus('expired').length).toBe(1)
  })
})
