import { describe, expect, it } from 'vitest'
import { NPC_DEFS } from '../../data/npcs'
import { getItemDefinition } from '../items/itemCatalog'
import { SOCIAL_ACTORS, allSocialActorIds, defaultRelationshipFor, getSocialActor, isSocialActor, socialActorNpcIds } from './socialActors'
import { clampRelationship } from './relationship'

describe('social actor registry — identity mapping + validity (§1)', () => {
  it('ships at least five named actors, including Ravi', () => {
    expect(SOCIAL_ACTORS.length).toBeGreaterThanOrEqual(5)
    expect(isSocialActor('npc_ravi_01')).toBe(true)
  })

  it('every social actor id maps to a real named NPC (one stable identity)', () => {
    const npcIds = socialActorNpcIds()
    for (const a of SOCIAL_ACTORS) {
      expect(a.npcId).toBe(a.id) // id IS the world/mission/phone/save id
      expect(npcIds.has(a.id)).toBe(true)
    }
  })

  it('has unique ids and a resolvable NPC def each', () => {
    const ids = new Set(SOCIAL_ACTORS.map((a) => a.id))
    expect(ids.size).toBe(SOCIAL_ACTORS.length)
    for (const id of allSocialActorIds()) expect(NPC_DEFS.find((n) => n.id === id)).toBeDefined()
  })

  it('gift preferences reference REAL catalog items (no parallel item model §9)', () => {
    for (const a of SOCIAL_ACTORS) {
      for (const item of [...a.giftLikes, ...a.giftDislikes]) {
        expect(getItemDefinition(item), `${a.id} references item ${item}`).toBeDefined()
      }
    }
  })

  it('default relationships are within bounds and availability windows are valid', () => {
    for (const a of SOCIAL_ACTORS) {
      expect(a.defaultRelationship).toEqual(clampRelationship(a.defaultRelationship))
      expect(a.crimeSensitivity).toBeGreaterThanOrEqual(0)
      expect(a.crimeSensitivity).toBeLessThanOrEqual(100)
      for (const [from, to] of a.availability) {
        expect(from).toBeGreaterThanOrEqual(0)
        expect(to).toBeLessThanOrEqual(24)
      }
    }
  })

  it('defaultRelationshipFor returns a fresh copy (never a shared reference)', () => {
    const a = defaultRelationshipFor('npc_ravi_01')
    a.affinity = 999
    expect(getSocialActor('npc_ravi_01')!.defaultRelationship.affinity).not.toBe(999)
  })
})
