import type { Vec2, Vec3 } from '../world/worldTypes'
import { createRng, hashString } from '../traffic/routing/routeRng'
import { emitCrime } from '../crime/crimeRuntime'
import { fileReport } from '../crime/reportingSystem'
import { canFire, consumeShot, getWeaponDef, resetWeaponRuntime, weaponRuntime } from './weaponRuntime'
import { resolveHitscan, type HitscanTarget } from './hitscan'
import { emitDamage, resetDamageRuntime } from './damageRuntime'
import { resetHealthState } from './healthState'
import { panicNearby, resetPanicRuntime } from './panicRuntime'

/**
 * Fire orchestration: ties the weapon state machine, hitscan, the damage
 * funnel, crime emission and NPC panic into one deterministic call. Pure over
 * its inputs (targets/positions passed in) so it is fully unit-testable; the
 * live component gathers live actors and forwards them.
 */

export interface FireInput {
  origin: Vec2
  /** Aim direction (need not be normalised). */
  aimDir: Vec2
  gameTime: number
  /** Actors the ray can hit (citizens + police), with body radii. */
  targets: readonly HitscanTarget[]
  /** All nearby citizens for panic (defaults to the citizen targets). */
  bystanders?: readonly { id: string; position: Vec2 }[]
}

export interface FireOutcome {
  fired: boolean
  reason?: 'unarmed' | 'cannot_fire'
  hit: boolean
  targetId?: string
  targetKind?: 'citizen' | 'police'
  incapacitated: boolean
  point: Vec2
}

function rotate(dir: Vec2, degrees: number): Vec2 {
  const r = (degrees * Math.PI) / 180
  const c = Math.cos(r)
  const s = Math.sin(r)
  return [dir[0] * c - dir[1] * s, dir[0] * s + dir[1] * c]
}

export function firePlayerWeapon(input: FireInput): FireOutcome {
  const def = getWeaponDef()
  if (!def) return { fired: false, reason: 'unarmed', hit: false, incapacitated: false, point: input.origin }
  if (!canFire(input.gameTime)) {
    return { fired: false, reason: 'cannot_fire', hit: false, incapacitated: false, point: input.origin }
  }

  consumeShot(input.gameTime)

  // Deterministic spread, tighter while aiming. Seeded on the monotonic shot
  // count so a given run is reproducible but shots differ.
  const aiming = weaponRuntime.state.pose === 'aiming'
  const rng = createRng(hashString(`shot_${weaponRuntime.state.shotsFired}`))
  const spread = (rng() * 2 - 1) * def.spreadDegrees * (aiming ? 0.35 : 1)
  const dir = rotate([input.aimDir[0], input.aimDir[1]], spread)

  const res = resolveHitscan(input.origin, dir, def.range, input.targets)

  // A discharge is always a crime + noise (rate-limited by the crime debounce).
  const origin3: Vec3 = [input.origin[0], 1, input.origin[1]]
  emitCrime(
    { type: 'weapon_discharge', position: origin3, suspectEntityId: 'player', weaponId: def.id },
    input.gameTime,
  )

  // Nearby citizens flee the gunshot.
  const bystanders = input.bystanders ?? input.targets.filter((t) => t.kind === 'citizen')
  panicNearby(input.origin, bystanders, input.gameTime)

  let incapacitated = false
  if (res.hit && res.targetId && res.targetKind) {
    const hit3: Vec3 = [res.point[0], 1, res.point[1]]
    const ev = emitDamage({
      sourceId: 'player',
      targetId: res.targetId,
      targetKind: res.targetKind,
      amount: def.damage,
      kind: 'bullet',
      position: res.point,
      gameTime: input.gameTime,
    })
    incapacitated = ev.incapacitated

    if (res.targetKind === 'police') {
      // Shooting police is directly witnessed by the officer → immediate L3.
      const type = incapacitated ? 'police_injury' : 'attacking_police'
      const crime = emitCrime(
        { type, position: hit3, suspectEntityId: 'player', victimEntityId: res.targetId },
        input.gameTime,
      )
      if (crime) fileReport(crime, res.targetId, input.gameTime)
    } else {
      // Civilian injury relies on the witness system (next frame) to report.
      emitCrime(
        { type: 'civilian_injury', position: hit3, suspectEntityId: 'player', victimEntityId: res.targetId },
        input.gameTime,
      )
    }
  }

  return {
    fired: true,
    hit: res.hit,
    targetId: res.targetId,
    targetKind: res.targetKind,
    incapacitated,
    point: res.point,
  }
}

/** Transient reset (resetGame / save load) for every combat runtime. */
export function resetCombatSystems(): void {
  resetWeaponRuntime()
  resetDamageRuntime()
  resetHealthState()
  resetPanicRuntime()
}
