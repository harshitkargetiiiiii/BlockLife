import { useRef } from 'react'
import * as THREE from 'three'
import { useFrame } from '@react-three/fiber'
import type { Vec2 } from '../world/worldTypes'
import { useGameStore, isGameplayInputBlocked } from '../store/useGameStore'
import { registry, getFollowTargetPosition } from '../world/runtimeRegistry'
import { getCrimeGameTime } from '../crime/crimeSystem'
import { hasLineOfSight } from '../crime/lineOfSight'
import { ambientCitizenRuntime } from '../citizens/AmbientCitizens'
import { policeRuntime } from '../police/policeRuntime'
import { clearCombatEdges, getCombatInput } from '../controls/useKeyboardControls'
import {
  drawWeapon,
  getWeaponDef,
  holsterWeapon,
  startReload,
  tickWeapon,
  weaponRuntime,
} from './weaponRuntime'
import { isIncapacitated } from './healthState'
import { firePlayerWeapon } from './combatSystem'
import type { HitscanTarget } from './hitscan'

/**
 * Live weapon driver + muzzle-flash renderer. Reads edge-triggered combat
 * input, ticks the reload, and on fire gathers live actors (police + active
 * citizens) as hitscan targets, auto-aims the nearest one with clear line of
 * sight (else the player's facing), and runs the fire orchestration. Pooled
 * target objects; no per-frame allocation beyond the small candidate list.
 */

const targetPool: HitscanTarget[] = []

function gatherTargets(origin: Vec2, range: number): HitscanTarget[] {
  const out: HitscanTarget[] = []
  let n = 0
  const r2 = range * range
  const push = (id: string, x: number, z: number, radius: number, kind: 'citizen' | 'police') => {
    const dx = x - origin[0]
    const dz = z - origin[1]
    if (dx * dx + dz * dz > r2) return
    if (isIncapacitated(id)) return
    let t = targetPool[n]
    if (!t) {
      t = { id, position: [x, z], radius, kind }
      targetPool[n] = t
    } else {
      t.id = id
      t.position[0] = x
      t.position[1] = z
      t.radius = radius
      t.kind = kind
    }
    out.push(t)
    n++
  }
  for (const u of policeRuntime.units.values()) push(u.id, u.position[0], u.position[1], 0.7, 'police')
  for (const c of ambientCitizenRuntime.values()) {
    if (c.state === 'hidden') continue
    push(c.id, c.x, c.z, 0.45, 'citizen')
  }
  return out
}

const bystanderPool: { id: string; position: Vec2 }[] = []

/**
 * Everyone who should FLEE a gunshot (panic), which is a superset of who can be
 * HIT: the hittable citizen targets PLUS the named residents. Quest givers are
 * intentionally not in the hittable target list, so they scatter and recover
 * but can never be downed — a crime can't permanently strand a quest.
 */
function gatherBystanders(targets: readonly HitscanTarget[]): { id: string; position: Vec2 }[] {
  let n = 0
  const put = (id: string, x: number, z: number) => {
    let b = bystanderPool[n]
    if (!b) {
      b = { id, position: [x, z] }
      bystanderPool[n] = b
    } else {
      b.id = id
      b.position[0] = x
      b.position[1] = z
    }
    n++
  }
  for (const t of targets) if (t.kind === 'citizen') put(t.id, t.position[0], t.position[1])
  for (const [id, p] of registry.npcPositions) put(id, p.x, p.z)
  return bystanderPool.slice(0, n)
}

/** Nearest target with clear LOS → aim at it; else aim the facing heading. */
function resolveAim(origin: Vec2, heading: number, targets: readonly HitscanTarget[]): Vec2 {
  let best: HitscanTarget | null = null
  let bestD = Infinity
  for (const t of targets) {
    const d = Math.hypot(t.position[0] - origin[0], t.position[1] - origin[1])
    // Police first when equally close (they're the real threat).
    const score = d - (t.kind === 'police' ? 2 : 0)
    if (score < bestD && hasLineOfSight(origin, t.position, { includeProps: true })) {
      best = t
      bestD = score
    }
  }
  if (best) {
    const dx = best.position[0] - origin[0]
    const dz = best.position[1] - origin[1]
    const len = Math.hypot(dx, dz) || 1
    return [dx / len, dz / len]
  }
  return [Math.sin(heading), Math.cos(heading)]
}

export function PlayerWeapon() {
  const flashRef = useRef<THREE.Mesh>(null)
  const flashMat = useRef<THREE.MeshBasicMaterial>(null)

  useFrame(() => {
    const store = useGameStore.getState()
    if (store.worldPaused) return
    if (isGameplayInputBlocked(store.ui.panel)) {
      clearCombatEdges()
      return
    }
    const gameTime = getCrimeGameTime()
    tickWeapon(gameTime)

    const input = getCombatInput()
    const def = getWeaponDef()

    if (input.drawHolsterToggleQueued && weaponRuntime.state.equipped) {
      if (weaponRuntime.state.pose === 'holstered') drawWeapon()
      else holsterWeapon()
    }
    if (input.reloadQueued) startReload(gameTime)

    if (input.fireQueued && def && !store.playerIncapacitated) {
      const follow = getFollowTargetPosition(store.mode)
      const origin: Vec2 = [follow.x, follow.z]
      const heading = registry.playerHeading
      const targets = gatherTargets(origin, def.range)
      const aim = resolveAim(origin, heading, targets)
      firePlayerWeapon({ origin, aimDir: aim, gameTime, targets, bystanders: gatherBystanders(targets) })
    }
    clearCombatEdges()

    // Muzzle flash: brief emissive puff at the barrel, along the last aim.
    const flash = flashRef.current
    if (flash) {
      const active = gameTime < weaponRuntime.state.muzzleFlashUntil
      flash.visible = active
      if (active) {
        const follow = getFollowTargetPosition(store.mode)
        const heading = registry.playerHeading
        const fx = Math.sin(heading)
        const fz = Math.cos(heading)
        flash.position.set(follow.x + fx * 1.1, 1.2, follow.z + fz * 1.1)
        if (flashMat.current) {
          flashMat.current.opacity = (weaponRuntime.state.muzzleFlashUntil - gameTime) / 0.06
        }
      }
    }
  })

  return (
    <mesh ref={flashRef} visible={false}>
      <sphereGeometry args={[0.28, 8, 8]} />
      <meshBasicMaterial ref={flashMat} color="#ffd23a" transparent opacity={1} />
    </mesh>
  )
}
