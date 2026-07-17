import { beforeEach, describe, expect, it } from 'vitest'
import { emitCrime, resetCrimeRuntime } from './crimeRuntime'
import {
  consumePendingDispatch,
  fileReport,
  incidentRuntime,
  resetIncidentRuntime,
} from './reportingSystem'
import {
  getWantedLevel,
  getWantedSnapshot,
  resetWantedRuntime,
  wantedRuntime,
} from './wantedRuntime'

beforeEach(() => {
  resetCrimeRuntime()
  resetIncidentRuntime()
  resetWantedRuntime()
})

function crime(type: Parameters<typeof emitCrime>[0]['type'], xz: [number, number], t = 1) {
  return emitCrime({ type, position: [xz[0], 1, xz[1]], suspectEntityId: 'player', vehicleId: 'v1' }, t)!
}

describe('reporting → incidents → wanted', () => {
  it('a reported theft opens an incident, raises heat to level 1, and queues dispatch', () => {
    const e = crime('vehicle_theft', [10, 10])
    const incidentId = fileReport(e, 'cit_a', 2)
    expect(incidentId).toBe('incident_0')
    expect(getWantedLevel()).toBe(1)
    expect(getWantedSnapshot().status).toBe('reported')
    expect(consumePendingDispatch()).toEqual(['incident_0'])
    // Consumed — the queue is now empty.
    expect(consumePendingDispatch()).toEqual([])
  })

  it('multiple witnesses of ONE crime merge into one incident and apply heat once', () => {
    const e = crime('vehicle_theft', [10, 10])
    const i1 = fileReport(e, 'cit_a', 2)
    const i2 = fileReport(e, 'cit_b', 2.3)
    expect(i1).toBe(i2)
    const inc = incidentRuntime.incidents.get(i1)!
    expect(inc.reporterIds).toEqual(['cit_a', 'cit_b'])
    expect(inc.crimeEventIds).toEqual([e.id])
    // Heat applied only once (typeCount == 1), and one dispatch queued.
    expect(wantedRuntime.typeCounts.get('vehicle_theft')).toBe(1)
    expect(consumePendingDispatch()).toEqual([i1])
  })

  it('nearby recent crimes merge into the same incident; distant ones do not', () => {
    const near = crime('vehicle_collision', [10, 10], 1)
    const alsoNear = crime('assault', [20, 12], 2) // within 40u merge radius
    const far = crime('reckless_driving', [400, 400], 3)
    const iNear = fileReport(near, 'cit_a', 1)
    const iAlso = fileReport(alsoNear, 'cit_b', 2)
    const iFar = fileReport(far, 'cit_c', 3)
    expect(iAlso).toBe(iNear) // merged
    expect(iFar).not.toBe(iNear) // separate
    expect(incidentRuntime.incidents.size).toBe(2)
  })

  it('an attacking-police report flags the incident and forces level 3', () => {
    const e = crime('attacking_police', [10, 10])
    const id = fileReport(e, 'officer_1', 5)
    expect(incidentRuntime.incidents.get(id)!.isPoliceAttack).toBe(true)
    expect(getWantedLevel()).toBe(3)
  })

  it('reporting an already-reported event adds the reporter but not new heat/dispatch', () => {
    const e = crime('vehicle_theft', [10, 10])
    fileReport(e, 'cit_a', 2)
    consumePendingDispatch() // drain
    const heatAfterFirst = wantedRuntime.heat
    fileReport(e, 'cit_b', 2.5) // same event again
    expect(wantedRuntime.heat).toBe(heatAfterFirst)
    expect(consumePendingDispatch()).toEqual([]) // no new dispatch
  })
})
