/**
 * Firearm model (Crime & Law Enforcement v1). One handgun — deliberately
 * small so the whole loop (aim/fire/reload/holster, hitscan, noise, damage,
 * NPC reaction) stays readable and testable. No projectile objects, no
 * ballistics, no gore.
 */

export type WeaponId = 'handgun'

export interface WeaponDefinition {
  id: WeaponId
  name: string
  magazineSize: number
  reserveMax: number
  /** Seconds between shots. */
  fireCooldown: number
  /** Seconds a full reload takes. */
  reloadDuration: number
  /** Max hitscan range (units). */
  range: number
  /** Damage per hit (before falloff — v1 has none). */
  damage: number
  /** Deterministic cone half-angle (degrees) applied to the aim direction. */
  spreadDegrees: number
  /** How far the shot's noise reaches witnesses. */
  noiseRadius: number
}

export const HANDGUN: WeaponDefinition = {
  id: 'handgun',
  name: 'Handgun',
  magazineSize: 12,
  reserveMax: 48,
  fireCooldown: 0.35,
  reloadDuration: 1.6,
  range: 34,
  damage: 34,
  spreadDegrees: 3.5,
  noiseRadius: 40,
}

export const WEAPONS: Record<WeaponId, WeaponDefinition> = { handgun: HANDGUN }

/** Draw pose. `aiming` tightens spread and is required to fire deliberately. */
export type WeaponPose = 'holstered' | 'drawn' | 'aiming'

export interface WeaponState {
  equipped: WeaponId | null
  pose: WeaponPose
  magazine: number
  reserve: number
  reloading: boolean
  /** Game time the in-progress reload completes. */
  reloadUntil: number
  /** Game time of the last shot (fire-rate gate). */
  lastFireTime: number
  /** Game time the muzzle flash effect fades (renderer reads this). */
  muzzleFlashUntil: number
  /** Monotonic shot counter — seeds deterministic spread. */
  shotsFired: number
}
