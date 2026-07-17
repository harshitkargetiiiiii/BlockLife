import type { Vec2 } from '../world/worldTypes'
import { POLICE_MAX_HEALTH, type PoliceKind, type PoliceState, type PoliceUnit } from './policeTypes'
import { clearPoliceRoute, resetPoliceRoutes } from './policeRoute'

/**
 * Global police unit registry (survives sector streaming — holds ids/
 * positions/state, never scene objects). Sector-owned visuals read from
 * here. Bounded by the dispatch director's caps.
 */
export const policeRuntime = {
  seq: 0,
  units: new Map<string, PoliceUnit>(),
  debugEnabled: false,
  /** Count of arrests made this session (transient — for HUD/tests). */
  arrestsMade: 0,
  /** Game time of the most recent arrest, or null. */
  lastArrestAt: null as number | null,
}

/** Record a completed arrest (bumped by the live driver on `arrested`). */
export function recordArrest(gameTime: number): void {
  policeRuntime.arrestsMade++
  policeRuntime.lastArrestAt = gameTime
}

export function spawnPoliceUnit(
  kind: PoliceKind,
  position: Vec2,
  incidentId: string,
  gameTime: number,
): PoliceUnit {
  const unit: PoliceUnit = {
    id: `police_${policeRuntime.seq++}`,
    kind,
    state: 'responding',
    incidentId,
    target: null,
    position: [...position] as Vec2,
    heading: 0,
    health: POLICE_MAX_HEALTH,
    spawnedAt: gameTime,
    seesSuspect: false,
    arrestTimer: 0,
    timeSinceSeen: 0,
    lastShotAt: -Infinity,
  }
  policeRuntime.units.set(unit.id, unit)
  return unit
}

/** Spawn a dismounted OFFICER on foot from a cruiser at a validated exit. */
export function spawnPoliceOfficer(
  cruiserId: string,
  position: Vec2,
  incidentId: string,
  gameTime: number,
): PoliceUnit {
  const officer = spawnPoliceUnit('officer', position, incidentId, gameTime)
  officer.cruiserId = cruiserId
  officer.state = 'pursuing_on_foot'
  return officer
}

export function despawnPoliceUnit(id: string): void {
  // A despawning cruiser takes its dismounted officers with it.
  for (const [oid, u] of [...policeRuntime.units]) {
    if (u.kind === 'officer' && u.cruiserId === id) policeRuntime.units.delete(oid)
  }
  policeRuntime.units.delete(id)
  clearPoliceRoute(id)
}

/** Officers dismounted from a given cruiser. */
export function officersForCruiser(cruiserId: string): PoliceUnit[] {
  const out: PoliceUnit[] = []
  for (const u of policeRuntime.units.values()) {
    if (u.kind === 'officer' && u.cruiserId === cruiserId) out.push(u)
  }
  return out
}

/** True if any dismounted officer is still active (cruiser must not vanish). */
export function hasActiveOfficers(cruiserId: string): boolean {
  return officersForCruiser(cruiserId).length > 0
}

export function getPoliceUnit(id: string): PoliceUnit | undefined {
  return policeRuntime.units.get(id)
}

export function activeCounts(): { vehicles: number; officers: number } {
  let vehicles = 0
  let officers = 0
  for (const u of policeRuntime.units.values()) {
    if (u.kind === 'vehicle') vehicles++
    else officers++
  }
  return { vehicles, officers }
}

export function anyPoliceSeesSuspect(): boolean {
  for (const u of policeRuntime.units.values()) if (u.seesSuspect) return true
  return false
}

export function setPoliceState(id: string, state: PoliceState): void {
  const u = policeRuntime.units.get(id)
  if (u) u.state = state
}

export function getPoliceUnitsSnapshot(): PoliceUnit[] {
  return [...policeRuntime.units.values()].map((u) => ({
    ...u,
    position: [...u.position] as Vec2,
    target: u.target ? ([...u.target] as Vec2) : null,
  }))
}

export function resetPoliceRuntime(): void {
  policeRuntime.seq = 0
  policeRuntime.units.clear()
  policeRuntime.arrestsMade = 0
  policeRuntime.lastArrestAt = null
  resetPoliceRoutes()
}
