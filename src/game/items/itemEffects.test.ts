import { describe, expect, it } from 'vitest'
import { applyItemEffect, type EffectContext } from './itemEffects'
import { getItemDefinition } from './itemCatalog'

function ctx(over: Partial<EffectContext> = {}): EffectContext {
  return {
    hunger: 50,
    energy: 50,
    health: 50,
    maxHealth: 100,
    ammoReserve: 0,
    ammoReserveMax: 60,
    incapacitated: false,
    unlockedPalettes: new Set(),
    hasHandgun: true,
    ...over,
  }
}

const eff = (id: string) => getItemDefinition(id)!.effect

describe('item effects', () => {
  it('food reduces hunger, capped at 0, refusing (no consume) when already fed', () => {
    const r = applyItemEffect(eff('meal'), ctx({ hunger: 10 }))
    expect(r.ok && r.consume).toBe(true)
    expect(r.ok && r.patch.hunger).toBe(0) // 10 - 25 clamped to 0
    expect(applyItemEffect(eff('meal'), ctx({ hunger: 0 }))).toMatchObject({ ok: false, reason: 'already_full' })
  })

  it('energy drink restores energy, capped at 100', () => {
    expect(applyItemEffect(eff('energy_drink'), ctx({ energy: 95 }))).toMatchObject({ ok: true, patch: { energy: 100 } })
    expect(applyItemEffect(eff('energy_drink'), ctx({ energy: 100 })).ok).toBe(false)
  })

  it('first aid heals, capped at max, refused when incapacitated or already full', () => {
    expect(applyItemEffect(eff('first_aid'), ctx({ health: 80 }))).toMatchObject({ ok: true, patch: { health: 100 } })
    expect(applyItemEffect(eff('first_aid'), ctx({ health: 100 }))).toMatchObject({ ok: false, reason: 'already_full' })
    expect(applyItemEffect(eff('first_aid'), ctx({ incapacitated: true }))).toMatchObject({ ok: false, reason: 'incapacitated' })
  })

  it('ammo box adds reserve up to the cap, refused when full or no weapon', () => {
    expect(applyItemEffect(eff('ammo_box'), ctx({ ammoReserve: 50, ammoReserveMax: 60 }))).toMatchObject({ ok: true, patch: { ammoReserve: 60 } })
    expect(applyItemEffect(eff('ammo_box'), ctx({ ammoReserve: 60, ammoReserveMax: 60 })).ok).toBe(false)
    expect(applyItemEffect(eff('ammo_box'), ctx({ hasHandgun: false }))).toMatchObject({ ok: false, reason: 'no_weapon' })
  })

  it('wardrobe unlock grants a palette once; a repeat is a no-op (no consume)', () => {
    expect(applyItemEffect(eff('wardrobe_teal'), ctx())).toMatchObject({ ok: true, patch: { unlockPalette: 'teal' } })
    expect(applyItemEffect(eff('wardrobe_teal'), ctx({ unlockedPalettes: new Set(['teal']) }))).toMatchObject({ ok: false, reason: 'already_unlocked' })
  })

  it('quest/supply items are not usable', () => {
    expect(applyItemEffect(eff('coffee'), ctx())).toMatchObject({ ok: false, reason: 'not_usable' })
    expect(applyItemEffect(eff('restock_crate'), ctx())).toMatchObject({ ok: false, reason: 'not_usable' })
  })
})
