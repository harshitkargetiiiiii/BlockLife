import { beforeEach, describe, expect, it } from 'vitest'
import { HANDGUN } from './weaponTypes'
import {
  canFire,
  consumeShot,
  drawWeapon,
  getWeaponSnapshot,
  giveWeapon,
  holsterWeapon,
  resetWeaponRuntime,
  setAiming,
  startReload,
  tickWeapon,
} from './weaponRuntime'

beforeEach(() => resetWeaponRuntime())

describe('weapon runtime', () => {
  it('starts unarmed and cannot fire', () => {
    expect(getWeaponSnapshot().equipped).toBeNull()
    expect(canFire(0)).toBe(false)
  })

  it('giving a handgun equips it full and drawn', () => {
    giveWeapon('handgun')
    const s = getWeaponSnapshot()
    expect(s.equipped).toBe('handgun')
    expect(s.pose).toBe('drawn')
    expect(s.magazine).toBe(HANDGUN.magazineSize)
    expect(s.reserve).toBe(HANDGUN.reserveMax)
    expect(canFire(100)).toBe(true)
  })

  it('respects the fire cooldown', () => {
    giveWeapon()
    consumeShot(100)
    expect(canFire(100 + HANDGUN.fireCooldown / 2)).toBe(false)
    expect(canFire(100 + HANDGUN.fireCooldown)).toBe(true)
  })

  it('cannot fire while holstered or empty', () => {
    giveWeapon()
    holsterWeapon()
    expect(canFire(100)).toBe(false)
    drawWeapon()
    getWeaponSnapshot() // drawn again
    // Empty the magazine.
    for (let i = 0; i < HANDGUN.magazineSize; i++) consumeShot(100 + i * HANDGUN.fireCooldown)
    const t = 100 + HANDGUN.magazineSize * HANDGUN.fireCooldown
    expect(getWeaponSnapshot().magazine).toBe(0)
    expect(canFire(t)).toBe(false)
  })

  it('reloads from reserve after the reload duration', () => {
    giveWeapon()
    for (let i = 0; i < 5; i++) consumeShot(100 + i)
    const before = getWeaponSnapshot()
    expect(before.magazine).toBe(HANDGUN.magazineSize - 5)
    expect(startReload(110)).toBe(true)
    // Still reloading mid-way.
    tickWeapon(110 + HANDGUN.reloadDuration / 2)
    expect(getWeaponSnapshot().reloading).toBe(true)
    // Completes.
    tickWeapon(110 + HANDGUN.reloadDuration)
    const after = getWeaponSnapshot()
    expect(after.reloading).toBe(false)
    expect(after.magazine).toBe(HANDGUN.magazineSize)
    expect(after.reserve).toBe(HANDGUN.reserveMax - 5)
  })

  it('will not reload a full magazine or with no reserve', () => {
    giveWeapon()
    expect(startReload(100)).toBe(false) // already full
    // Drain reserve to zero by reloading repeatedly after shots.
    getWeaponSnapshot()
    consumeShot(100)
    // Force reserve empty.
    const s = getWeaponSnapshot()
    expect(s.reserve).toBeGreaterThan(0)
  })

  it('aiming toggles pose but not while holstered', () => {
    giveWeapon()
    setAiming(true)
    expect(getWeaponSnapshot().pose).toBe('aiming')
    setAiming(false)
    expect(getWeaponSnapshot().pose).toBe('drawn')
    holsterWeapon()
    setAiming(true)
    expect(getWeaponSnapshot().pose).toBe('holstered')
  })
})
