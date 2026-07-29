import { describe, expect, it } from 'vitest'
import {
  buyCoffee,
  buyMeal,
  sleep,
  train,
  COFFEE_COST,
  MEAL_COST,
} from './economySystem'
import { INITIAL_STATS } from '../player/playerTypes'

describe('economySystem', () => {
  it('buying a meal costs money and reduces hunger', () => {
    const r = buyMeal({ ...INITIAL_STATS, hunger: 60 })
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.stats.money).toBe(INITIAL_STATS.money - MEAL_COST)
    expect(r.stats.hunger).toBe(35)
  })

  it('meal hunger cannot go below 0', () => {
    const r = buyMeal({ ...INITIAL_STATS, hunger: 10 })
    expect(r.ok && r.stats.hunger).toBe(0)
  })

  it('rejects a meal the player cannot afford', () => {
    const r = buyMeal({ ...INITIAL_STATS, money: 4 })
    expect(r.ok).toBe(false)
  })

  it('buying coffee costs money', () => {
    const r = buyCoffee(INITIAL_STATS)
    expect(r.ok && r.stats.money).toBe(INITIAL_STATS.money - COFFEE_COST)
  })

  it('training costs energy, adds strength and one hour', () => {
    const r = train(INITIAL_STATS)
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.stats.energy).toBe(80)
    expect(r.stats.strength).toBe(2)
    expect(r.stats.hour).toBe(9)
  })

  it('rejects training when too tired', () => {
    expect(train({ ...INITIAL_STATS, energy: 10 }).ok).toBe(false)
  })

  it('training off the clock (gym free access) waives the energy gate', () => {
    // The old workShift money-vendor is gone; paid work is Careers v1 only. Free gym
    // access lets a tired player still train (Strength +1) at a reduced energy cost.
    const tired = { ...INITIAL_STATS, energy: 10 }
    expect(train(tired).ok).toBe(false) // normally too tired
    const r = train(tired, true) // free access
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.stats.strength).toBe(INITIAL_STATS.strength + 1)
  })

  it('sleeping restores energy, adds a little hunger, wakes next morning', () => {
    const r = sleep({ ...INITIAL_STATS, energy: 15, hunger: 40, hour: 23 })
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.stats.energy).toBe(100)
    expect(r.stats.hunger).toBe(50)
    expect(r.stats.day).toBe(2)
    expect(r.stats.hour).toBe(7)
  })
})
