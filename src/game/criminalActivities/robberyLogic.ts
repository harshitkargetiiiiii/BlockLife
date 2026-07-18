import type { CashierDecision, RobberyActivityDefinition } from './activityTypes'
import { createRng, hashString } from '../traffic/routing/routeRng'

/**
 * Pure, deterministic robbery helpers — no runtime, no side effects, no
 * Math.random. Seeded on stable identity so the same store + attempt ordinal
 * always yields the same cashier decision and the same loot, and tests can pin
 * exact outcomes.
 */

/**
 * The cashier's register reaction. Deterministic by (store seed, attempt
 * ordinal) so it is stable per attempt yet varies reproducibly across repeats.
 * Comply is the common, readable happy path; refusal is rare.
 */
export function decideCashier(def: RobberyActivityDefinition, attemptOrdinal: number): CashierDecision {
  const rng = createRng(hashString(`${def.seedKey}:cashier:${def.cashierId}:${attemptOrdinal}`))
  const roll = rng()
  if (roll < 0.7) return 'comply'
  if (roll < 0.92) return 'flee'
  return 'refuse'
}

/**
 * Deterministic loot for an attempt, in the definition's inclusive cash range,
 * rounded to the nearest $5. Seeded on the attempt id, so repeated interaction,
 * remount or reload can never change (or duplicate) the amount.
 */
export function rollLoot(def: RobberyActivityDefinition, attemptId: string): number {
  const rng = createRng(hashString(`${def.seedKey}:loot:${attemptId}`))
  const { min, max } = def.cashRange
  const span = Math.max(0, max - min)
  const raw = min + rng() * span
  return Math.round(raw / 5) * 5
}

/**
 * Threat geometry: is the player aiming at the cashier, in range, within the
 * aim cone? LINE OF SIGHT is evaluated separately by the director against the
 * interior's solids — this is the cheap per-frame gate (no scene traversal).
 * `heading` is registry.playerHeading; facing is (sin h, cos h).
 */
export function isAimingAtCashier(
  def: RobberyActivityDefinition,
  playerX: number,
  playerZ: number,
  heading: number,
): boolean {
  const dx = def.cashierPosition[0] - playerX
  const dz = def.cashierPosition[1] - playerZ
  const dist = Math.hypot(dx, dz)
  if (dist > def.threat.range || dist < 1e-3) return false
  const fx = Math.sin(heading)
  const fz = Math.cos(heading)
  const dot = (fx * dx + fz * dz) / dist
  return dot >= def.threat.aimDotMin
}

/** Planar distance player→register (for the loot interaction range). */
export function distanceToRegister(def: RobberyActivityDefinition, x: number, z: number): number {
  return Math.hypot(def.registerPosition[0] - x, def.registerPosition[1] - z)
}

/**
 * Clear line of sight from the player to the cashier? True unless the segment
 * crosses a shelf (los blocker). Bounded: at most a handful of authored rects,
 * no scene traversal.
 */
export function hasLineOfSight(
  def: RobberyActivityDefinition,
  px: number,
  pz: number,
): boolean {
  const [cx, cz] = def.cashierPosition
  for (const b of def.losBlockers) {
    if (segmentIntersectsRect(px, pz, cx, cz, b.x, b.z, b.halfW, b.halfD)) return false
  }
  return true
}

/** Segment (x1,z1)-(x2,z2) vs axis-aligned rect centred (rx,rz) half (hw,hd). */
function segmentIntersectsRect(
  x1: number,
  z1: number,
  x2: number,
  z2: number,
  rx: number,
  rz: number,
  hw: number,
  hd: number,
): boolean {
  // Liang–Barsky clip of the segment against the rect's slab.
  const minX = rx - hw
  const maxX = rx + hw
  const minZ = rz - hd
  const maxZ = rz + hd
  let t0 = 0
  let t1 = 1
  const dx = x2 - x1
  const dz = z2 - z1
  const clip = (p: number, q: number): boolean => {
    if (p === 0) return q >= 0 // parallel: inside the slab iff q >= 0
    const r = q / p
    if (p < 0) {
      if (r > t1) return false
      if (r > t0) t0 = r
    } else {
      if (r < t0) return false
      if (r < t1) t1 = r
    }
    return true
  }
  return (
    clip(-dx, x1 - minX) &&
    clip(dx, maxX - x1) &&
    clip(-dz, z1 - minZ) &&
    clip(dz, maxZ - z1) &&
    t0 <= t1
  )
}
