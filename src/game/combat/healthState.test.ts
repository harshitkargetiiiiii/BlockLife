import { beforeEach, describe, expect, it } from 'vitest'
import {
  ACTOR_MAX_HEALTH,
  damageActor,
  getActorHealth,
  isIncapacitated,
  resetHealthState,
  setActorHealth,
} from './healthState'
import {
  damageRuntime,
  emitDamage,
  getDamageEvents,
  registerPlayerDamageSink,
  resetDamageRuntime,
} from './damageRuntime'

beforeEach(() => {
  resetHealthState()
  resetDamageRuntime()
})

describe('actor health', () => {
  it('a fresh actor is at full health, not incapacitated', () => {
    expect(getActorHealth('npc_1')).toBe(ACTOR_MAX_HEALTH)
    expect(isIncapacitated('npc_1')).toBe(false)
  })

  it('damage reduces health and incapacitates at zero', () => {
    expect(damageActor('npc_1', 40, 10)).toBe(false)
    expect(getActorHealth('npc_1')).toBe(60)
    expect(damageActor('npc_1', 100, 11)).toBe(true)
    expect(getActorHealth('npc_1')).toBe(0)
    expect(isIncapacitated('npc_1')).toBe(true)
  })

  it('an incapacitated actor takes no further damage', () => {
    setActorHealth('npc_1', 0, 5)
    expect(damageActor('npc_1', 20, 6)).toBe(false)
  })

  it('setActorHealth clamps and toggles incapacitation', () => {
    setActorHealth('p', 999, 1)
    expect(getActorHealth('p')).toBe(ACTOR_MAX_HEALTH)
    setActorHealth('p', 0, 2)
    expect(isIncapacitated('p')).toBe(true)
    setActorHealth('p', 50, 3)
    expect(isIncapacitated('p')).toBe(false)
  })
})

describe('damage runtime funnel', () => {
  it('routes actor damage to health state and logs the event', () => {
    const ev = emitDamage({
      sourceId: 'player',
      targetId: 'npc_2',
      targetKind: 'citizen',
      amount: 34,
      kind: 'bullet',
      position: [1, 2],
      gameTime: 10,
    })
    expect(ev.incapacitated).toBe(false)
    expect(getActorHealth('npc_2')).toBe(66)
    expect(getDamageEvents()).toHaveLength(1)
  })

  it('routes player damage through the registered sink', () => {
    let applied = 0
    registerPlayerDamageSink((amount) => {
      applied += amount
      return { health: 100 - applied, incapacitated: applied >= 100 }
    })
    const ev = emitDamage({
      sourceId: 'police_1',
      targetId: 'player',
      targetKind: 'player',
      amount: 100,
      kind: 'bullet',
      position: [0, 0],
      gameTime: 20,
    })
    expect(applied).toBe(100)
    expect(ev.incapacitated).toBe(true)
    // Restore a no-op sink so other tests aren't affected.
    registerPlayerDamageSink(() => ({ health: 100, incapacitated: false }))
  })

  it('bounds the event log', () => {
    for (let i = 0; i < 100; i++) {
      emitDamage({
        sourceId: 'player',
        targetId: `npc_${i}`,
        targetKind: 'citizen',
        amount: 1,
        kind: 'bullet',
        position: [0, 0],
        gameTime: i,
      })
    }
    expect(damageRuntime.events.length).toBeLessThanOrEqual(48)
  })
})
