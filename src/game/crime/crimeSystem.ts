import { trafficRuntime } from '../traffic/trafficRuntime'
import { resetVehicleCrimeRuntime } from '../vehicles/vehicleCrimeState'
import { resetEjectedDrivers } from '../vehicles/ejectedDriverRuntime'
import { resetPoliceRuntime } from '../police/policeRuntime'
import { resetCrimeRuntime } from './crimeRuntime'
import { resetIncidentRuntime } from './reportingSystem'
import { resetWantedRuntime } from './wantedRuntime'
import { getWitnessRecordFor, resetWitnessRuntime } from './witnessSystem'

/**
 * Facade over the crime/wanted/witness/incident runtimes: the shared game
 * clock and the single reset. The game clock is the GLOBAL traffic signal
 * clock (unpaused sim seconds) — already pause-frozen and test-pinnable, so
 * crime timing is deterministic and reuses the pinning tests already rely on.
 */

export function getCrimeGameTime(): number {
  return trafficRuntime.signal.elapsed
}

/** Transient reset (resetGame / save load). Wanted, crime, incidents clear. */
export function resetCrimeSystems(): void {
  resetCrimeRuntime()
  resetWantedRuntime()
  resetWitnessRuntime()
  resetIncidentRuntime()
  resetVehicleCrimeRuntime()
  resetEjectedDrivers()
  resetPoliceRuntime()
}

/** Dev/test snapshot of one citizen's witness state. */
export function getWitnessStateSnapshot(citizenId: string): {
  state: string
  eventId: string
  verdict: string
  reported: boolean
} | null {
  const rec = getWitnessRecordFor(citizenId)
  if (!rec) return null
  return { state: rec.state, eventId: rec.eventId, verdict: rec.verdict, reported: rec.reported }
}
