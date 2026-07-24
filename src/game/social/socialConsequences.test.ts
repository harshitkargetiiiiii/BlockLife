import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import * as THREE from 'three'
import {
  namedActorsNear,
  noteArrestWitnessed,
  noteCrimeWitnessed,
  socialLoyaltyDiscount,
  vendorDiscountPct,
} from './socialConsequences'
import { getRelationship, getMemories, ingestSocialEvent, resetSocial } from './socialRuntime'
import { registry } from '../world/runtimeRegistry'
import { discountedPrice, buyCoffee, COFFEE_COST } from '../simulation/economySystem'
import { INITIAL_STATS } from '../player/playerTypes'

function place(id: string, x: number, z: number) {
  registry.npcPositions.set(id, new THREE.Vector3(x, 0, z))
}

describe('social consequences — observe-only bridge (§ consequences)', () => {
  beforeEach(() => {
    resetSocial()
    registry.npcPositions.clear()
  })
  afterEach(() => registry.npcPositions.clear())

  it('namedActorsNear finds social actors in range, ignores others', () => {
    place('npc_kim_01', 0, 0)
    place('npc_maya_01', 100, 100) // far
    place('citizen_random_1', 0, 0) // not a named actor
    expect(namedActorsNear([0, 0, 0], 22)).toEqual(['npc_kim_01'])
  })

  it('a witnessed crime scales with sensitivity — Officer Kim fears more than Ravi', () => {
    place('npc_kim_01', 1, 1) // crimeSensitivity 95
    place('npc_ravi_01', 2, 2) // crimeSensitivity 40
    const seen = noteCrimeWitnessed('crimeA', [0, 0, 0], 3, 14)
    expect(seen.sort()).toEqual(['npc_kim_01', 'npc_ravi_01'])
    expect(getMemories('npc_kim_01').some((m) => m.kind === 'crime_witnessed')).toBe(true)
    expect(getRelationship('npc_kim_01').fear).toBeGreaterThan(getRelationship('npc_ravi_01').fear)
    // Exactly-once per crime per witness.
    noteCrimeWitnessed('crimeA', [0, 0, 0], 3, 14)
    expect(getMemories('npc_kim_01').filter((m) => m.kind === 'crime_witnessed')).toHaveLength(1)
  })

  it('a public arrest dings trust of nearby named NPCs', () => {
    place('npc_nisha_01', 0, 0)
    // Give Nisha some trust first so the ding is visible.
    ingestSocialEvent({ id: 'seed', kind: 'favor_completed', actorId: 'npc_nisha_01', gameDay: 1 })
    const before = getRelationship('npc_nisha_01').trust
    noteArrestWitnessed([0, 0, 0], 2, 9)
    expect(getRelationship('npc_nisha_01').trust).toBeLessThan(before)
    expect(getMemories('npc_nisha_01').some((m) => m.kind === 'arrested_witnessed')).toBe(true)
  })

  it('loyalty discount grows with warmth and lowers the real price', () => {
    expect(socialLoyaltyDiscount('stranger')).toBe(0)
    expect(socialLoyaltyDiscount('friendly')).toBe(0.05)
    expect(socialLoyaltyDiscount('close')).toBe(0.15)
    expect(discountedPrice(COFFEE_COST, 0.2)).toBe(Math.round(COFFEE_COST * 0.8))
    // A discounted coffee costs the player less money.
    const full = buyCoffee({ ...INITIAL_STATS }, 0)
    const cheap = buyCoffee({ ...INITIAL_STATS }, 0.2)
    if (full.ok && cheap.ok) expect(cheap.stats.money).toBeGreaterThan(full.stats.money)
  })

  it('vendorDiscountPct reads the live relationship tier', () => {
    expect(vendorDiscountPct('npc_maya_01')).toBe(0) // stranger
    // Warm Maya up to friendly (affinity ≥ 25 with familiarity ≥ 15).
    ingestSocialEvent({ id: 'm1', kind: 'met', actorId: 'npc_maya_01', gameDay: 1 })
    ingestSocialEvent({ id: 'm2', kind: 'gift_liked', actorId: 'npc_maya_01', gameDay: 1 })
    ingestSocialEvent({ id: 'm3', kind: 'gift_liked', actorId: 'npc_maya_01', gameDay: 2 })
    ingestSocialEvent({ id: 'm4', kind: 'gift_liked', actorId: 'npc_maya_01', gameDay: 3 })
    expect(vendorDiscountPct('npc_maya_01')).toBeGreaterThan(0)
  })
})
