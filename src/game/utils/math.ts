/** Shared frame-rate independent math helpers used by controllers and actors. */

/** Wraps an angle delta into [-PI, PI] so rotations take the shortest arc. */
export function shortestAngleDelta(from: number, to: number): number {
  let delta = to - from
  while (delta > Math.PI) delta -= Math.PI * 2
  while (delta < -Math.PI) delta += Math.PI * 2
  return delta
}

/** Lerps an angle toward a target along the shortest arc. `t` is 0..1. */
export function lerpAngle(from: number, to: number, t: number): number {
  return from + shortestAngleDelta(from, to) * Math.min(1, Math.max(0, t))
}

/**
 * Frame-rate independent smoothing factor for exponential damping:
 * `value += (target - value) * dampFactor(rate, dt)`.
 */
export function dampFactor(rate: number, dt: number): number {
  return 1 - Math.exp(-rate * dt)
}

/** Moves `current` toward `target` by at most `maxDelta` (no overshoot). */
export function approach(current: number, target: number, maxDelta: number): number {
  const delta = target - current
  if (Math.abs(delta) <= maxDelta) return target
  return current + Math.sign(delta) * maxDelta
}
