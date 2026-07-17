import type { Vec2 } from '../world/worldTypes'

/**
 * Light NPC panic: a gunshot marks nearby citizens as panicking for a few
 * seconds and remembers where the threat was, so the citizen movement code
 * can steer them AWAY from it. Transient, id-keyed, no scene objects — read
 * from the citizen useFrame each tick.
 */

export const PANIC_RADIUS = 24
export const PANIC_SECONDS = 6

interface PanicEntry {
  until: number
  from: Vec2
}

export const panicRuntime = {
  panicking: new Map<string, PanicEntry>(),
}

export function markPanic(citizenId: string, from: Vec2, gameTime: number): void {
  panicRuntime.panicking.set(citizenId, { until: gameTime + PANIC_SECONDS, from: [from[0], from[1]] })
}

/** Mark every citizen within PANIC_RADIUS of a threat as fleeing it. */
export function panicNearby(
  threat: Vec2,
  citizens: readonly { id: string; position: Vec2 }[],
  gameTime: number,
): number {
  let n = 0
  const r2 = PANIC_RADIUS * PANIC_RADIUS
  for (const c of citizens) {
    const dx = c.position[0] - threat[0]
    const dz = c.position[1] - threat[1]
    if (dx * dx + dz * dz <= r2) {
      markPanic(c.id, threat, gameTime)
      n++
    }
  }
  return n
}

export function isPanicking(id: string, gameTime: number): boolean {
  const e = panicRuntime.panicking.get(id)
  if (!e) return false
  if (gameTime >= e.until) {
    panicRuntime.panicking.delete(id)
    return false
  }
  return true
}

/** Unit direction away from the remembered threat, or null if not panicking. */
export function panicFleeDir(id: string, at: Vec2, gameTime: number): Vec2 | null {
  if (!isPanicking(id, gameTime)) return null
  const e = panicRuntime.panicking.get(id)!
  const dx = at[0] - e.from[0]
  const dz = at[1] - e.from[1]
  const len = Math.hypot(dx, dz)
  if (len < 1e-4) return [1, 0]
  return [dx / len, dz / len]
}

export function resetPanicRuntime(): void {
  panicRuntime.panicking.clear()
}
