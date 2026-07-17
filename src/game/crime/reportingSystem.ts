import type { Vec3 } from '../world/worldTypes'
import type { CrimeEvent } from './crimeTypes'
import { recordReport } from './crimeRuntime'
import { applyReport } from './wantedRuntime'

/**
 * Reporting → incidents. Reports for the same crime, or for nearby recent
 * crimes, MERGE into one incident so multiple witnesses never multiply the
 * police response. Wanted heat is applied once per distinct crime event
 * (the first report of it); later reports of the same event only record the
 * extra reporter. The dispatch director (M4) consumes `pendingDispatch`.
 */

export interface Incident {
  id: string
  position: Vec3
  openedAt: number
  crimeEventIds: string[]
  reporterIds: string[]
  isPoliceAttack: boolean
}

const MERGE_RADIUS = 40
const MERGE_SECONDS = 30

export const incidentRuntime = {
  seq: 0,
  incidents: new Map<string, Incident>(),
  /** Incident ids awaiting a dispatch decision (consumed by the director). */
  pendingDispatch: [] as string[],
}

function isPoliceAttack(event: CrimeEvent): boolean {
  return event.type === 'attacking_police' || event.type === 'police_injury'
}

function findMergeableIncident(event: CrimeEvent, gameTime: number): Incident | null {
  let best: Incident | null = null
  let bestDist = MERGE_RADIUS
  for (const inc of incidentRuntime.incidents.values()) {
    if (gameTime - inc.openedAt > MERGE_SECONDS) continue
    const d = Math.hypot(inc.position[0] - event.position[0], inc.position[2] - event.position[2])
    if (d <= bestDist) {
      best = inc
      bestDist = d
    }
  }
  return best
}

/**
 * File a report for a witnessed crime. Returns the incident id. Heat +
 * pending dispatch fire only the FIRST time a given crime event is reported.
 */
export function fileReport(event: CrimeEvent, reporterId: string, gameTime: number): string {
  const firstReportOfEvent = event.status !== 'reported'
  recordReport(event.id, reporterId)

  let incident = findMergeableIncident(event, gameTime)
  if (!incident) {
    incident = {
      id: `incident_${incidentRuntime.seq++}`,
      position: [...event.position] as Vec3,
      openedAt: gameTime,
      crimeEventIds: [],
      reporterIds: [],
      isPoliceAttack: false,
    }
    incidentRuntime.incidents.set(incident.id, incident)
  }
  if (!incident.crimeEventIds.includes(event.id)) incident.crimeEventIds.push(event.id)
  if (!incident.reporterIds.includes(reporterId)) incident.reporterIds.push(reporterId)
  if (isPoliceAttack(event)) incident.isPoliceAttack = true

  if (firstReportOfEvent) {
    applyReport({
      crimeType: event.type,
      severity: event.severity,
      incidentId: incident.id,
      position: event.position,
      gameTime,
      isPoliceAttack: isPoliceAttack(event),
    })
    if (!incidentRuntime.pendingDispatch.includes(incident.id)) {
      incidentRuntime.pendingDispatch.push(incident.id)
    }
  }
  return incident.id
}

/** The dispatch director calls this to claim incidents needing a response. */
export function consumePendingDispatch(): string[] {
  const out = incidentRuntime.pendingDispatch.slice()
  incidentRuntime.pendingDispatch.length = 0
  return out
}

export function getIncident(id: string): Incident | undefined {
  return incidentRuntime.incidents.get(id)
}

export function getIncidentsSnapshot(): Incident[] {
  return [...incidentRuntime.incidents.values()].map((i) => ({
    ...i,
    position: [...i.position] as Vec3,
    crimeEventIds: [...i.crimeEventIds],
    reporterIds: [...i.reporterIds],
  }))
}

export function resetIncidentRuntime(): void {
  incidentRuntime.seq = 0
  incidentRuntime.incidents.clear()
  incidentRuntime.pendingDispatch.length = 0
}
