import type { Vec2 } from '../world/worldTypes'
import { consumePendingDispatch } from '../crime/reportingSystem'
import { getWantedLevel, wantedRuntime } from '../crime/wantedRuntime'
import { pickSpawnAnchor, type CameraBox } from './policeSpawns'
import { activeCounts, despawnPoliceUnit, policeRuntime, spawnPoliceUnit } from './policeRuntime'
import { POLICE_CAPS } from './policeTypes'

/**
 * The police response director. Consumes reported incidents, then each tick
 * reconciles the active vehicle count to the cap for the CURRENT wanted
 * level — spawning at validated OFF-CAMERA anchors near the suspect's last
 * known position, and despawning extras as wanted decays. Deterministic and
 * bounded; never spawns on-screen or over another unit.
 */

export interface DispatchStepInput {
  gameTime: number
  suspectPosition: Vec2
  cameraBox: CameraBox | null
}

export function stepDispatch(input: DispatchStepInput): void {
  // Draining the queue marks incidents as acknowledged even at level 0
  // (e.g. an unseen crime that never raised wanted).
  const pending = consumePendingDispatch()
  const level = getWantedLevel()

  if (level === 0) {
    // No active response: send everyone home (bounded — clear immediately).
    for (const id of [...policeRuntime.units.keys()]) despawnPoliceUnit(id)
    return
  }

  const cap = POLICE_CAPS[level]
  const incidentId = wantedRuntime.activeIncidentIds.at(-1) ?? pending.at(-1) ?? 'incident_active'
  const anchorTarget = wantedRuntime.lastKnownPosition
    ? ([wantedRuntime.lastKnownPosition[0], wantedRuntime.lastKnownPosition[2]] as Vec2)
    : input.suspectPosition

  // Reconcile UP to the cap.
  const taken = new Set<string>()
  let guard = 0
  while (activeCounts().vehicles < cap.vehicles && guard++ < cap.vehicles + 2) {
    const anchor = pickSpawnAnchor(anchorTarget, input.cameraBox, taken)
    if (!anchor) break
    taken.add(anchor.id)
    spawnPoliceUnit('vehicle', anchor.position, incidentId, input.gameTime)
  }

  // Reconcile DOWN if the level dropped and we're over cap. Only VEHICLES are
  // reconciled here (officers are bounded separately by the dismount pass and
  // are taken down with their cruiser) — despawn the furthest cruisers first so
  // the nearest keep the pursuit, and each carries its officers with it.
  const vehicles = [...policeRuntime.units.values()].filter((u) => u.kind === 'vehicle')
  if (vehicles.length > cap.vehicles) {
    vehicles
      .sort(
        (a, b) =>
          Math.hypot(b.position[0] - anchorTarget[0], b.position[1] - anchorTarget[1]) -
          Math.hypot(a.position[0] - anchorTarget[0], a.position[1] - anchorTarget[1]),
      )
      .slice(0, vehicles.length - cap.vehicles)
      .forEach((u) => despawnPoliceUnit(u.id))
  }
}
