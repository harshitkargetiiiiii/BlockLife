import { describe, expect, it } from 'vitest'
import {
  appearanceForId,
  appearanceForSeed,
  NAMED_IDENTITIES,
  populationAppearanceInfo,
  SKIN_TONES,
  HAIR_COLORS,
  SHIRT_COLORS,
  PANTS_COLORS,
  SHOES_COLORS,
  ACCESSORY_COLORS,
} from './populationAppearance'
import { NPC_DEFS } from '../../data/npcs'

const AXES = [SKIN_TONES, HAIR_COLORS, SHIRT_COLORS, PANTS_COLORS, SHOES_COLORS, ACCESSORY_COLORS]
const isHex = (s: string | undefined) => typeof s === 'string' && /^#[0-9a-f]{6}$/i.test(s)

describe('populationAppearance registry (issue #23)', () => {
  it('appearanceForSeed fills all six identity axes with valid palette colours', () => {
    const a = appearanceForSeed(12345)
    expect(isHex(a.skinColor)).toBe(true)
    expect(isHex(a.accentColor)).toBe(true) // hair
    expect(isHex(a.shirtColor)).toBe(true)
    expect(isHex(a.pantsColor)).toBe(true)
    expect(isHex(a.shoesColor)).toBe(true)
    expect(isHex(a.accessoryColor)).toBe(true)
    expect(SKIN_TONES).toContain(a.skinColor)
    expect(HAIR_COLORS).toContain(a.accentColor)
    expect(ACCESSORY_COLORS).toContain(a.accessoryColor)
  })

  it('is deterministic — same seed/id always yields the same look', () => {
    expect(appearanceForSeed(777)).toEqual(appearanceForSeed(777))
    expect(appearanceForId('cit_test_42')).toEqual(appearanceForId('cit_test_42'))
  })

  it('produces real variety — 200 seeds give many distinct appearances', () => {
    const looks = new Set(
      Array.from({ length: 200 }, (_, i) => JSON.stringify(appearanceForSeed(i * 2654435761))),
    )
    // Not a collision-free guarantee, but must be broadly varied (not one/two looks).
    expect(looks.size).toBeGreaterThan(120)
  })

  it('every named NPC has a curated, unique identity', () => {
    // One curated identity per named NPC that ships in the data.
    const namedIds = NPC_DEFS.map((n) => n.id)
    for (const id of namedIds) {
      expect(NAMED_IDENTITIES[id], `${id} needs a curated identity`).toBeDefined()
    }
    // Every curated identity is complete + its signature shirt colour is unique across the cast.
    const shirts = Object.values(NAMED_IDENTITIES).map((a) => a.shirtColor)
    expect(new Set(shirts).size).toBe(shirts.length)
    for (const a of Object.values(NAMED_IDENTITIES)) {
      for (const field of ['skinColor', 'accentColor', 'shirtColor', 'pantsColor', 'shoesColor', 'accessoryColor'] as const) {
        expect(isHex(a[field]), `${field}=${a[field]}`).toBe(true)
      }
    }
  })

  it('appearanceForId returns the curated identity for a named NPC, deterministic variety otherwise', () => {
    expect(appearanceForId('npc_maya_01')).toEqual(NAMED_IDENTITIES.npc_maya_01)
    const ambient = appearanceForId('cit_dd_shopper_west')
    expect(isHex(ambient.skinColor)).toBe(true)
    expect(ambient).not.toEqual(NAMED_IDENTITIES.npc_maya_01)
  })

  it('info reports the curated count + axis sizes; palettes are non-trivial', () => {
    const info = populationAppearanceInfo()
    expect(info.namedIdentities).toBe(Object.keys(NAMED_IDENTITIES).length)
    for (const axis of AXES) expect(axis.length).toBeGreaterThanOrEqual(5)
    // Combination space is large enough to feel unique across a ~50-person crowd.
    const combos = AXES.reduce((n, axis) => n * axis.length, 1)
    expect(combos).toBeGreaterThan(50_000)
  })
})
