import { HANDGUN, WEAPONS, type WeaponDefinition, type WeaponId, type WeaponState } from './weaponTypes'

/**
 * The player's weapon state machine (global — survives streaming; transient
 * across save/load per the v1 safety policy). Pure runtime: equip/holster/
 * aim/reload/fire gates. The live component reads pose + muzzle flash; the
 * fire orchestration (hitscan + damage + crime) lives in `combatSystem`.
 */

function emptyState(): WeaponState {
  return {
    equipped: null,
    pose: 'holstered',
    magazine: 0,
    reserve: 0,
    reloading: false,
    reloadUntil: 0,
    lastFireTime: -Infinity,
    muzzleFlashUntil: 0,
    shotsFired: 0,
  }
}

export const weaponRuntime = {
  state: emptyState(),
  debugEnabled: false,
}

export function getWeaponDef(): WeaponDefinition | null {
  return weaponRuntime.state.equipped ? WEAPONS[weaponRuntime.state.equipped] : null
}

/** Give the player a weapon: equips it, tops up magazine + reserve. */
export function giveWeapon(id: WeaponId = 'handgun'): void {
  const def = WEAPONS[id]
  const s = weaponRuntime.state
  s.equipped = id
  s.pose = 'drawn'
  s.magazine = def.magazineSize
  s.reserve = def.reserveMax
  s.reloading = false
  s.reloadUntil = 0
}

export function holsterWeapon(): void {
  const s = weaponRuntime.state
  s.pose = 'holstered'
  s.reloading = false
}

export function drawWeapon(): void {
  if (weaponRuntime.state.equipped) weaponRuntime.state.pose = 'drawn'
}

export function setAiming(on: boolean): void {
  const s = weaponRuntime.state
  if (!s.equipped || s.pose === 'holstered') return
  s.pose = on ? 'aiming' : 'drawn'
}

/** Begin a reload if it's possible (has a weapon, room, reserve, not already). */
export function startReload(gameTime: number): boolean {
  const s = weaponRuntime.state
  const def = getWeaponDef()
  if (!def || s.pose === 'holstered' || s.reloading) return false
  if (s.magazine >= def.magazineSize || s.reserve <= 0) return false
  s.reloading = true
  s.reloadUntil = gameTime + def.reloadDuration
  return true
}

/** Per-frame: complete a reload whose timer has elapsed. */
export function tickWeapon(gameTime: number): void {
  const s = weaponRuntime.state
  const def = getWeaponDef()
  if (!def || !s.reloading) return
  if (gameTime >= s.reloadUntil) {
    const need = def.magazineSize - s.magazine
    const take = Math.min(need, s.reserve)
    s.magazine += take
    s.reserve -= take
    s.reloading = false
    s.reloadUntil = 0
  }
}

/** True if a deliberate shot may be fired right now. */
export function canFire(gameTime: number): boolean {
  const s = weaponRuntime.state
  const def = getWeaponDef()
  if (!def) return false
  if (s.pose === 'holstered' || s.reloading) return false
  if (s.magazine <= 0) return false
  return gameTime - s.lastFireTime >= def.fireCooldown - 1e-6
}

/** Consume a round + stamp the flash. Caller must have checked `canFire`. */
export function consumeShot(gameTime: number): void {
  const s = weaponRuntime.state
  s.magazine -= 1
  s.lastFireTime = gameTime
  s.shotsFired += 1
  s.muzzleFlashUntil = gameTime + 0.06
}

/** Dev/test: set magazine + reserve directly (clamped to the weapon's caps). */
export function setAmmo(magazine: number, reserve: number): void {
  const def = getWeaponDef()
  if (!def) return
  weaponRuntime.state.magazine = Math.max(0, Math.min(def.magazineSize, Math.floor(magazine)))
  weaponRuntime.state.reserve = Math.max(0, Math.min(def.reserveMax, Math.floor(reserve)))
  weaponRuntime.state.reloading = false
  weaponRuntime.state.reloadUntil = 0
}

export function getWeaponSnapshot(): WeaponState {
  return { ...weaponRuntime.state }
}

export function resetWeaponRuntime(): void {
  weaponRuntime.state = emptyState()
  weaponRuntime.debugEnabled = false
}

export { HANDGUN }
