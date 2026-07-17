import { beforeEach, describe, expect, it } from 'vitest'
import { getCrimeEventsSnapshot, resetCrimeRuntime } from '../crime/crimeRuntime'
import { getWantedLevel, resetWantedRuntime, wantedRuntime } from '../crime/wantedRuntime'
import { resetIncidentRuntime } from '../crime/reportingSystem'
import { giveWeapon, holsterWeapon } from './weaponRuntime'
import { getActorHealth, setActorHealth } from './healthState'
import { isPanicking } from './panicRuntime'
import type { HitscanTarget } from './hitscan'
import { firePlayerWeapon, resetCombatSystems } from './combatSystem'

// Fire on open ground far from any building so the ray reaches the target
// (wall-blocking is covered in hitscan.test); crimes still tag a sector.
const OX = 1000
const OZ = 1000

function citizen(id: string, position: [number, number]): HitscanTarget {
  return { id, position, radius: 0.5, kind: 'citizen' }
}
function officer(id: string, position: [number, number]): HitscanTarget {
  return { id, position, radius: 0.5, kind: 'police' }
}

beforeEach(() => {
  resetCombatSystems()
  resetCrimeRuntime()
  resetWantedRuntime()
  resetIncidentRuntime()
})

describe('firePlayerWeapon', () => {
  it('does nothing while unarmed', () => {
    const r = firePlayerWeapon({ origin: [0, 0], aimDir: [1, 0], gameTime: 100, targets: [] })
    expect(r.fired).toBe(false)
    expect(r.reason).toBe('unarmed')
  })

  it('a discharge always emits a weapon_discharge crime', () => {
    giveWeapon()
    firePlayerWeapon({ origin: [0, -60], aimDir: [0, 1], gameTime: 100, targets: [] })
    const crimes = getCrimeEventsSnapshot()
    expect(crimes.some((c) => c.type === 'weapon_discharge')).toBe(true)
  })

  it('hitting a citizen deals damage and files a civilian_injury crime', () => {
    giveWeapon()
    const r = firePlayerWeapon({
      origin: [OX, OZ],
      aimDir: [0, 1],
      gameTime: 100,
      targets: [citizen('npc_1', [OX, OZ + 20])],
    })
    expect(r.fired).toBe(true)
    expect(r.hit).toBe(true)
    expect(r.targetId).toBe('npc_1')
    expect(getActorHealth('npc_1')).toBeLessThan(100)
    expect(getCrimeEventsSnapshot().some((c) => c.type === 'civilian_injury')).toBe(true)
  })

  it('respects the fire-rate cooldown', () => {
    giveWeapon()
    firePlayerWeapon({ origin: [0, -60], aimDir: [0, 1], gameTime: 100, targets: [] })
    const second = firePlayerWeapon({ origin: [0, -60], aimDir: [0, 1], gameTime: 100.05, targets: [] })
    expect(second.fired).toBe(false)
    expect(second.reason).toBe('cannot_fire')
  })

  it('cannot fire while holstered', () => {
    giveWeapon()
    holsterWeapon()
    const r = firePlayerWeapon({ origin: [0, -60], aimDir: [0, 1], gameTime: 100, targets: [] })
    expect(r.fired).toBe(false)
  })

  it('shooting police escalates wanted to level 3 immediately', () => {
    giveWeapon()
    const r = firePlayerWeapon({
      origin: [OX, OZ],
      aimDir: [0, 1],
      gameTime: 100,
      targets: [officer('police_0', [OX, OZ + 20])],
    })
    expect(r.hit).toBe(true)
    expect(wantedRuntime.policeAttacked).toBe(true)
    expect(getWantedLevel()).toBe(3)
    expect(getCrimeEventsSnapshot().some((c) => c.type === 'attacking_police')).toBe(true)
  })

  it('downing an officer files a police_injury crime', () => {
    giveWeapon()
    setActorHealth('police_0', 10, 99) // one shot will drop them
    const r = firePlayerWeapon({
      origin: [OX, OZ],
      aimDir: [0, 1],
      gameTime: 100,
      targets: [officer('police_0', [OX, OZ + 20])],
    })
    expect(r.incapacitated).toBe(true)
    expect(getCrimeEventsSnapshot().some((c) => c.type === 'police_injury')).toBe(true)
    expect(getWantedLevel()).toBe(3)
  })

  it('nearby citizens panic at the gunshot', () => {
    giveWeapon()
    firePlayerWeapon({
      origin: [0, 0],
      aimDir: [1, 0],
      gameTime: 100,
      targets: [citizen('bystander', [4, 3])],
    })
    expect(isPanicking('bystander', 100)).toBe(true)
  })
})
