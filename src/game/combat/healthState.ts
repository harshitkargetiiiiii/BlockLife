/**
 * Health for non-player actors (citizens + police). The PLAYER's health lives
 * in the zustand store so the HUD can react to it; everyone else lives here in
 * a plain runtime keyed by id (read from useFrame, never React state). At 0 an
 * actor is incapacitated — the caller is responsible for releasing its world
 * claims (destination occupancy / queue / route), the leak the destination
 * sprint guards against.
 */

export const ACTOR_MAX_HEALTH = 100

interface ActorHealth {
  health: number
  incapacitated: boolean
  /** Game time incapacitated (for a bounded recovery window later). */
  incapacitatedAt: number | null
}

export const healthRuntime = {
  actors: new Map<string, ActorHealth>(),
}

function record(id: string): ActorHealth {
  let rec = healthRuntime.actors.get(id)
  if (!rec) {
    rec = { health: ACTOR_MAX_HEALTH, incapacitated: false, incapacitatedAt: null }
    healthRuntime.actors.set(id, rec)
  }
  return rec
}

export function getActorHealth(id: string): number {
  return record(id).health
}

export function isIncapacitated(id: string): boolean {
  return record(id).incapacitated
}

/** Apply damage; returns true if this hit incapacitated the actor. */
export function damageActor(id: string, amount: number, gameTime: number): boolean {
  const rec = record(id)
  if (rec.incapacitated) return false
  rec.health = Math.max(0, rec.health - Math.max(0, amount))
  if (rec.health === 0) {
    rec.incapacitated = true
    rec.incapacitatedAt = gameTime
    return true
  }
  return false
}

/** Dev/test: set an actor's health directly (clamped), toggling incapacitation. */
export function setActorHealth(id: string, value: number, gameTime: number): void {
  const rec = record(id)
  rec.health = Math.max(0, Math.min(ACTOR_MAX_HEALTH, value))
  if (rec.health === 0 && !rec.incapacitated) {
    rec.incapacitated = true
    rec.incapacitatedAt = gameTime
  } else if (rec.health > 0) {
    rec.incapacitated = false
    rec.incapacitatedAt = null
  }
}

export function resetHealthState(): void {
  healthRuntime.actors.clear()
}
