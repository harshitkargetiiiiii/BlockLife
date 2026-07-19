import type { ItemEffect } from './itemTypes'

/**
 * Pure interpreter for item-use effects. It reads a snapshot of the relevant
 * authorities (stats, health, ammo, wardrobe) and returns WHAT should change —
 * it never touches the store, the health authority, or the ammo runtime itself.
 * The store action applies the returned patch AND removes exactly one item, but
 * ONLY when `consume` is true, so a full/invalid use never eats the item.
 *
 * Bounds are respected here: hunger/energy are 0–100 (lower hunger = more fed),
 * health is capped at the injected max, ammo reserve at the weapon's reserve max.
 */

export interface EffectContext {
  hunger: number
  energy: number
  health: number
  maxHealth: number
  ammoReserve: number
  ammoReserveMax: number
  /** A first-aid kit can't revive a downed player. */
  incapacitated: boolean
  /** Palette ids already unlocked (a repeat unlock is a no-op, not a charge). */
  unlockedPalettes: ReadonlySet<string>
  /** True while an ammo box is unusable because no handgun is equipped/known. */
  hasHandgun: boolean
}

export type EffectRefusal =
  | 'already_full'
  | 'incapacitated'
  | 'already_unlocked'
  | 'no_weapon'
  | 'not_usable'

/** A patch of authority values to apply (only the touched fields are present). */
export interface EffectPatch {
  hunger?: number
  energy?: number
  health?: number
  ammoReserve?: number
  unlockPalette?: string
}

export type EffectResult =
  | { ok: true; consume: boolean; patch: EffectPatch; message: string }
  | { ok: false; reason: EffectRefusal; message: string }

const clamp01 = (v: number) => Math.max(0, Math.min(100, v))

/** Interpret a used item's effect against the current context. Pure. */
export function applyItemEffect(effect: ItemEffect, ctx: EffectContext): EffectResult {
  switch (effect.kind) {
    case 'feed': {
      if (ctx.hunger <= 0) return { ok: false, reason: 'already_full', message: "You're not hungry." }
      return {
        ok: true,
        consume: true,
        patch: { hunger: clamp01(ctx.hunger - effect.hunger) },
        message: 'Ate it.',
      }
    }
    case 'refresh': {
      if (ctx.energy >= 100) return { ok: false, reason: 'already_full', message: 'Already fully rested.' }
      return {
        ok: true,
        consume: true,
        patch: { energy: clamp01(ctx.energy + effect.energy) },
        message: 'Feeling energized.',
      }
    }
    case 'heal': {
      if (ctx.incapacitated) return { ok: false, reason: 'incapacitated', message: "Can't use that right now." }
      if (ctx.health >= ctx.maxHealth) return { ok: false, reason: 'already_full', message: 'Already at full health.' }
      return {
        ok: true,
        consume: true,
        patch: { health: Math.min(ctx.maxHealth, ctx.health + effect.health) },
        message: 'Patched up.',
      }
    }
    case 'ammo': {
      if (!ctx.hasHandgun) return { ok: false, reason: 'no_weapon', message: 'No handgun to load.' }
      if (ctx.ammoReserve >= ctx.ammoReserveMax) return { ok: false, reason: 'already_full', message: 'Ammo reserve is full.' }
      return {
        ok: true,
        consume: true,
        patch: { ammoReserve: Math.min(ctx.ammoReserveMax, ctx.ammoReserve + effect.rounds) },
        message: 'Loaded reserve rounds.',
      }
    }
    case 'unlock': {
      if (ctx.unlockedPalettes.has(effect.paletteId)) {
        // Already owned — a no-op that must NOT consume/charge again.
        return { ok: false, reason: 'already_unlocked', message: 'Already unlocked.' }
      }
      return {
        ok: true,
        consume: true,
        patch: { unlockPalette: effect.paletteId },
        message: 'Unlocked a new colour.',
      }
    }
    case 'none':
      return { ok: false, reason: 'not_usable', message: "Can't use that." }
  }
}
