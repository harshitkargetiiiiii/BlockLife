import * as THREE from 'three'
import type { Vec2 } from '../world/worldTypes'
import { registry } from '../world/runtimeRegistry'
import { avoidSolids } from '../police/policeAvoidance'

/**
 * Drivers carjacked out of an occupied vehicle. Each is ejected EXACTLY ONCE
 * to a validated safe exit point, then flees away from the stolen car on foot
 * (nudged out of solids so it never runs through a wall) and despawns after a
 * short window. A real actor while alive: it registers in `registry.npcPositions`
 * + `movingPersonIds`, so it separates like any pedestrian and can't be
 * duplicated. Global (survives streaming); cleared on reset.
 */

export const DRIVER_FLEE_SPEED = 3.4
export const DRIVER_FLEE_SECONDS = 9

export interface EjectedDriver {
  id: string
  vehicleId: string
  pos: Vec2
  fleeFrom: Vec2
  heading: number
  color: string
  spawnedAt: number
  despawnAt: number
}

export const ejectedDriverRuntime = {
  drivers: new Map<string, EjectedDriver>(),
}

/** Eject a driver once to `exit`, fleeing away from `fleeFrom` (the car). */
export function ejectDriver(input: {
  id: string
  vehicleId: string
  exit: Vec2
  fleeFrom: Vec2
  color: string
  gameTime: number
}): EjectedDriver | null {
  // Idempotent: a driver is only ever ejected once (no duplicates).
  if (ejectedDriverRuntime.drivers.has(input.id)) return null
  const heading = Math.atan2(input.exit[0] - input.fleeFrom[0], input.exit[1] - input.fleeFrom[1])
  const driver: EjectedDriver = {
    id: input.id,
    vehicleId: input.vehicleId,
    pos: [input.exit[0], input.exit[1]],
    fleeFrom: [input.fleeFrom[0], input.fleeFrom[1]],
    heading,
    color: input.color,
    spawnedAt: input.gameTime,
    despawnAt: input.gameTime + DRIVER_FLEE_SECONDS,
  }
  ejectedDriverRuntime.drivers.set(driver.id, driver)
  registry.npcPositions.set(driver.id, new THREE.Vector3(driver.pos[0], 0, driver.pos[1]))
  registry.movingPersonIds.add(driver.id)
  return driver
}

/** Advance every ejected driver's flee; despawn after the window. */
export function stepEjectedDrivers(dt: number, gameTime: number): void {
  for (const [id, d] of ejectedDriverRuntime.drivers) {
    if (gameTime >= d.despawnAt) {
      despawnEjectedDriver(id)
      continue
    }
    const dx = d.pos[0] - d.fleeFrom[0]
    const dz = d.pos[1] - d.fleeFrom[1]
    const len = Math.hypot(dx, dz) || 1
    const step = DRIVER_FLEE_SPEED * Math.min(dt, 0.05)
    const next: Vec2 = [d.pos[0] + (dx / len) * step, d.pos[1] + (dz / len) * step]
    d.pos = avoidSolids(next) // never flee through a wall
    d.heading = Math.atan2(d.pos[0] - d.fleeFrom[0], d.pos[1] - d.fleeFrom[1])
    registry.npcPositions.get(id)?.set(d.pos[0], 0, d.pos[1])
    registry.movingPersonIds.add(id)
  }
}

export function despawnEjectedDriver(id: string): void {
  ejectedDriverRuntime.drivers.delete(id)
  registry.npcPositions.delete(id)
  registry.movingPersonIds.delete(id)
}

export function getEjectedDrivers(): EjectedDriver[] {
  return [...ejectedDriverRuntime.drivers.values()].map((d) => ({
    ...d,
    pos: [...d.pos] as Vec2,
    fleeFrom: [...d.fleeFrom] as Vec2,
  }))
}

export function isDriverEjected(id: string): boolean {
  return ejectedDriverRuntime.drivers.has(id)
}

export function resetEjectedDrivers(): void {
  for (const id of [...ejectedDriverRuntime.drivers.keys()]) despawnEjectedDriver(id)
}
