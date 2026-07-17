import type { Vec2 } from '../world/worldTypes'
import { lerpAngle } from '../utils/math'
import { panicFleeDir } from './panicRuntime'
import { avoidSolids } from '../police/policeAvoidance'

/**
 * Shared panic-sprint step, layered on top of an actor's normal movement. Used
 * by both the ambient crowd and the named residents so they flee gunfire the
 * same way. The RECOVERY is implicit and deliberate: once the panic window has
 * expired, `panicFleeDir` returns null and this is a no-op, so the caller's
 * routine movement resumes and the actor walks back to its anchor — quest
 * givers (Ravi, Maya, Officer Kim) therefore become reachable again on their
 * own, and are never hittable, so a crime can't strand a quest.
 */

/** Panic sprint multiplier over normal walk speed. */
export const PANIC_SPEED_MULT = 2.4

export interface FleeState {
  pos: Vec2
  walking: boolean
  heading: number
}

/**
 * If `id` is currently panicking, step `state` AWAY from the remembered threat
 * (nudged out of any solid so no one flees through a wall), mark it walking,
 * and turn it to face the flee direction. Returns true when a flee step was
 * applied, false when not panicking (caller keeps its routine motion). Pure
 * except for the injectable `avoid` hook (defaults to the static solid table).
 */
export function panicFleeStep(
  state: FleeState,
  id: string,
  walkSpeed: number,
  dt: number,
  gameTime: number,
  avoid: (p: Vec2) => Vec2 = avoidSolids,
): boolean {
  const flee = panicFleeDir(id, state.pos, gameTime)
  if (!flee) return false
  const step = walkSpeed * PANIC_SPEED_MULT * Math.min(dt, 0.1)
  state.pos = avoid([state.pos[0] + flee[0] * step, state.pos[1] + flee[1] * step])
  state.walking = true
  state.heading = lerpAngle(state.heading, Math.atan2(flee[0], flee[1]), dt * 10)
  return true
}
