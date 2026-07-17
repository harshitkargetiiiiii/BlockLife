import { beforeEach, describe, expect, it } from 'vitest'
import { emitCrime, resetCrimeRuntime } from './crimeRuntime'
import {
  applyReport,
  getWantedLevel,
  getWantedSnapshot,
  policeLostSight,
  policeSighting,
  resetWantedRuntime,
  tickWanted,
  wantedRuntime,
} from './wantedRuntime'

beforeEach(() => {
  resetWantedRuntime()
  resetCrimeRuntime()
})

const POS: [number, number, number] = [10, 1, 10]

describe('wanted runtime', () => {
  it('an unseen crime alone never produces a wanted level', () => {
    emitCrime({ type: 'vehicle_theft', position: POS, suspectEntityId: 'player', vehicleId: 'v1' }, 1)
    // No report was made — heat and level stay at zero.
    expect(getWantedLevel()).toBe(0)
    expect(getWantedSnapshot().status).toBe('clear')
  })

  it('a reported vehicle theft creates level 1', () => {
    applyReport({ crimeType: 'vehicle_theft', severity: 2, incidentId: 'inc1', position: POS, gameTime: 1 })
    expect(getWantedLevel()).toBe(1)
    expect(getWantedSnapshot().status).toBe('reported')
    expect(getWantedSnapshot().activeIncidentIds).toEqual(['inc1'])
  })

  it('a weapon discharge escalates to level 2', () => {
    applyReport({ crimeType: 'weapon_discharge', severity: 5, incidentId: 'inc1', position: POS, gameTime: 1 })
    expect(getWantedLevel()).toBe(2)
  })

  it('attacking police forces level 3 and holds it', () => {
    applyReport({ crimeType: 'attacking_police', severity: 8, incidentId: 'inc1', position: POS, gameTime: 1, isPoliceAttack: true })
    expect(getWantedLevel()).toBe(3)
    expect(wantedRuntime.policeAttacked).toBe(true)
  })

  it('repeated minor crimes give diminishing heat and stay bounded', () => {
    for (let i = 0; i < 30; i++) {
      applyReport({ crimeType: 'reckless_driving', severity: 1, incidentId: `inc${i}`, position: POS, gameTime: i })
    }
    // Diminishing returns + cap: never runs away to level 3 from tiny crimes.
    expect(wantedRuntime.heat).toBeLessThanOrEqual(20)
    expect(getWantedLevel()).toBeLessThanOrEqual(2)
  })

  it('multiple reports of one incident do not multiply the incident list', () => {
    applyReport({ crimeType: 'vehicle_theft', severity: 2, incidentId: 'inc1', position: POS, gameTime: 1 })
    applyReport({ crimeType: 'vehicle_theft', severity: 2, incidentId: 'inc1', position: POS, gameTime: 1.2 })
    expect(getWantedSnapshot().activeIncidentIds).toEqual(['inc1'])
  })

  it('pursuit → search → clear, and a fresh sighting resumes pursuit', () => {
    applyReport({ crimeType: 'weapon_discharge', severity: 5, incidentId: 'inc1', position: POS, gameTime: 0 })
    policeSighting(POS, 1)
    expect(getWantedSnapshot().status).toBe('pursuit')
    // Losing sight begins a bounded search.
    policeLostSight(10)
    expect(getWantedSnapshot().status).toBe('searching')
    // A new sighting mid-search resumes pursuit.
    policeSighting(POS, 12)
    expect(getWantedSnapshot().status).toBe('pursuit')
    policeLostSight(13)
    // Advance past the search window with NO line of sight and no fresh
    // report: search → cooling, then heat decays to clear.
    tickWanted(60, 1, false)
    expect(getWantedSnapshot().status).toBe('cooling')
    for (let t = 61; t < 200 && getWantedLevel() > 0; t++) tickWanted(t, 1, false)
    expect(getWantedLevel()).toBe(0)
    expect(getWantedSnapshot().status).toBe('clear')
  })

  it('wanted cannot decay while an officer has line of sight', () => {
    applyReport({ crimeType: 'vehicle_theft', severity: 2, incidentId: 'inc1', position: POS, gameTime: 0 })
    policeSighting(POS, 1)
    const before = wantedRuntime.heat
    for (let t = 2; t < 100; t++) tickWanted(t, 1, true) // seen the whole time
    expect(wantedRuntime.heat).toBe(before)
    expect(getWantedLevel()).toBeGreaterThanOrEqual(1)
  })

  it('crossing time alone (no report, no LOS) still requires the full decay path', () => {
    applyReport({ crimeType: 'weapon_discharge', severity: 5, incidentId: 'inc1', position: POS, gameTime: 0 })
    policeSighting(POS, 1)
    policeLostSight(2)
    // One tick right after losing sight does NOT instantly clear (search window).
    tickWanted(3, 1, false)
    expect(getWantedLevel()).toBeGreaterThanOrEqual(2)
    expect(getWantedSnapshot().status).toBe('searching')
  })
})
