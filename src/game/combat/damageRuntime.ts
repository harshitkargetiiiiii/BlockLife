import type { Vec2 } from '../world/worldTypes'
import { damageActor } from './healthState'

/**
 * The single funnel every hit (bullet, vehicle, collision) passes through, so
 * health mutation lives in one place and effects/tests can read a bounded
 * event log. Player health lives in the store, so it's applied through an
 * injected sink (registered at store init) rather than importing the store
 * here — keeps this leaf pure and unit-testable.
 */

export type DamageKind = 'bullet' | 'vehicle' | 'collision'
export type DamageTargetKind = 'player' | 'citizen' | 'police'

export interface DamageEmitInput {
  sourceId: string
  targetId: string
  targetKind: DamageTargetKind
  amount: number
  kind: DamageKind
  position: Vec2
  gameTime: number
}

export interface DamageEvent extends DamageEmitInput {
  id: string
  /** True if this hit dropped the target to 0. */
  incapacitated: boolean
}

type PlayerDamageSink = (amount: number, gameTime: number) => { health: number; incapacitated: boolean }

let playerSink: PlayerDamageSink | null = null

/** The store registers how player damage is applied (HUD-reactive). */
export function registerPlayerDamageSink(fn: PlayerDamageSink): void {
  playerSink = fn
}

const MAX_EVENTS = 48

export const damageRuntime = {
  seq: 0,
  events: [] as DamageEvent[],
}

export function emitDamage(input: DamageEmitInput): DamageEvent {
  let incapacitated = false
  if (input.targetKind === 'player') {
    const r = playerSink?.(input.amount, input.gameTime)
    incapacitated = r?.incapacitated ?? false
  } else {
    incapacitated = damageActor(input.targetId, input.amount, input.gameTime)
  }
  const ev: DamageEvent = {
    id: `dmg_${damageRuntime.seq++}`,
    ...input,
    incapacitated,
  }
  damageRuntime.events.push(ev)
  if (damageRuntime.events.length > MAX_EVENTS) damageRuntime.events.shift()
  return ev
}

export function getDamageEvents(): DamageEvent[] {
  return [...damageRuntime.events]
}

export function resetDamageRuntime(): void {
  damageRuntime.seq = 0
  damageRuntime.events.length = 0
}
