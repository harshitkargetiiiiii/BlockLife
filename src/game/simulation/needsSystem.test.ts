import { describe, expect, it } from 'vitest'
import { getSpeedModifier, tickNeeds, HUNGER_PER_HOUR } from './needsSystem'
import { INITIAL_STATS } from '../player/playerTypes'

const idle = { running: false, driving: false }

describe('needsSystem', () => {
  it('increases hunger over time', () => {
    const next = tickNeeds(INITIAL_STATS, 2, idle)
    expect(next.hunger).toBeCloseTo(INITIAL_STATS.hunger + HUNGER_PER_HOUR * 2)
  })

  it('caps hunger at 100', () => {
    const next = tickNeeds({ ...INITIAL_STATS, hunger: 99 }, 5, idle)
    expect(next.hunger).toBe(100)
  })

  it('does not drain energy while idle', () => {
    const next = tickNeeds(INITIAL_STATS, 1, idle)
    expect(next.energy).toBe(INITIAL_STATS.energy)
  })

  it('drains energy while running', () => {
    const next = tickNeeds(INITIAL_STATS, 1, { running: true, driving: false })
    expect(next.energy).toBeLessThan(INITIAL_STATS.energy)
  })

  it('drains a little energy while driving', () => {
    const next = tickNeeds(INITIAL_STATS, 1, { running: false, driving: true })
    expect(next.energy).toBeLessThan(INITIAL_STATS.energy)
    expect(next.energy).toBeGreaterThan(
      tickNeeds(INITIAL_STATS, 1, { running: true, driving: false }).energy,
    )
  })

  it('advances the clock as part of the tick', () => {
    const next = tickNeeds({ ...INITIAL_STATS, hour: 23.5 }, 1, idle)
    expect(next.day).toBe(INITIAL_STATS.day + 1)
    expect(next.hour).toBeCloseTo(0.5)
  })

  it('slows the player when hunger is above 80', () => {
    expect(getSpeedModifier({ ...INITIAL_STATS, hunger: 90 })).toBeLessThan(1)
  })

  it('slows the player when energy is below 20', () => {
    expect(getSpeedModifier({ ...INITIAL_STATS, energy: 10 })).toBeLessThan(1)
  })

  it('stacks both slowdowns', () => {
    const both = getSpeedModifier({ ...INITIAL_STATS, hunger: 90, energy: 10 })
    const one = getSpeedModifier({ ...INITIAL_STATS, hunger: 90 })
    expect(both).toBeLessThan(one)
  })

  it('normal stats give full speed', () => {
    expect(getSpeedModifier(INITIAL_STATS)).toBe(1)
  })
})
